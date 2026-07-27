import { toMinorUnits } from './cartQuotes.js';
import {
  MAX_QUOTE_TOKEN_LENGTH,
  QUOTE_SCHEMA_VERSION,
  canonicalizeQuoteComponents,
  createShopFingerprint,
  decodeQuoteHeader,
  verifyQuoteContract,
} from './quoteContract.js';

const APP_PROXY_PATH_PREFIX = '/apps/jersey-configurator';
const MAX_PROXY_AGE_MS = 5 * 60 * 1000;
const MAX_QUERY_PARAMETERS = 32;
const MAX_QUERY_KEY_LENGTH = 128;
const MAX_QUERY_VALUE_LENGTH = 2048;
const MAX_REQUEST_URL_LENGTH = 8192;
const MAX_RECORD_BYTES = 256000;
const MAX_LINE_PROPERTIES = 25;
const MAX_PROPERTY_CODE_POINTS = 255;
const MAX_PROPERTY_KEY_BYTES = 255;
const MAX_PROPERTY_VALUE_BYTES = 1024;
const SERVICE_UNAVAILABLE_MESSAGE = 'Secure cart service is temporarily unavailable.';
const INVALID_HANDOFF_MESSAGE = 'Secure cart handoff invalid.';
const EXPIRED_HANDOFF_MESSAGE = 'Secure cart handoff expired.';
const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const HEX_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/iu;
const SHOP_FINGERPRINT_PATTERN = /^shop_[A-Za-z0-9_-]{12}$/u;
const BUNDLE_ID_PATTERN = /^bun_[A-Za-z0-9_-]{16,64}$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const PRIVATE_PROPERTY_KEYS = new Set([
  '_jersey_bundle_id',
  '_jersey_quote',
  '_jersey_design_id',
  '_jersey_schema',
  '_jersey_component',
]);
const REQUIRED_SUMMARY_KEYS = [
  'Size',
  'Template',
  'Colors',
  'Print',
  'Custom Text',
  'Extras',
  'Artwork',
];
const PRODUCTION_SUMMARY_KEYS = [
  'Production Files',
  'Bundle File',
  'Design File',
  'Atlas File',
  'UV Atlas SHA-256',
];
const SUMMARY_KEYS = new Set([...REQUIRED_SUMMARY_KEYS, ...PRODUCTION_SUMMARY_KEYS]);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

class ClientError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class ServiceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function createAppProxyHandler(env, dependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? console;

  return async function handleAppProxy(request) {
    if (request.method !== 'GET') {
      return textResponse(405, 'Method must be GET.', { Allow: 'GET' });
    }

    try {
      const bindings = validateBindings(env);
      const url = parseRequestUrl(request.url);
      validateUnauthenticatedQuery(url);
      if (!await verifyAppProxySignature(url, bindings.apiSecret)) {
        throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
      }

      const authenticated = await validateAuthenticatedQuery(url, readNow(now));
      let designId;
      try {
        designId = decodeQuoteHeader(authenticated.token).designId;
      } catch {
        throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
      }

      const stored = await readDesignRecord(bindings.designQuotes, designId);
      if (stored === null) throw new ClientError(410, EXPIRED_HANDOFF_MESSAGE);
      const record = parseDesignRecord(stored);
      await verifyStoredQuote({
        token: authenticated.token,
        record,
        shop: authenticated.shop,
        now: authenticated.now,
        signingSecret: bindings.signingSecret,
      });

      let items;
      try {
        items = createCartItems(record, authenticated.token);
      } catch {
        throw new ServiceError('APP_PROXY_CART_PROPERTIES_INVALID');
      }
      return htmlResponse(renderHandoffHtml(items));
    } catch (error) {
      if (error instanceof ClientError) return textResponse(error.status, error.message);
      const code = error instanceof ServiceError
        ? error.code
        : 'APP_PROXY_UNEXPECTED_FAILURE';
      logServiceError(logger, code);
      return textResponse(503, SERVICE_UNAVAILABLE_MESSAGE);
    }
  };
}

export async function verifyAppProxySignature(input, secret) {
  const url = input instanceof URL ? input : new URL(input);
  const secretBytes = normalizeSecret(secret, 'Shopify API secret');
  const signatures = url.searchParams.getAll('signature');
  if (signatures.length !== 1 || !HEX_SIGNATURE_PATTERN.test(signatures[0])) return false;

  const grouped = new Map();
  for (const [key, value] of url.searchParams) {
    if (key === 'signature') continue;
    const values = grouped.get(key) ?? [];
    values.push(value);
    grouped.set(key, values);
  }
  const canonical = [...grouped]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .join('');
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(canonical),
  ));
  return constantTimeEqual(expected, decodeHex(signatures[0]));
}

export function createCartItems(record, token) {
  const components = canonicalizeQuoteComponents(record.components);
  if (Object.keys(record.summary).some((key) => PRIVATE_PROPERTY_KEYS.has(key))) {
    throw new TypeError('Design summary must not replace a private property.');
  }
  const sharedProperties = {
    _jersey_bundle_id: record.bundleId,
    _jersey_quote: token,
    _jersey_design_id: record.designId,
    _jersey_schema: String(record.version),
  };
  return components.map((component) => {
    const properties = {
      ...sharedProperties,
      _jersey_component: component.role,
      ...(component.role === 'base' ? record.summary : {}),
    };
    validateLineProperties(properties);
    return {
      id: component.variantId,
      quantity: component.quantity,
      properties,
    };
  });
}

export function renderHandoffHtml(items) {
  const payload = encodeBase64Url(encoder.encode(JSON.stringify({ items })));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Adding your jersey</title>
  <style>body{font-family:system-ui,sans-serif;margin:0;padding:2rem;color:#202124;background:#fff}.panel{max-width:34rem;margin:10vh auto;text-align:center}.error{color:#9b1c1c}button{font:inherit;padding:.7rem 1.1rem}</style>
</head>
<body>
  <main class="panel">
    <h1>Adding your custom jersey…</h1>
    <p id="status" aria-live="polite">Please keep this page open.</p>
    <button id="retry" type="button" hidden>Try again</button>
  </main>
  <script type="application/json" id="cart-payload">${payload}</script>
  <script>
  (() => {
    'use strict';
    const status = document.getElementById('status');
    const retry = document.getElementById('retry');
    const encoded = document.getElementById('cart-payload').textContent;
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    let pending = false;
    const showError = () => {
      status.textContent = 'We could not add your jersey. Please try again.';
      status.className = 'error';
      retry.hidden = false;
    };
    const addToCart = async () => {
      if (pending) return;
      pending = true;
      retry.hidden = true;
      status.className = '';
      status.textContent = 'Adding your custom jersey…';
      try {
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ items: payload.items }),
        });
        const result = await response.json();
        if (!response.ok || !result || !Array.isArray(result.items) || result.items.length !== payload.items.length) {
          throw new Error('cart-add-failed');
        }
        window.location.assign('/cart');
      } catch {
        pending = false;
        showError();
      }
    };
    retry.addEventListener('click', addToCart);
    addToCart();
  })();
  </script>
</body>
</html>`;
}

function validateBindings(env) {
  if (!isPlainObject(env)) throw new ServiceError('APP_PROXY_ENV_MISSING');
  if (!env.DESIGN_QUOTES || typeof env.DESIGN_QUOTES.get !== 'function') {
    throw new ServiceError('APP_PROXY_DESIGN_QUOTES_BINDING_MISSING');
  }
  try {
    normalizeSecret(env.CART_QUOTE_SIGNING_SECRET, 'Quote signing secret');
  } catch {
    throw new ServiceError('APP_PROXY_SIGNING_SECRET_INVALID');
  }
  try {
    normalizeSecret(env.SHOPIFY_API_SECRET, 'Shopify API secret');
  } catch {
    throw new ServiceError('APP_PROXY_API_SECRET_INVALID');
  }
  return {
    designQuotes: env.DESIGN_QUOTES,
    signingSecret: env.CART_QUOTE_SIGNING_SECRET,
    apiSecret: env.SHOPIFY_API_SECRET,
  };
}

function parseRequestUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_REQUEST_URL_LENGTH) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
  try {
    return new URL(value);
  } catch {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
}

function validateUnauthenticatedQuery(url) {
  const entries = [...url.searchParams];
  if (entries.length > MAX_QUERY_PARAMETERS) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
  const seen = new Set();
  for (const [key, value] of entries) {
    if (
      key.length === 0
      || [...key].length > MAX_QUERY_KEY_LENGTH
      || [...value].length > MAX_QUERY_VALUE_LENGTH
      || seen.has(key)
    ) {
      throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
    }
    seen.add(key);
  }
  for (const key of ['shop', 'timestamp', 'signature', 'token']) {
    const value = url.searchParams.get(key);
    if (value === null || value.length === 0) {
      throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
    }
  }
  const pathPrefix = url.searchParams.get('path_prefix');
  if (pathPrefix !== null && pathPrefix.length === 0) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
  if (
    url.searchParams.get('shop').length > 255
    || url.searchParams.get('timestamp').length > 32
    || url.searchParams.get('signature').length !== 64
    || url.searchParams.get('token').length > MAX_QUOTE_TOKEN_LENGTH
  ) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
}

async function validateAuthenticatedQuery(url, now) {
  const shop = normalizeShop(url.searchParams.get('shop'));
  const timestampText = url.searchParams.get('timestamp');
  if (!/^(?:0|[1-9][0-9]*)$/u.test(timestampText)) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
  const timestampSeconds = Number(timestampText);
  if (!Number.isSafeInteger(timestampSeconds)) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
  const timestamp = timestampSeconds * 1000;
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_PROXY_AGE_MS) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
  const pathPrefix = url.searchParams.get('path_prefix');
  if (pathPrefix !== null && pathPrefix !== APP_PROXY_PATH_PREFIX) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
  return { shop, now, token: url.searchParams.get('token') };
}

function normalizeShop(value) {
  if (typeof value !== 'string') throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  const shop = value.trim().toLowerCase();
  if (!SHOP_PATTERN.test(shop)) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
  return shop;
}

function readNow(now) {
  let value;
  try {
    value = now();
  } catch {
    throw new ServiceError('APP_PROXY_CLOCK_UNAVAILABLE');
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ServiceError('APP_PROXY_CLOCK_INVALID');
  }
  return value;
}

async function readDesignRecord(kv, designId) {
  let stored;
  try {
    stored = await kv.get(designId, 'text');
  } catch {
    throw new ServiceError('APP_PROXY_DESIGN_STORAGE_FAILED');
  }
  if (stored === null || stored === undefined) return null;
  return stored;
}

function parseDesignRecord(stored) {
  let record = stored;
  if (typeof stored === 'string') {
    if (encoder.encode(stored).length > MAX_RECORD_BYTES) {
      throw new ServiceError('APP_PROXY_RECORD_TOO_LARGE');
    }
    try {
      record = JSON.parse(stored);
    } catch {
      throw new ServiceError('APP_PROXY_RECORD_JSON_INVALID');
    }
  }
  try {
    assertJsonData(record, new Set());
    if (encoder.encode(JSON.stringify(record)).length > MAX_RECORD_BYTES) {
      throw new RangeError('Design record exceeds its size limit.');
    }
    snapshotExactDataObject(record, [
      'version',
      'designId',
      'bundleId',
      'shop',
      'shopFingerprint',
      'issuedAt',
      'expiresAt',
      'components',
      'quote',
      'normalizedState',
      'productionFiles',
      'summary',
    ], 'Design record');
  } catch {
    throw new ServiceError('APP_PROXY_RECORD_SCHEMA_INVALID');
  }
  return record;
}

async function verifyStoredQuote({ token, record, shop, now, signingSecret }) {
  let expectedShopFingerprint;
  try {
    expectedShopFingerprint = await createShopFingerprint(shop);
  } catch {
    throw new ServiceError('APP_PROXY_SHOP_FINGERPRINT_FAILED');
  }

  validateRecordFields(record);
  let verified;
  try {
    verified = await verifyQuoteContract(token, record.components, signingSecret, {
      now,
      expectedShopFingerprint,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Quote has expired.') {
      throw new ClientError(410, EXPIRED_HANDOFF_MESSAGE);
    }
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }

  let totalMinor;
  try {
    totalMinor = toMinorUnits(record.quote.total, record.quote.currency);
  } catch {
    throw new ServiceError('APP_PROXY_RECORD_QUOTE_INVALID');
  }
  const expected = {
    version: record.version,
    shopFingerprint: record.shopFingerprint,
    bundleId: record.bundleId,
    designId: record.designId,
    totalMinor,
    currency: record.quote.currency,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  };
  for (const key of Object.keys(expected)) {
    if (verified[key] !== expected[key]) {
      throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
    }
  }
  if (record.shop !== shop || record.shopFingerprint !== expectedShopFingerprint) {
    throw new ClientError(400, INVALID_HANDOFF_MESSAGE);
  }
}

function validateRecordFields(record) {
  if (record.version !== QUOTE_SCHEMA_VERSION) {
    throw new ServiceError('APP_PROXY_RECORD_SCHEMA_INVALID');
  }
  if (
    typeof record.designId !== 'string'
    || !DESIGN_ID_PATTERN.test(record.designId)
    || typeof record.bundleId !== 'string'
    || !BUNDLE_ID_PATTERN.test(record.bundleId)
    || typeof record.shopFingerprint !== 'string'
    || !SHOP_FINGERPRINT_PATTERN.test(record.shopFingerprint)
    || typeof record.shop !== 'string'
    || !SHOP_PATTERN.test(record.shop)
    || !Number.isSafeInteger(record.issuedAt)
    || !Number.isSafeInteger(record.expiresAt)
    || record.issuedAt < 0
    || record.issuedAt >= record.expiresAt
  ) {
    throw new ServiceError('APP_PROXY_RECORD_SCHEMA_INVALID');
  }
  try {
    canonicalizeQuoteComponents(record.components);
    const quote = snapshotExactDataObject(record.quote, ['total', 'currency'], 'Record quote');
    if (typeof quote.currency !== 'string' || typeof quote.total !== 'number') throw new TypeError();
    const summary = record.summary;
    if (!isPlainObject(summary)) throw new TypeError();
    const summaryKeys = Object.keys(summary);
    if (
      REQUIRED_SUMMARY_KEYS.some((key) => !Object.hasOwn(summary, key))
      || summaryKeys.some((key) => !SUMMARY_KEYS.has(key))
      || (
        PRODUCTION_SUMMARY_KEYS.some((key) => Object.hasOwn(summary, key))
        && PRODUCTION_SUMMARY_KEYS.some((key) => !Object.hasOwn(summary, key))
      )
    ) {
      throw new TypeError();
    }
    for (const [key, value] of Object.entries(summary)) {
      if (key.length === 0 || typeof value !== 'string') throw new TypeError();
    }
  } catch {
    throw new ServiceError('APP_PROXY_RECORD_SCHEMA_INVALID');
  }
}

function validateLineProperties(properties) {
  const entries = Object.entries(properties);
  if (entries.length > MAX_LINE_PROPERTIES) {
    throw new RangeError('Cart line property count exceeds the limit.');
  }
  for (const [key, value] of entries) {
    if (
      typeof value !== 'string'
      || key.length === 0
      || [...key].length > MAX_PROPERTY_CODE_POINTS
      || [...value].length > MAX_PROPERTY_CODE_POINTS
      || encoder.encode(key).length > MAX_PROPERTY_KEY_BYTES
      || encoder.encode(value).length > MAX_PROPERTY_VALUE_BYTES
    ) {
      throw new RangeError('Cart line property value exceeds the limit.');
    }
  }
}

function assertJsonData(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON number must be finite.');
    return;
  }
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Value must be JSON data.');
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (!Array.isArray(value) && !isPlainObject(value)) throw new TypeError('Value must be plain JSON data.');
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string') throw new TypeError('JSON keys must be strings.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('JSON fields must be enumerable data properties.');
    }
    assertJsonData(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

function snapshotExactDataObject(value, expectedKeys, field) {
  if (!isPlainObject(value)) throw new TypeError(`${field} must be a plain object.`);
  const actualKeys = Reflect.ownKeys(value).filter((key) => Object.prototype.propertyIsEnumerable.call(value, key));
  const expected = new Set(expectedKeys);
  if (actualKeys.some((key) => !expected.has(key)) || expectedKeys.some((key) => !actualKeys.includes(key))) {
    throw new TypeError(`${field} fields are invalid.`);
  }
  const snapshot = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${field} fields are invalid.`);
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function normalizeSecret(secret, field) {
  if (typeof secret !== 'string') throw new TypeError(`${field} must be a string.`);
  const bytes = encoder.encode(secret);
  if (bytes.length < 32) throw new TypeError(`${field} must contain at least 32 UTF-8 bytes.`);
  return bytes;
}

function decodeHex(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function htmlResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function textResponse(status, body, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

function logServiceError(logger, code) {
  try {
    logger.error(code);
  } catch {
    // Logging failures must not change the fail-closed response.
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
