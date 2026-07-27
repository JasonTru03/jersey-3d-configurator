import { calculateTrustedComponents } from './quotePricing.js';
import { createDesignSummary } from './designSummary.js';
import {
  QUOTE_SCHEMA_VERSION,
  createShopFingerprint,
  signQuoteContract,
} from './quoteContract.js';

export const CART_QUOTE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DESIGN_RECORD_TTL_SECONDS = 180 * 24 * 60 * 60;
export const MAX_CART_QUOTE_BODY_BYTES = 256000;

const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const ATLAS_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/iu;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

class ClientError extends Error {}
class ServiceError extends Error {}

export function createCartQuotesHandler(env, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const randomBytes = dependencies.randomBytes ?? secureRandomBytes;

  return async function handleCartQuote(request) {
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method must be POST.', { Allow: 'POST' });
    }

    try {
      const bindings = validateBindings(env);
      const storeConfigs = parseStoreConfigs(bindings.storeConfigJson);
      const body = await parseRequestBody(request);
      const shop = normalizeShop(body.shop);
      const productionFiles = normalizeProductionFiles(body.productionFiles);
      const storeConfig = storeConfigs[shop];
      if (storeConfig === undefined) {
        throw new ServiceError('Store pricing configuration is unavailable.');
      }

      const issuedAt = now();
      if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
        throw new ServiceError('Quote clock is unavailable.');
      }
      await consumeRateLimit(bindings.rateLimit, request, issuedAt);

      let priced;
      try {
        priced = calculateTrustedComponents({ state: body.state, storeConfig });
      } catch (error) {
        if (isStoreConfigurationError(error)) {
          throw new ServiceError('Store pricing configuration is invalid.');
        }
        throw new ClientError('Design state is invalid.');
      }

      const bundleId = `bun_${encodeBase64Url(readRandomBytes(randomBytes))}`;
      const designId = `dsg_${encodeBase64Url(readRandomBytes(randomBytes))}`;
      let shopFingerprint;
      try {
        shopFingerprint = await createShopFingerprint(shop);
      } catch {
        throw new ServiceError('Quote signing dependency is unavailable.');
      }
      const components = [
        { role: 'base', variantId: priced.jerseyVariantId, quantity: 1 },
        ...priced.surchargeItems.map(({ variantId, quantity }) => ({
          role: 'surcharge',
          variantId,
          quantity,
        })),
      ];
      const expiresAt = issuedAt + CART_QUOTE_TTL_SECONDS * 1000;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new ServiceError('Quote clock is unavailable.');
      }
      let totalMinor;
      try {
        totalMinor = toMinorUnits(priced.quote.total, priced.quote.currency);
      } catch {
        throw new ServiceError('Trusted quote amount is invalid.');
      }
      const contract = {
        version: QUOTE_SCHEMA_VERSION,
        shopFingerprint,
        bundleId,
        designId,
        totalMinor,
        currency: priced.quote.currency,
        issuedAt,
        expiresAt,
        components,
      };

      let token;
      try {
        token = await signQuoteContract(contract, bindings.signingSecret);
      } catch {
        throw new ServiceError('Quote signing dependency is unavailable.');
      }

      let summary;
      try {
        summary = createDesignSummary({
          state: body.state,
          normalizedState: priced.normalizedState,
          productionFiles,
        });
      } catch {
        throw new ClientError('Design fulfillment summary is invalid.');
      }

      const record = {
        version: QUOTE_SCHEMA_VERSION,
        designId,
        bundleId,
        shop,
        shopFingerprint,
        issuedAt,
        expiresAt,
        components,
        quote: priced.quote,
        normalizedState: priced.normalizedState,
        productionFiles,
        summary,
      };
      try {
        await bindings.designQuotes.put(designId, JSON.stringify(record), {
          expirationTtl: DESIGN_RECORD_TTL_SECONDS,
        });
      } catch {
        throw new ServiceError('Design quote storage is unavailable.');
      }

      const handoffUrl = new URL(`https://${shop}/apps/jersey-configurator/cart-handoff`);
      handoffUrl.searchParams.set('token', token);
      return jsonResponse(201, {
        handoffUrl: handoffUrl.toString(),
        designId,
        bundleId,
        expiresAt,
      });
    } catch (error) {
      if (error instanceof ClientError) return errorResponse(400, error.message);
      if (error instanceof RateLimitError) return errorResponse(429, 'Rate limit exceeded.');
      if (error instanceof ServiceError) return errorResponse(503, error.message);
      return errorResponse(503, 'Cart quote service is unavailable.');
    }
  };
}

export function toMinorUnits(amount, currency) {
  if (currency !== 'USD') throw new TypeError('Only USD minor units are supported.');
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw new TypeError('Quote amount must be a finite non-negative number.');
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(String(amount));
  if (!match) throw new TypeError('Quote amount must have no more than two decimal places.');
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Quote minor amount exceeds the safe integer range.');
  }
  return Number(minor);
}

function validateBindings(env) {
  if (env === null || typeof env !== 'object') {
    throw new ServiceError('Cart quote service configuration is missing.');
  }
  if (!env.DESIGN_QUOTES || typeof env.DESIGN_QUOTES.put !== 'function') {
    throw new ServiceError('Design quote storage binding is missing.');
  }
  if (
    !env.CART_QUOTE_RATE_LIMIT
    || typeof env.CART_QUOTE_RATE_LIMIT.limit !== 'function'
  ) {
    throw new ServiceError('Rate-limit storage binding is missing.');
  }
  if (
    typeof env.CART_QUOTE_SIGNING_SECRET !== 'string'
    || encoder.encode(env.CART_QUOTE_SIGNING_SECRET).length < 32
  ) {
    throw new ServiceError('Quote signing secret is missing or invalid.');
  }
  if (typeof env.SHOPIFY_STORE_CONFIG_JSON !== 'string' || env.SHOPIFY_STORE_CONFIG_JSON.length === 0) {
    throw new ServiceError('Store pricing configuration is missing.');
  }
  return {
    designQuotes: env.DESIGN_QUOTES,
    rateLimit: env.CART_QUOTE_RATE_LIMIT,
    signingSecret: env.CART_QUOTE_SIGNING_SECRET,
    storeConfigJson: env.SHOPIFY_STORE_CONFIG_JSON,
  };
}

function parseStoreConfigs(serialized) {
  let configs;
  try {
    configs = JSON.parse(serialized);
  } catch {
    throw new ServiceError('Store pricing configuration is invalid.');
  }
  if (!isPlainObject(configs)) throw new ServiceError('Store pricing configuration is invalid.');
  for (const [shop, config] of Object.entries(configs)) {
    if (!SHOP_PATTERN.test(shop) || !isPlainObject(config)) {
      throw new ServiceError('Store pricing configuration is invalid.');
    }
    const keys = Object.keys(config);
    const allowed = new Set(['productId', 'currency', 'jerseyVariants', 'surchargeVariants']);
    if (
      keys.some((key) => !allowed.has(key))
      || !Object.hasOwn(config, 'currency')
      || !Object.hasOwn(config, 'jerseyVariants')
      || !Object.hasOwn(config, 'surchargeVariants')
    ) {
      throw new ServiceError('Store pricing configuration is invalid.');
    }
  }
  return configs;
}

async function parseRequestBody(request) {
  const contentType = request.headers.get('content-type');
  if (!contentType || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new ClientError('Content-Type must be application/json.');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)) {
      throw new ClientError('Content-Length is invalid.');
    }
    if (Number(declaredLength) > MAX_CART_QUOTE_BODY_BYTES) {
      throw new ClientError('Request body is too large.');
    }
  }

  let bytes;
  try {
    bytes = await readLimitedBody(request, MAX_CART_QUOTE_BODY_BYTES);
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError('Request body could not be read.');
  }
  let body;
  try {
    body = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new ClientError('Request body must contain valid UTF-8 JSON.');
  }
  return snapshotExactObject(body, ['shop', 'state', 'productionFiles'], 'Request body');
}

async function readLimitedBody(request, maximum) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new ClientError('Request body is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function normalizeShop(value) {
  if (typeof value !== 'string') throw new ClientError('Shop domain is invalid.');
  const normalized = value.toLowerCase();
  if (!SHOP_PATTERN.test(normalized)) throw new ClientError('Shop domain is invalid.');
  return normalized;
}

function normalizeProductionFiles(value) {
  if (value === null) return null;
  const files = snapshotExactObject(
    value,
    ['bundleFilename', 'designFilename', 'atlasFilename', 'atlasSha256'],
    'productionFiles',
  );
  for (const key of ['bundleFilename', 'designFilename', 'atlasFilename']) {
    if (
      typeof files[key] !== 'string'
      || files[key].length === 0
      || files[key].length > 128
      || !SAFE_FILENAME_PATTERN.test(files[key])
      || files[key] === '.'
      || files[key] === '..'
    ) {
      throw new ClientError(`productionFiles.${key} is invalid.`);
    }
  }
  if (typeof files.atlasSha256 !== 'string' || !ATLAS_HASH_PATTERN.test(files.atlasSha256)) {
    throw new ClientError('productionFiles.atlasSha256 is invalid.');
  }
  return files;
}

async function consumeRateLimit(rateLimiter, request, issuedAt) {
  const minute = Math.floor(issuedAt / 60000);
  const connectingIp = request.headers.get('CF-Connecting-IP');
  const client = connectingIp ? `ip:${connectingIp}` : 'anonymous';
  let digest;
  try {
    digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`cart-quote:${client}`)));
  } catch {
    throw new ServiceError('Rate-limit hashing is unavailable.');
  }
  const key = `cart-quote:${minute}:${encodeBase64Url(digest).slice(0, 32)}`;
  let result;
  try {
    result = await rateLimiter.limit({ key });
  } catch {
    throw new ServiceError('Rate-limit service is unavailable.');
  }
  if (!result || typeof result.success !== 'boolean') {
    throw new ServiceError('Rate-limit service returned invalid data.');
  }
  if (!result.success) throw new RateLimitError();
}

class RateLimitError extends Error {}

function readRandomBytes(randomBytes) {
  let bytes;
  try {
    bytes = randomBytes(24);
  } catch {
    throw new ServiceError('Secure random generator is unavailable.');
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 24) {
    throw new ServiceError('Secure random generator returned invalid data.');
  }
  return bytes;
}

function secureRandomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function snapshotExactObject(value, expectedKeys, field) {
  if (!isPlainObject(value)) throw new ClientError(`${field} must be a plain object.`);
  const actualKeys = Object.keys(value);
  const expected = new Set(expectedKeys);
  const unexpected = actualKeys.find((key) => !expected.has(key));
  if (unexpected !== undefined) throw new ClientError(`${field} has an unexpected field.`);
  const missing = expectedKeys.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) throw new ClientError(`${field} is missing a required field.`);
  return Object.fromEntries(expectedKeys.map((key) => [key, value[key]]));
}

function isStoreConfigurationError(error) {
  return error instanceof Error && error.message.startsWith('Store pricing');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function errorResponse(status, message, headers) {
  return jsonResponse(status, { error: message }, headers);
}
