const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const UPLOAD_ID_PATTERN = /^upl_[A-Za-z0-9_-]{16,64}$/u;
const BUNDLE_ID_PATTERN = /^bun_[A-Za-z0-9_-]{16,64}$/u;
const WEBHOOK_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const ORDER_GID_PATTERN = /^gid:\/\/shopify\/Order\/[1-9][0-9]{0,31}$/u;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const VARIANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OBJECT_KEY_PATTERN = /^[^\u0000-\u001f\u007f\\]{1,1024}$/u;
const BUNDLE_FILENAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}-design-[a-f0-9]{8}\.zip$/u;
const ORDER_NAME_PATTERN = /^.{1,128}$/u;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/u;
const LIFECYCLE_STATUSES = new Set([
  'paid_pending_production',
  'file_error',
  'cancelled',
  'refunded',
]);
const ORDER_TOPICS = new Set(['orders/paid', 'orders/cancelled', 'refunds/create']);
const MAX_CLEANUP_LIMIT = 100;

const DRAFT_INPUT_KEYS = Object.freeze([
  'designId',
  'shop',
  'uploadId',
  'productId',
  'variantId',
  'size',
  'modelId',
  'modelVersion',
  'uvExportVersion',
  'designFingerprint',
  'manifestSha256',
  'manifestKey',
  'bundleKey',
  'bundleFilename',
  'createdAt',
  'expiresAt',
  'updatedAt',
]);

const ROW_COLUMNS = `
  design_id, shop, upload_id, bundle_id, status, product_id, variant_id, size,
  model_id, model_version, uv_export_version, design_fingerprint,
  manifest_sha256, manifest_key, bundle_key, bundle_filename, created_at,
  expires_at, paid_at, shopify_order_gid, shopify_order_name, error_code,
  updated_at
`;

export class ProductionRepositoryError extends Error {
  constructor(code = 'production-repository-failed') {
    const invalid = code === 'invalid-production-repository-input';
    const conflict = code === 'production-repository-conflict';
    super(invalid
      ? 'Production design repository input is invalid.'
      : conflict
        ? 'Production design repository state conflict.'
        : 'Production design repository operation failed.');
    this.code = code;
    this.name = 'ProductionRepositoryError';
  }
}

export function createProductionRepository(db) {
  assertDatabase(db);

  return Object.freeze({
    createCartDraft: (draft) => createCartDraft(db, draft),
    getDesign: (shop, designId) => getDesign(db, shop, designId),
    bindCartQuote: (input) => bindCartQuote(db, input),
    hasWebhookDelivery: (input) => hasWebhookDelivery(db, input),
    recordOrderLifecycle: (input) => recordOrderLifecycle(db, input),
    listExpiredDrafts: (input) => listExpiredDrafts(db, input),
    deleteExpiredDraft: (input) => deleteExpiredDraft(db, input),
  });
}

async function createCartDraft(db, input) {
  const draft = validateDraft(input);
  const insert = prepareBound(db, `
    INSERT OR IGNORE INTO production_designs (
      design_id, shop, upload_id, bundle_id, status, product_id, variant_id,
      size, model_id, model_version, uv_export_version, design_fingerprint,
      manifest_sha256, manifest_key, bundle_key, bundle_filename, created_at,
      expires_at, paid_at, shopify_order_gid, shopify_order_name, error_code,
      updated_at
    ) VALUES (
      ?, ?, ?, NULL, 'cart_draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      NULL, NULL, NULL, NULL, ?
    )
  `, [
    draft.designId,
    draft.shop,
    draft.uploadId,
    draft.productId,
    draft.variantId,
    draft.size,
    draft.modelId,
    draft.modelVersion,
    draft.uvExportVersion,
    draft.designFingerprint,
    draft.manifestSha256,
    draft.manifestKey,
    draft.bundleKey,
    draft.bundleFilename,
    draft.createdAt,
    draft.expiresAt,
    draft.updatedAt,
  ]);
  const select = prepareBound(db, `
    SELECT ${ROW_COLUMNS}
    FROM production_designs
    WHERE shop = ? AND upload_id = ?
    LIMIT 1
  `, [draft.shop, draft.uploadId]);

  const results = await executeBatch(db, [insert, select]);
  const row = firstBatchRow(results, 1);
  if (!row) throw new ProductionRepositoryError();
  return normalizeRow(row);
}

async function getDesign(db, shopInput, designIdInput) {
  const shop = requirePattern(shopInput, SHOP_PATTERN);
  const designId = requirePattern(designIdInput, DESIGN_ID_PATTERN);
  const row = await executeFirst(prepareBound(db, `
    SELECT ${ROW_COLUMNS}
    FROM production_designs
    WHERE shop = ? AND design_id = ?
    LIMIT 1
  `, [shop, designId]));
  return row ? normalizeRow(row) : null;
}

async function bindCartQuote(db, input) {
  const value = readExactDataProperties(input, ['shop', 'designId', 'bundleId', 'updatedAt']);
  if (!value) throw invalidInput();
  const shop = requirePattern(value.shop, SHOP_PATTERN);
  const designId = requirePattern(value.designId, DESIGN_ID_PATTERN);
  const bundleId = requirePattern(value.bundleId, BUNDLE_ID_PATTERN);
  const updatedAt = requireTimestamp(value.updatedAt);

  const update = prepareBound(db, `
    UPDATE production_designs
    SET bundle_id = ?, updated_at = ?
    WHERE shop = ? AND design_id = ?
      AND status = 'cart_draft'
      AND expires_at > ?
      AND (bundle_id IS NULL OR bundle_id = ?)
  `, [bundleId, updatedAt, shop, designId, updatedAt, bundleId]);
  const select = prepareBound(db, `
    SELECT ${ROW_COLUMNS}
    FROM production_designs
    WHERE shop = ? AND design_id = ?
    LIMIT 1
  `, [shop, designId]);
  const results = await executeBatch(db, [update, select]);
  const row = firstBatchRow(results, 1);
  if (!row) throw new ProductionRepositoryError('production-repository-conflict');
  const normalized = normalizeRow(row);
  if (
    normalized.status !== 'cart_draft'
    || normalized.expiresAt <= updatedAt
    || normalized.bundleId !== bundleId
  ) throw new ProductionRepositoryError('production-repository-conflict');
  return normalized;
}

async function hasWebhookDelivery(db, input) {
  const value = readExactDataProperties(input, ['shop', 'webhookId']);
  if (!value) throw invalidInput();
  const shop = requirePattern(value.shop, SHOP_PATTERN);
  const webhookId = requirePattern(value.webhookId, WEBHOOK_ID_PATTERN);
  const row = await executeFirst(prepareBound(db, `
    SELECT webhook_id
    FROM shopify_webhook_deliveries
    WHERE shop = ? AND webhook_id = ?
    LIMIT 1
  `, [shop, webhookId]));
  return row !== null;
}

async function recordOrderLifecycle(db, input) {
  const request = readExactDataProperties(input, ['delivery', 'designs', 'status']);
  if (!request || !LIFECYCLE_STATUSES.has(request.status)) throw invalidInput();
  const delivery = validateDelivery(request.delivery);
  const designs = readExactArray(request.designs);
  if (!designs || designs.length === 0 || designs.length > 250) throw invalidInput();
  assertStatusTopic(request.status, delivery.topic);

  const paidLifecycle = request.status === 'paid_pending_production' || request.status === 'file_error';
  const normalizedDesigns = paidLifecycle
    ? designs.map((design) => validatePaidDesign(design, request.status))
    : designs.map(validateTerminalDesign);
  const updates = paidLifecycle
    ? normalizedDesigns.map((design) => preparePaidUpdate(db, delivery, design, request.status))
    : normalizedDesigns.map((design) => prepareTerminalUpdate(db, delivery, design, request.status));
  const receipt = prepareBound(db, `
    INSERT OR IGNORE INTO shopify_webhook_deliveries (
      webhook_id, event_id, shop, topic, order_gid, received_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, [
    delivery.webhookId,
    delivery.eventId,
    delivery.shop,
    delivery.topic,
    delivery.orderGid,
    delivery.receivedAt,
  ]);

  await executeBatch(db, [...updates, receipt]);
  return Object.freeze({
    webhookId: delivery.webhookId,
    status: request.status,
    designCount: designs.length,
  });
}

async function listExpiredDrafts(db, input) {
  const value = readExactDataProperties(input, ['before', 'limit']);
  if (!value) throw invalidInput();
  const before = requireTimestamp(value.before);
  if (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > MAX_CLEANUP_LIMIT) {
    throw invalidInput();
  }
  const result = await executeAll(prepareBound(db, `
    SELECT shop, design_id, manifest_key, bundle_key, expires_at
    FROM production_designs
    WHERE status = 'cart_draft' AND expires_at < ?
    ORDER BY expires_at ASC, design_id ASC
    LIMIT ?
  `, [before, value.limit]));
  return Object.freeze(result.map((row) => Object.freeze({
    shop: row.shop,
    designId: row.design_id,
    manifestKey: row.manifest_key,
    bundleKey: row.bundle_key,
    expiresAt: row.expires_at,
  })));
}

async function deleteExpiredDraft(db, input) {
  const value = readExactDataProperties(input, ['shop', 'designId', 'expiresAt']);
  if (!value) throw invalidInput();
  const shop = requirePattern(value.shop, SHOP_PATTERN);
  const designId = requirePattern(value.designId, DESIGN_ID_PATTERN);
  const expiresAt = requireTimestamp(value.expiresAt);
  const result = await executeRun(prepareBound(db, `
    DELETE FROM production_designs
    WHERE shop = ? AND design_id = ? AND expires_at = ?
      AND status = 'cart_draft'
  `, [shop, designId, expiresAt]));
  return Number.isSafeInteger(result?.meta?.changes) && result.meta.changes > 0;
}

function preparePaidUpdate(db, delivery, input, status) {
  return prepareBound(db, `
    UPDATE production_designs
    SET status = ?, shopify_order_gid = ?, shopify_order_name = ?, paid_at = ?,
      error_code = ?, updated_at = ?
    WHERE shop = ? AND design_id = ? AND bundle_id = ?
      AND status IN ('cart_draft', 'paid_pending_production', 'file_error')
      AND (shopify_order_gid IS NULL OR shopify_order_gid = ?)
  `, [
    status,
    delivery.orderGid,
    input.orderName,
    input.paidAt,
    input.errorCode,
    input.updatedAt,
    delivery.shop,
    input.designId,
    input.bundleId,
    delivery.orderGid,
  ]);
}

function prepareTerminalUpdate(db, delivery, input, status) {
  return prepareBound(db, `
    UPDATE production_designs
    SET status = ?, updated_at = ?
    WHERE shop = ? AND design_id = ? AND shopify_order_gid = ?
      AND status IN ('paid_pending_production', 'file_error', 'cancelled', 'refunded')
  `, [status, input.updatedAt, delivery.shop, input.designId, delivery.orderGid]);
}

function validatePaidDesign(input, status) {
  const design = readExactDataProperties(input, [
    'designId', 'bundleId', 'orderName', 'paidAt', 'updatedAt', 'errorCode',
  ]);
  if (!design) throw invalidInput();
  const value = Object.freeze({
    designId: requirePattern(design.designId, DESIGN_ID_PATTERN),
    bundleId: requirePattern(design.bundleId, BUNDLE_ID_PATTERN),
    orderName: requirePattern(design.orderName, ORDER_NAME_PATTERN),
    paidAt: requireTimestamp(design.paidAt),
    updatedAt: requireTimestamp(design.updatedAt),
    errorCode: status === 'file_error'
      ? requirePattern(design.errorCode, ERROR_CODE_PATTERN)
      : requireNull(design.errorCode),
  });
  if (value.updatedAt < value.paidAt) throw invalidInput();
  return value;
}

function validateTerminalDesign(input) {
  const design = readExactDataProperties(input, ['designId', 'updatedAt']);
  if (!design) throw invalidInput();
  return Object.freeze({
    designId: requirePattern(design.designId, DESIGN_ID_PATTERN),
    updatedAt: requireTimestamp(design.updatedAt),
  });
}

function validateDraft(input) {
  const draft = readExactDataProperties(input, DRAFT_INPUT_KEYS);
  if (!draft) throw invalidInput();
  const value = {
    designId: requirePattern(draft.designId, DESIGN_ID_PATTERN),
    shop: requirePattern(draft.shop, SHOP_PATTERN),
    uploadId: requirePattern(draft.uploadId, UPLOAD_ID_PATTERN),
    productId: requirePattern(draft.productId, PRODUCT_ID_PATTERN),
    variantId: draft.variantId === null ? null : requirePattern(draft.variantId, VARIANT_ID_PATTERN),
    size: requirePattern(draft.size, SAFE_ID_PATTERN),
    modelId: requirePattern(draft.modelId, SAFE_ID_PATTERN),
    modelVersion: requirePattern(draft.modelVersion, SAFE_ID_PATTERN),
    uvExportVersion: requirePattern(draft.uvExportVersion, SAFE_ID_PATTERN),
    designFingerprint: requirePattern(draft.designFingerprint, FINGERPRINT_PATTERN),
    manifestSha256: requirePattern(draft.manifestSha256, SHA256_PATTERN),
    manifestKey: requirePattern(draft.manifestKey, OBJECT_KEY_PATTERN),
    bundleKey: requirePattern(draft.bundleKey, OBJECT_KEY_PATTERN),
    bundleFilename: requirePattern(draft.bundleFilename, BUNDLE_FILENAME_PATTERN),
    createdAt: requireTimestamp(draft.createdAt),
    expiresAt: requireTimestamp(draft.expiresAt),
    updatedAt: requireTimestamp(draft.updatedAt),
  };
  if (
    value.expiresAt <= value.createdAt
    || value.updatedAt < value.createdAt
    || value.manifestKey === value.bundleKey
  ) throw invalidInput();
  return Object.freeze(value);
}

function validateDelivery(input) {
  const value = readExactDataProperties(input, [
    'webhookId', 'eventId', 'shop', 'topic', 'orderGid', 'receivedAt',
  ]);
  if (!value || !ORDER_TOPICS.has(value.topic)) throw invalidInput();
  return Object.freeze({
    webhookId: requirePattern(value.webhookId, WEBHOOK_ID_PATTERN),
    eventId: value.eventId === null ? null : requirePattern(value.eventId, EVENT_ID_PATTERN),
    shop: requirePattern(value.shop, SHOP_PATTERN),
    topic: value.topic,
    orderGid: requirePattern(value.orderGid, ORDER_GID_PATTERN),
    receivedAt: requireTimestamp(value.receivedAt),
  });
}

function assertStatusTopic(status, topic) {
  if (
    ((status === 'paid_pending_production' || status === 'file_error') && topic !== 'orders/paid')
    || (status === 'cancelled' && topic !== 'orders/cancelled')
    || (status === 'refunded' && topic !== 'refunds/create')
  ) throw invalidInput();
}

function normalizeRow(row) {
  if (!isPlainObject(row)) throw new ProductionRepositoryError();
  return Object.freeze({
    designId: row.design_id,
    shop: row.shop,
    uploadId: row.upload_id,
    bundleId: row.bundle_id,
    status: row.status,
    productId: row.product_id,
    variantId: row.variant_id,
    size: row.size,
    modelId: row.model_id,
    modelVersion: row.model_version,
    uvExportVersion: row.uv_export_version,
    designFingerprint: row.design_fingerprint,
    manifestSha256: row.manifest_sha256,
    manifestKey: row.manifest_key,
    bundleKey: row.bundle_key,
    bundleFilename: row.bundle_filename,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    shopifyOrderGid: row.shopify_order_gid,
    shopifyOrderName: row.shopify_order_name,
    errorCode: row.error_code,
    updatedAt: row.updated_at,
  });
}

async function executeBatch(db, statements) {
  try {
    const result = await db.batch(statements);
    if (!Array.isArray(result)) throw new TypeError('Invalid D1 batch result.');
    return result;
  } catch {
    throw new ProductionRepositoryError();
  }
}

async function executeFirst(statement) {
  try {
    return await statement.first();
  } catch {
    throw new ProductionRepositoryError();
  }
}

async function executeAll(statement) {
  try {
    const result = await statement.all();
    if (!Array.isArray(result?.results)) throw new TypeError('Invalid D1 result.');
    return result.results;
  } catch {
    throw new ProductionRepositoryError();
  }
}

async function executeRun(statement) {
  try {
    return await statement.run();
  } catch {
    throw new ProductionRepositoryError();
  }
}

function firstBatchRow(results, index) {
  const rows = results[index]?.results;
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

function prepareBound(db, sql, values) {
  try {
    return db.prepare(sql).bind(...values);
  } catch {
    throw new ProductionRepositoryError();
  }
}

function assertDatabase(db) {
  if (
    (db === null || (typeof db !== 'object' && typeof db !== 'function'))
    || typeof db.prepare !== 'function'
    || typeof db.batch !== 'function'
  ) throw new ProductionRepositoryError('invalid-production-repository-input');
}

function requirePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalidInput();
  return value;
}

function requireTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidInput();
  return value;
}

function requireNull(value) {
  if (value !== null) throw invalidInput();
  return null;
}

function invalidInput() {
  return new ProductionRepositoryError('invalid-production-repository-input');
}

function readExactDataProperties(value, expectedKeys) {
  if (!isPlainObject(value)) return null;
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const actualKeys = Reflect.ownKeys(descriptors);
  if (
    actualKeys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
    || actualKeys.some((key) => typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value'))
  ) return null;
  return Object.fromEntries(expectedKeys.map((key) => [key, descriptors[key].value]));
}

function readExactArray(value) {
  if (!Array.isArray(value)) return null;
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const keys = Reflect.ownKeys(descriptors);
  const expectedKeys = [
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    'length',
  ];
  if (
    keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
    || expectedKeys.some((key) => !Object.hasOwn(descriptors[key], 'value'))
  ) return null;
  return expectedKeys.slice(0, -1).map((key) => descriptors[key].value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
