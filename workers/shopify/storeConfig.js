const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const VARIANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const SIZES = Object.freeze(['s', 'm', 'l', 'xl']);
const MAX_SURCHARGE_VARIANTS = 64;

export function normalizeStoreConfig(value) {
  if (!isPlainObject(value)) throw new TypeError('Store config must be an object.');
  const allowed = new Set(['productId', 'currency', 'jerseyVariants', 'surchargeVariants']);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || Object.keys(value).length !== allowed.size) throw new TypeError('Store config fields are invalid.');
  const productId = requirePattern(value.productId, PRODUCT_ID_PATTERN);
  const currency = requirePattern(value.currency, /^[A-Z]{3}$/u);
  const jerseyVariants = normalizeJerseyVariants(value.jerseyVariants);
  const jerseyIds = new Set(Object.values(jerseyVariants));
  const surchargeVariants = normalizeSurchargeVariants(value.surchargeVariants, jerseyIds);
  return Object.freeze({ productId, currency, jerseyVariants, surchargeVariants });
}

export function parseLegacyStoreConfigs(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 * 1024) return Object.freeze({});
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new TypeError('Legacy store config JSON is invalid.'); }
  if (!isPlainObject(parsed)) throw new TypeError('Legacy store configs are invalid.');
  const result = {};
  for (const [shop, config] of Object.entries(parsed)) {
    requirePattern(shop, SHOP_PATTERN);
    result[shop] = normalizeStoreConfig(config);
  }
  return Object.freeze(result);
}

export function readLegacyStoreConfig(value, shop) {
  requirePattern(shop, SHOP_PATTERN);
  return parseLegacyStoreConfigs(value)[shop] ?? null;
}

export function normalizeShop(value) {
  return requirePattern(value, SHOP_PATTERN);
}

function normalizeJerseyVariants(value) {
  if (!isPlainObject(value) || Object.keys(value).length !== SIZES.length) {
    throw new TypeError('Jersey variants must map S, M, L and XL.');
  }
  const result = {};
  for (const size of SIZES) result[size] = requirePattern(value[size], VARIANT_ID_PATTERN);
  if (Object.keys(value).some((size) => !SIZES.includes(size))
    || new Set(Object.values(result)).size !== SIZES.length) {
    throw new TypeError('Jersey variants must be unique.');
  }
  return Object.freeze(result);
}

function normalizeSurchargeVariants(value, jerseyIds) {
  if (!isPlainObject(value) || Object.keys(value).length > MAX_SURCHARGE_VARIANTS) {
    throw new TypeError('Surcharge variants are invalid.');
  }
  const entries = Object.entries(value).sort(([left], [right]) => Number(left) - Number(right));
  const result = {};
  const ids = new Set();
  for (const [amount, variantIdInput] of entries) {
    if (!/^[1-9][0-9]{0,4}$/u.test(amount) || Number(amount) > 10_000) {
      throw new TypeError('Surcharge amount is invalid.');
    }
    const variantId = requirePattern(variantIdInput, VARIANT_ID_PATTERN);
    if (jerseyIds.has(variantId) || ids.has(variantId)) {
      throw new TypeError('Surcharge variants must be unique and separate from jerseys.');
    }
    ids.add(variantId);
    result[amount] = variantId;
  }
  return Object.freeze(result);
}

function requirePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError('Store config value is invalid.');
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
