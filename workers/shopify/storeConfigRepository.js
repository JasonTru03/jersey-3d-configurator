import { normalizeShop, normalizeStoreConfig, readLegacyStoreConfig } from './storeConfig.js';

const STATUS_VALUES = new Set(['draft', 'active', 'activation_failed']);
const GID_PATTERN = /^gid:\/\/shopify\/[A-Za-z][A-Za-z0-9]+\/[1-9][0-9]{0,31}$/u;
const LOCK_PATTERN = /^[A-Za-z0-9_-]{24,128}$/u;

export function createStoreConfigRepository(db, { legacyConfigJson = '{}' } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('Store config database is invalid.');
  return Object.freeze({
    get: (shop) => get(db, legacyConfigJson, shop),
    saveDraft: (input) => saveDraft(db, input),
    markActive: (input) => markActive(db, input),
    markActivationFailed: (input) => markActivationFailed(db, input),
    deleteShop: (shop) => deleteShop(db, shop),
  });
}

async function get(db, legacyConfigJson, shopInput) {
  const shop = normalizeShop(shopInput);
  let row;
  try {
    row = await db.prepare(`
    SELECT shop, status, revision, shopify_product_gid, product_id, currency, jersey_variants_json,
        surcharge_variants_json, signing_secret_ciphertext, signing_secret_iv,
        signing_secret_key_version, transform_registration_id,
        validation_registration_id, last_error_code, created_at, updated_at, activated_at
      FROM shopify_store_configs WHERE shop = ? LIMIT 1
    `).bind(shop).first();
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    row = null;
  }
  if (row) return normalizeRow(row);
  const legacy = readLegacyStoreConfig(legacyConfigJson, shop);
  return legacy ? Object.freeze({
    shop,
    source: 'legacy',
    status: 'active',
    revision: 0,
    config: legacy,
    shopifyProductGid: null,
    encryptedSigningSecret: null,
    transformRegistrationId: null,
    validationRegistrationId: null,
    lastErrorCode: null,
    createdAt: null,
    updatedAt: null,
    activatedAt: null,
  }) : null;
}

function isMissingTableError(error) {
  return error instanceof Error && /no such table:\s*shopify_store_configs/iu.test(error.message);
}

async function saveDraft(db, input) {
  const value = validateDraft(input);
  const existing = await db.prepare('SELECT revision, created_at FROM shopify_store_configs WHERE shop = ?')
    .bind(value.shop).first();
  const revision = existing ? Number(existing.revision) + 1 : 1;
  const createdAt = existing ? Number(existing.created_at) : value.updatedAt;
  const result = await db.prepare(`
    INSERT INTO shopify_store_configs (
      shop, status, revision, shopify_product_gid, product_id, currency, jersey_variants_json,
      surcharge_variants_json, signing_secret_ciphertext, signing_secret_iv,
      signing_secret_key_version, activation_lock_token, activation_lock_expires_at,
      transform_registration_id,
      validation_registration_id, last_error_code, created_at, updated_at, activated_at
    ) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)
    ON CONFLICT(shop) DO UPDATE SET
      status = 'draft', revision = excluded.revision,
      shopify_product_gid = excluded.shopify_product_gid,
      product_id = excluded.product_id, currency = excluded.currency,
      jersey_variants_json = excluded.jersey_variants_json,
      surcharge_variants_json = excluded.surcharge_variants_json,
      signing_secret_ciphertext = excluded.signing_secret_ciphertext,
      signing_secret_iv = excluded.signing_secret_iv,
      signing_secret_key_version = excluded.signing_secret_key_version,
      activation_lock_token = excluded.activation_lock_token,
      activation_lock_expires_at = excluded.activation_lock_expires_at,
      transform_registration_id = NULL, validation_registration_id = NULL,
      last_error_code = NULL, updated_at = excluded.updated_at, activated_at = NULL
    WHERE shopify_store_configs.activation_lock_expires_at IS NULL
      OR shopify_store_configs.activation_lock_expires_at < excluded.updated_at
  `).bind(
    value.shop, revision, value.shopifyProductGid, value.config.productId, value.config.currency,
    JSON.stringify(value.config.jerseyVariants), JSON.stringify(value.config.surchargeVariants),
    value.encryptedSigningSecret.ciphertext, value.encryptedSigningSecret.iv,
    value.encryptedSigningSecret.keyVersion, value.activationLockToken,
    value.activationLockExpiresAt, createdAt, value.updatedAt,
  ).run();
  assertChanged(result);
  return revision;
}

async function markActive(db, input) {
  const value = validateStatusChange(input, 'active');
  const result = await db.prepare(`
    UPDATE shopify_store_configs
    SET status = 'active', transform_registration_id = ?,
      validation_registration_id = ?, last_error_code = NULL,
      activation_lock_token = NULL, activation_lock_expires_at = NULL,
      updated_at = ?, activated_at = ?
    WHERE shop = ? AND revision = ? AND status = 'draft' AND activation_lock_token = ?
  `).bind(
    value.transformRegistrationId,
    value.validationRegistrationId,
    value.updatedAt,
    value.updatedAt,
    value.shop,
    value.revision,
    value.activationLockToken,
  ).run();
  assertChanged(result);
}

async function markActivationFailed(db, input) {
  const value = validateStatusChange(input, 'activation_failed');
  const result = await db.prepare(`
    UPDATE shopify_store_configs
    SET status = 'activation_failed', last_error_code = ?,
      activation_lock_token = NULL, activation_lock_expires_at = NULL, updated_at = ?
    WHERE shop = ? AND revision = ? AND status = 'draft' AND activation_lock_token = ?
  `).bind(
    value.errorCode, value.updatedAt, value.shop, value.revision, value.activationLockToken,
  ).run();
  assertChanged(result);
}

async function deleteShop(db, shopInput) {
  const shop = normalizeShop(shopInput);
  await db.prepare('DELETE FROM shopify_store_configs WHERE shop = ?').bind(shop).run();
}

function normalizeRow(row) {
  let jerseyVariants;
  let surchargeVariants;
  try {
    jerseyVariants = JSON.parse(row.jersey_variants_json);
    surchargeVariants = JSON.parse(row.surcharge_variants_json);
  } catch { throw new StoreConfigRepositoryError(); }
  return Object.freeze({
    shop: normalizeShop(row.shop),
    source: 'database',
    status: requireSet(row.status, STATUS_VALUES),
    revision: requireInteger(row.revision),
    config: normalizeStoreConfig({
      productId: row.product_id,
      currency: row.currency,
      jerseyVariants,
      surchargeVariants,
    }),
    shopifyProductGid: requireGidType(row.shopify_product_gid, 'Product'),
    encryptedSigningSecret: Object.freeze({
      ciphertext: requireString(row.signing_secret_ciphertext, 32, 4096),
      iv: requireString(row.signing_secret_iv, 16, 24),
      keyVersion: requireInteger(row.signing_secret_key_version),
    }),
    transformRegistrationId: nullableGid(row.transform_registration_id),
    validationRegistrationId: nullableGid(row.validation_registration_id),
    lastErrorCode: row.last_error_code,
    createdAt: requireInteger(row.created_at),
    updatedAt: requireInteger(row.updated_at),
    activatedAt: row.activated_at === null ? null : requireInteger(row.activated_at),
  });
}

function validateDraft(input) {
  if (!isPlainObject(input)) throw invalidInput();
  const value = {
    shop: normalizeShop(input.shop),
    config: normalizeStoreConfig(input.config),
    shopifyProductGid: requireGidType(input.shopifyProductGid, 'Product'),
    encryptedSigningSecret: {
      ciphertext: requireString(input.encryptedSigningSecret?.ciphertext, 32, 4096),
      iv: requireString(input.encryptedSigningSecret?.iv, 16, 24),
      keyVersion: requireInteger(input.encryptedSigningSecret?.keyVersion),
    },
    activationLockToken: requirePattern(input.activationLockToken, LOCK_PATTERN),
    activationLockExpiresAt: requireInteger(input.activationLockExpiresAt),
    updatedAt: requireInteger(input.updatedAt),
  };
  if (value.activationLockExpiresAt <= value.updatedAt
    || value.activationLockExpiresAt - value.updatedAt > 30 * 60 * 1000) throw invalidInput();
  return value;
}

function validateStatusChange(input, status) {
  if (!isPlainObject(input)) throw invalidInput();
  const value = {
    shop: normalizeShop(input.shop),
    revision: requireInteger(input.revision),
    updatedAt: requireInteger(input.updatedAt),
    activationLockToken: requirePattern(input.activationLockToken, LOCK_PATTERN),
  };
  if (status === 'active') {
    value.transformRegistrationId = requireGid(input.transformRegistrationId);
    value.validationRegistrationId = requireGid(input.validationRegistrationId);
  } else {
    value.errorCode = requireString(input.errorCode, 3, 100);
  }
  return value;
}

function nullableGid(value) {
  return value === null ? null : requireGid(value);
}

function requireGid(value) {
  if (typeof value !== 'string' || !GID_PATTERN.test(value)) throw invalidInput();
  return value;
}

function requireGidType(value, type) {
  const gid = requireGid(value);
  if (!gid.startsWith(`gid://shopify/${type}/`)) throw invalidInput();
  return gid;
}

function requireString(value, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) throw invalidInput();
  return value;
}

function requireInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw invalidInput();
  return number;
}

function requireSet(value, allowed) {
  if (!allowed.has(value)) throw invalidInput();
  return value;
}

function requirePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalidInput();
  return value;
}

function assertChanged(result) {
  if (result?.success !== true || (result.meta?.changes ?? 0) < 1) throw new StoreConfigRepositoryError('store-config-conflict');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidInput() {
  return new StoreConfigRepositoryError('invalid-store-config-input');
}

export class StoreConfigRepositoryError extends Error {
  constructor(code = 'store-config-repository-failed') {
    super('Shopify store config repository operation failed.');
    this.name = 'StoreConfigRepositoryError';
    this.code = code;
  }
}
