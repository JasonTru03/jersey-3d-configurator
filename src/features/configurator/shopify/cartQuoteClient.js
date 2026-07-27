const SHOP_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const BUNDLE_ID_PATTERN = /^bun_[A-Za-z0-9_-]{16,64}$/u;
const HANDOFF_PATH = '/apps/jersey-configurator/cart-handoff';
const MAX_TOKEN_LENGTH = 255;
const MAX_SERVER_ERROR_LENGTH = 200;
const GENERIC_ERROR = 'Secure cart preparation failed.';
const PRODUCTION_FILE_KEYS = [
  'atlasFilename',
  'atlasSha256',
  'bundleFilename',
  'designFilename',
];
const SHOPIFY_CONTEXT_KEYS = [
  'shop',
  'productHandle',
  'returnPath',
  'surchargeVariantMap',
  'variantId',
  'variantMap',
  'initialLayout',
];

export async function createSecureCartHandoff({
  endpoint = '/api/cart-quotes',
  context,
  state,
  productionFiles,
  fetchImpl = fetch,
}) {
  assertRequest(endpoint, context, state, productionFiles, fetchImpl);
  const receipt = productionFiles === undefined || productionFiles === null
    ? null
    : snapshotProductionFiles(productionFiles);

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        shop: context.shop,
        state,
        productionFiles: receipt,
      }),
    });
  } catch {
    throw new Error(GENERIC_ERROR);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(GENERIC_ERROR);
  }

  if (!response.ok) {
    throw new Error(getServerError(body) ?? GENERIC_ERROR);
  }

  try {
    return snapshotResponse(body, context.shop);
  } catch {
    throw new Error(GENERIC_ERROR);
  }
}

function assertRequest(endpoint, context, state, productionFiles, fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!isValidShopifyContext(context)) {
    throw new TypeError('A valid Shopify launch context is required.');
  }
  if (!isPlainObject(state)) throw new TypeError('A design state is required.');
  assertSameOriginEndpoint(endpoint);
  if (productionFiles !== undefined && productionFiles !== null) {
    snapshotProductionFiles(productionFiles);
  }
}

function isValidShopifyContext(context) {
  try {
    assertExactPlainObject(context, SHOPIFY_CONTEXT_KEYS, 'Shopify context');
  } catch {
    return false;
  }
  if (
    !SHOP_DOMAIN_PATTERN.test(context.shop ?? '')
    || typeof context.productHandle !== 'string'
    || typeof context.returnPath !== 'string'
    || typeof context.variantId !== 'string'
    || !isValidVariantMap(context.variantMap, false)
    || !isValidVariantMap(context.surchargeVariantMap, true)
  ) return false;
  return context.initialLayout === undefined
    || (typeof context.initialLayout === 'string'
      && Object.prototype.hasOwnProperty.call(context.variantMap, context.initialLayout));
}

function isValidVariantMap(value, nullable) {
  if (nullable && value === null) return true;
  if (!isPlainObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([, variantId]) => (
    typeof variantId === 'string' && /^[0-9]+$/u.test(variantId)
  ));
}

function assertSameOriginEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.startsWith('//')) {
    throw new TypeError('Cart quote endpoint must be same-origin.');
  }
  let url;
  try {
    url = new URL(endpoint, window.location.href);
  } catch {
    throw new TypeError('Cart quote endpoint must be same-origin.');
  }
  if (
    url.origin !== window.location.origin
    || url.username
    || url.password
    || url.hash
  ) {
    throw new TypeError('Cart quote endpoint must be same-origin.');
  }
}

function snapshotProductionFiles(value) {
  assertExactPlainObject(value, PRODUCTION_FILE_KEYS, 'Production files');
  const snapshot = {};
  for (const key of PRODUCTION_FILE_KEYS) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new TypeError(`Production files ${key} is invalid.`);
    }
    snapshot[key] = value[key];
  }
  return snapshot;
}

function snapshotResponse(body, shop) {
  const keys = ['handoffUrl', 'designId', 'bundleId', 'expiresAt'];
  assertExactPlainObject(body, keys, 'Cart quote response');
  if (typeof body.handoffUrl !== 'string' || !isSafeHandoffUrl(body.handoffUrl, shop)) {
    throw new TypeError('Cart quote handoff URL is invalid.');
  }
  if (typeof body.designId !== 'string' || !DESIGN_ID_PATTERN.test(body.designId)) {
    throw new TypeError('Cart quote design ID is invalid.');
  }
  if (typeof body.bundleId !== 'string' || !BUNDLE_ID_PATTERN.test(body.bundleId)) {
    throw new TypeError('Cart quote bundle ID is invalid.');
  }
  if (!Number.isSafeInteger(body.expiresAt) || body.expiresAt <= Date.now()) {
    throw new TypeError('Cart quote expiry is invalid.');
  }
  return {
    handoffUrl: body.handoffUrl,
    designId: body.designId,
    bundleId: body.bundleId,
    expiresAt: body.expiresAt,
  };
}

function isSafeHandoffUrl(value, shop) {
  if (!value.startsWith(`https://${shop}/`)) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== shop
    || url.port
    || url.username
    || url.password
    || url.hash
    || url.pathname !== HANDOFF_PATH
  ) return false;
  const queryKeys = [...url.searchParams.keys()];
  const tokens = url.searchParams.getAll('token');
  return queryKeys.length === 1
    && queryKeys[0] === 'token'
    && tokens.length === 1
    && tokens[0].length > 0
    && tokens[0].length <= MAX_TOKEN_LENGTH;
}

function getServerError(body) {
  if (!isPlainObject(body) || typeof body.error !== 'string') return null;
  if (
    body.error.length === 0
    || body.error.length > MAX_SERVER_ERROR_LENGTH
    || /[\x00-\x1F\x7F]/u.test(body.error)
  ) return null;
  return body.error;
}

function assertExactPlainObject(value, expectedKeys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object.`);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) throw new TypeError(`${label} fields are invalid.`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
