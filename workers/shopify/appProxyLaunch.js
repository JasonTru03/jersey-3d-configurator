import { verifyAppProxySignature } from './appProxy.js';
import { normalizeShop } from './storeConfig.js';
import { createStoreConfigRepository } from './storeConfigRepository.js';

const MAX_URL_LENGTH = 16 * 1024;
const MAX_AGE_SECONDS = 5 * 60;
const ALLOWED_KEYS = new Set([
  'logged_in_customer_id',
  'path_prefix',
  'productHandle',
  'returnPath',
  'shop',
  'signature',
  'timestamp',
  'variantId',
]);

export function createAppProxyLaunchHandler(env, dependencies = {}) {
  const createRepository = dependencies.createStoreConfigRepository ?? createStoreConfigRepository;
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? console;
  return async function handleAppProxyLaunch(request) {
    try {
      const bindings = validateBindings(env, createRepository);
      if (request.method !== 'GET') return textResponse(405, 'Method not allowed.', { Allow: 'GET' });
      const url = parseUrl(request.url);
      validateQuery(url);
      if (!await verifyAppProxySignature(url, bindings.secret)) {
        return textResponse(401, 'Invalid app proxy signature.');
      }
      validateTimestamp(url.searchParams.get('timestamp'), now());
      let shop;
      try { shop = normalizeShop(url.searchParams.get('shop')); }
      catch { throw new ClientError(400, 'Invalid shop.'); }
      const variantId = requirePattern(url.searchParams.get('variantId'), /^[1-9][0-9]{0,31}$/u);
      const productHandle = requirePattern(
        url.searchParams.get('productHandle'), /^[a-z0-9][a-z0-9-]{0,254}$/u,
      );
      const returnPath = normalizeReturnPath(url.searchParams.get('returnPath'));
      const stored = await bindings.repository.get(shop);
      if (!stored || stored.status !== 'active') {
        return textResponse(409, 'Store configuration is not active.');
      }
      if (!Object.values(stored.config.jerseyVariants).includes(variantId)) {
        return textResponse(400, 'Selected variant is not configured.');
      }
      const destination = new URL('/', url.origin);
      destination.searchParams.set('shop', shop);
      destination.searchParams.set('productHandle', productHandle);
      destination.searchParams.set('variantId', variantId);
      destination.searchParams.set('variantMap', JSON.stringify(stored.config.jerseyVariants));
      destination.searchParams.set('surchargeVariantMap', JSON.stringify(stored.config.surchargeVariants));
      destination.searchParams.set('returnPath', returnPath);
      return new Response(null, { status: 302, headers: {
        'Cache-Control': 'no-store',
        Location: destination.toString(),
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      } });
    } catch (error) {
      if (error instanceof ClientError) return textResponse(error.status, error.message);
      logger.error?.('SHOPIFY_APP_PROXY_LAUNCH_FAILED');
      return textResponse(503, 'Configurator launch is temporarily unavailable.');
    }
  };
}

function validateBindings(env, createRepository) {
  if (!env || typeof env.SHOPIFY_API_SECRET !== 'string'
    || new TextEncoder().encode(env.SHOPIFY_API_SECRET).length < 16 || !env.PRODUCTION_DB) {
    throw new Error('Invalid launch bindings.');
  }
  const repository = createRepository(env.PRODUCTION_DB, {
    legacyConfigJson: env.SHOPIFY_STORE_CONFIG_JSON ?? '{}',
  });
  if (typeof repository?.get !== 'function') throw new Error('Invalid config repository.');
  return { repository, secret: env.SHOPIFY_API_SECRET };
}

function parseUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) throw new ClientError(400, 'Invalid URL.');
  try { return new URL(value); } catch { throw new ClientError(400, 'Invalid URL.'); }
}

function validateQuery(url) {
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!ALLOWED_KEYS.has(key) || seen.has(key) || value.length > 2048) {
      throw new ClientError(400, 'Invalid query.');
    }
    seen.add(key);
  }
  if ([...ALLOWED_KEYS].filter((key) => !['logged_in_customer_id', 'path_prefix'].includes(key))
    .some((key) => !seen.has(key))) throw new ClientError(400, 'Missing query.');
}

function validateTimestamp(value, currentTime) {
  if (!/^[1-9][0-9]{9,12}$/u.test(value ?? '') || !Number.isSafeInteger(currentTime)) {
    throw new ClientError(400, 'Invalid timestamp.');
  }
  const timestamp = Number(value);
  const currentSeconds = Math.floor(currentTime / 1000);
  if (Math.abs(currentSeconds - timestamp) > MAX_AGE_SECONDS) {
    throw new ClientError(401, 'Expired app proxy request.');
  }
}

function normalizeReturnPath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 255
    || !value.startsWith('/') || value.startsWith('//') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ClientError(400, 'Invalid return path.');
  }
  return value;
}

function requirePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new ClientError(400, 'Invalid value.');
  return value;
}

class ClientError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function textResponse(status, body, extra = {}) {
  return new Response(body, { status, headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  } });
}
