import path from 'node:path';

const MINIMUM_SECRET_BYTES = 32;

export function readServerConfig({ source = process.env, projectRoot = process.cwd() } = {}) {
  if (!source || typeof source !== 'object' || !path.isAbsolute(projectRoot)) {
    throw configurationError('source');
  }
  const port = readPort(source.PORT ?? '8080');
  const publicOrigin = readPublicOrigin(source.PUBLIC_ORIGIN);
  const trustProxy = readBoolean(source.TRUST_PROXY ?? 'false', 'TRUST_PROXY');
  const localProductionFiles = source.LOCAL_PRODUCTION_FILES;
  if (localProductionFiles !== 'false') throw configurationError('LOCAL_PRODUCTION_FILES');
  const shopifyStoreConfigJson = readStoreConfig(source.SHOPIFY_STORE_CONFIG_JSON);
  const shopifyApiSecret = readSecret(source.SHOPIFY_API_SECRET, 'SHOPIFY_API_SECRET');
  const cartQuoteSigningSecret = readSecret(
    source.CART_QUOTE_SIGNING_SECRET,
    'CART_QUOTE_SIGNING_SECRET',
  );
  const turnstileSecretKey = readSecret(source.TURNSTILE_SECRET_KEY, 'TURNSTILE_SECRET_KEY');
  const turnstileSiteKey = readNonEmpty(source.TURNSTILE_SITE_KEY, 'TURNSTILE_SITE_KEY');
  const dataDirectory = resolveDirectory(source.DATA_DIR ?? '/data', projectRoot, 'DATA_DIR');
  const distDirectory = resolveDirectory(source.DIST_DIR ?? 'dist', projectRoot, 'DIST_DIR');

  return Object.freeze({
    cartQuoteSigningSecret,
    dataDirectory,
    distDirectory,
    localProductionFiles,
    port,
    projectRoot,
    publicOrigin,
    shopifyApiSecret,
    shopifyStoreConfigJson,
    trustProxy,
    turnstileSecretKey,
    turnstileSiteKey,
  });
}

function readPort(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,4}$/u.test(value)) {
    throw configurationError('PORT');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) throw configurationError('PORT');
  return port;
}

function readPublicOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw configurationError('PUBLIC_ORIGIN');
  }
  if (url.protocol !== 'https:'
    || url.origin !== value
    || url.username
    || url.password
    || url.pathname !== '/') {
    throw configurationError('PUBLIC_ORIGIN');
  }
  return url.origin;
}

function readBoolean(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw configurationError(name);
}

function readStoreConfig(value) {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 1024 * 1024) {
    throw configurationError('SHOPIFY_STORE_CONFIG_JSON');
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw configurationError('SHOPIFY_STORE_CONFIG_JSON');
  }
  if (!isPlainObject(parsed) || Object.keys(parsed).length === 0) {
    throw configurationError('SHOPIFY_STORE_CONFIG_JSON');
  }
  return value;
}

function readSecret(value, name) {
  const result = readNonEmpty(value, name);
  if (result.startsWith('CHANGE_ME')
    || Buffer.byteLength(result) < MINIMUM_SECRET_BYTES
    || Buffer.byteLength(result) > 4096) {
    throw configurationError(name);
  }
  return result;
}

function readNonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4096) {
    throw configurationError(name);
  }
  return value;
}

function resolveDirectory(value, projectRoot, name) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\u0000')) {
    throw configurationError(name);
  }
  return path.resolve(projectRoot, value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function configurationError(name) {
  return new TypeError(`Server configuration is invalid: ${name}.`);
}
