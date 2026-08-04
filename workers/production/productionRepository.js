import {
  createPaidLifecycleStatementSpecs,
  createTerminalLifecycleStatementSpecs,
} from './productionLifecycleSql.js';

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
const CLEANUP_TOKEN_PATTERN = /^cln_[A-Za-z0-9_-]{16,124}$/u;
const UPLOAD_TOKEN_PATTERN = /^upt_[A-Za-z0-9_-]{16,124}$/u;
const LIFECYCLE_STATUSES = new Set([
  'paid_pending_production',
  'file_error',
  'cancelled',
  'refunded',
]);
const ORDER_TOPICS = new Set(['orders/paid', 'orders/cancelled', 'refunds/create']);
const ALL_STATUSES = new Set([
  'upload_pending',
  'cart_draft',
  'paid_pending_production',
  'file_error',
  'cancelled',
  'refunded',
  'cleanup_pending',
  'archived',
]);
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
const UPLOAD_PENDING_INPUT_KEYS = Object.freeze([
  ...DRAFT_INPUT_KEYS,
  'uploadToken',
  'uploadStartedAt',
]);

const ROW_COLUMNS = `
  design_id, shop, upload_id, bundle_id, status, product_id, variant_id, size,
  model_id, model_version, uv_export_version, design_fingerprint,
  manifest_sha256, manifest_key, bundle_key, bundle_filename, created_at,
  expires_at, paid_at, shopify_order_gid, shopify_order_name, error_code,
  upload_token, upload_started_at, cleanup_token, cleanup_started_at, updated_at
`;
const ROW_COLUMN_KEYS = Object.freeze([
  'design_id', 'shop', 'upload_id', 'bundle_id', 'status', 'product_id',
  'variant_id', 'size', 'model_id', 'model_version', 'uv_export_version',
  'design_fingerprint', 'manifest_sha256', 'manifest_key', 'bundle_key',
  'bundle_filename', 'created_at', 'expires_at', 'paid_at', 'shopify_order_gid',
  'shopify_order_name', 'error_code', 'upload_token', 'upload_started_at',
  'cleanup_token', 'cleanup_started_at', 'updated_at',
]);

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
    createUploadPending: (draft) => createUploadPending(db, draft),
    createCartDraft: (draft) => createCartDraft(db, draft),
    finalizeCartDraft: (input) => finalizeCartDraft(db, input),
    takeOverStaleUpload: (input) => takeOverStaleUpload(db, input),
    claimOwnedUploadCleanup: (input) => claimOwnedUploadCleanup(db, input),
    getDesign: (shop, designId) => getDesign(db, shop, designId),
    getCartDraftByUpload: (shop, uploadId) => getCartDraftByUpload(db, shop, uploadId),
    bindCartQuote: (input) => bindCartQuote(db, input),
    hasWebhookDelivery: (input) => hasWebhookDelivery(db, input),
    hasWebhookEvent: (input) => hasWebhookEvent(db, input),
    recordOrderLifecycle: (input) => recordOrderLifecycle(db, input),
    listExpiredDrafts: (input) => listExpiredDrafts(db, input),
    claimExpiredDraft: (input) => claimExpiredDraft(db, input),
    deleteClaimedDraft: (input) => deleteClaimedDraft(db, input),
  });
}

async function createCartDraft(db, input) {
  return createDraftWithStatus(db, validateDraft(input), 'cart_draft', null);
}

async function createUploadPending(db, input) {
  const pending = validateUploadPending(input);
  return createDraftWithStatus(db, pending, 'upload_pending', pending);
}

async function createDraftWithStatus(db, draft, status, uploadLease) {
  const insert = prepareBound(db, `
    INSERT OR IGNORE INTO production_designs (
      design_id, shop, upload_id, bundle_id, status, product_id, variant_id,
      size, model_id, model_version, uv_export_version, design_fingerprint,
      manifest_sha256, manifest_key, bundle_key, bundle_filename, created_at,
      expires_at, paid_at, shopify_order_gid, shopify_order_name, error_code,
      upload_token, upload_started_at, cleanup_token, cleanup_started_at, updated_at
    ) VALUES (
      ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, ?
    )
  `, [
    draft.designId,
    draft.shop,
    draft.uploadId,
    status,
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
    uploadLease?.uploadToken ?? null,
    uploadLease?.uploadStartedAt ?? null,
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

async function finalizeCartDraft(db, input) {
  const value = readExactDataProperties(input, [
    'shop', 'designId', 'uploadId', 'uploadToken', 'updatedAt',
  ]);
  if (!value) throw invalidInput();
  const shop = requirePattern(value.shop, SHOP_PATTERN);
  const designId = requirePattern(value.designId, DESIGN_ID_PATTERN);
  const uploadId = requirePattern(value.uploadId, UPLOAD_ID_PATTERN);
  const uploadToken = requirePattern(value.uploadToken, UPLOAD_TOKEN_PATTERN);
  const updatedAt = requireTimestamp(value.updatedAt);
  const update = prepareBound(db, `
    UPDATE production_designs
    SET status = 'cart_draft', upload_token = NULL, upload_started_at = NULL,
      updated_at = ?
    WHERE shop = ? AND design_id = ? AND upload_id = ?
      AND status = 'upload_pending' AND upload_token = ?
  `, [updatedAt, shop, designId, uploadId, uploadToken]);
  const select = prepareBound(db, `
    SELECT ${ROW_COLUMNS}
    FROM production_designs
    WHERE shop = ? AND upload_id = ?
    LIMIT 1
  `, [shop, uploadId]);
  const results = await executeBatch(db, [update, select]);
  if (!batchChangedExactlyOneRow(results, 0)) {
    throw new ProductionRepositoryError('production-repository-conflict');
  }
  const row = firstBatchRow(results, 1);
  if (!row) throw new ProductionRepositoryError('production-repository-conflict');
  const normalized = normalizeRow(row);
  if (normalized.designId !== designId || normalized.status !== 'cart_draft') {
    throw new ProductionRepositoryError('production-repository-conflict');
  }
  return normalized;
}

async function takeOverStaleUpload(db, input) {
  const value = readExactDataProperties(input, [
    'shop', 'designId', 'uploadId', 'previousUploadToken', 'newUploadToken',
    'startedAt', 'staleBefore',
  ]);
  if (!value) throw invalidInput();
  const shop = requirePattern(value.shop, SHOP_PATTERN);
  const designId = requirePattern(value.designId, DESIGN_ID_PATTERN);
  const uploadId = requirePattern(value.uploadId, UPLOAD_ID_PATTERN);
  const previousUploadToken = requirePattern(value.previousUploadToken, UPLOAD_TOKEN_PATTERN);
  const newUploadToken = requirePattern(value.newUploadToken, UPLOAD_TOKEN_PATTERN);
  const startedAt = requireTimestamp(value.startedAt);
  const staleBefore = requireTimestamp(value.staleBefore);
  if (staleBefore >= startedAt || previousUploadToken === newUploadToken) throw invalidInput();

  const update = prepareBound(db, `
    UPDATE production_designs
    SET upload_token = ?, upload_started_at = ?, updated_at = ?
    WHERE shop = ? AND design_id = ? AND upload_id = ?
      AND status = 'upload_pending' AND upload_token = ?
      AND upload_started_at <= ?
  `, [
    newUploadToken, startedAt, startedAt, shop, designId, uploadId,
    previousUploadToken, staleBefore,
  ]);
  const select = prepareBound(db, `
    SELECT ${ROW_COLUMNS}
    FROM production_designs
    WHERE shop = ? AND upload_id = ?
    LIMIT 1
  `, [shop, uploadId]);
  const results = await executeBatch(db, [update, select]);
  if (!batchChangedExactlyOneRow(results, 0)) {
    throw new ProductionRepositoryError('production-repository-conflict');
  }
  const row = firstBatchRow(results, 1);
  if (!row) throw new ProductionRepositoryError('production-repository-conflict');
  const normalized = normalizeRow(row);
  if (normalized.designId !== designId
    || normalized.status !== 'upload_pending'
    || normalized.uploadToken !== newUploadToken
    || normalized.uploadStartedAt !== startedAt) {
    throw new ProductionRepositoryError('production-repository-conflict');
  }
  return normalized;
}

async function claimOwnedUploadCleanup(db, input) {
  const value = readExactDataProperties(input, [
    'shop', 'designId', 'expiresAt', 'uploadToken', 'cleanupToken', 'claimedAt',
  ]);
  if (!value) throw invalidInput();
  const shop = requirePattern(value.shop, SHOP_PATTERN);
  const designId = requirePattern(value.designId, DESIGN_ID_PATTERN);
  const expiresAt = requireTimestamp(value.expiresAt);
  const uploadToken = requirePattern(value.uploadToken, UPLOAD_TOKEN_PATTERN);
  const cleanupToken = requirePattern(value.cleanupToken, CLEANUP_TOKEN_PATTERN);
  const claimedAt = requireTimestamp(value.claimedAt);
  const claim = prepareBound(db, `
    UPDATE production_designs
    SET status = 'cleanup_pending', upload_token = NULL, upload_started_at = NULL,
      cleanup_token = ?, cleanup_started_at = ?, updated_at = ?
    WHERE shop = ? AND design_id = ? AND expires_at = ?
      AND status = 'upload_pending' AND upload_token = ?
  `, [cleanupToken, claimedAt, claimedAt, shop, designId, expiresAt, uploadToken]);
  const select = prepareBound(db, `
    SELECT ${ROW_COLUMNS}
    FROM production_designs
    WHERE shop = ? AND design_id = ?
    LIMIT 1
  `, [shop, designId]);
  const results = await executeBatch(db, [claim, select]);
  if (!batchChangedExactlyOneRow(results, 0)) {
    throw new ProductionRepositoryError('production-repository-conflict');
  }
  const row = firstBatchRow(results, 1);
  if (!row) throw new ProductionRepositoryError('production-repository-conflict');
  const normalized = normalizeRow(row);
  if (normalized.status !== 'cleanup_pending'
    || normalized.expiresAt !== expiresAt
    || normalized.cleanupToken !== cleanupToken
    || normalized.cleanupStartedAt !== claimedAt) {
    throw new ProductionRepositoryError('production-repository-conflict');
  }
  return normalized;
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

async function getCartDraftByUpload(db, shopInput, uploadIdInput) {
  const shop = requirePattern(shopInput, SHOP_PATTERN);
  const uploadId = requirePattern(uploadIdInput, UPLOAD_ID_PATTERN);
  const row = await executeFirst(prepareBound(db, `
    SELECT ${ROW_COLUMNS}
    FROM production_designs
    WHERE shop = ? AND upload_id = ?
    LIMIT 1
  `, [shop, uploadId]));
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

async function hasWebhookEvent(db, input) {
  const value = readExactDataProperties(input, ['shop', 'topic', 'eventId']);
  if (!value || !ORDER_TOPICS.has(value.topic)) throw invalidInput();
  const shop = requirePattern(value.shop, SHOP_PATTERN);
  const eventId = requirePattern(value.eventId, EVENT_ID_PATTERN);
  const row = await executeFirst(prepareBound(db, `
    SELECT event_id
    FROM shopify_webhook_deliveries
    WHERE shop = ? AND topic = ? AND event_id = ?
    LIMIT 1
  `, [shop, value.topic, eventId]));
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
  if (new Set(normalizedDesigns.map((design) => design.designId)).size !== normalizedDesigns.length) {
    throw invalidInput();
  }
  let specs;
  try {
    specs = paidLifecycle
      ? createPaidLifecycleStatementSpecs(delivery, normalizedDesigns, request.status)
      : createTerminalLifecycleStatementSpecs(delivery, normalizedDesigns, request.status);
  } catch {
    throw invalidInput();
  }
  const update = prepareBound(db, specs.update.sql, specs.update.values);
  const receipt = prepareBound(db, specs.receipt.sql, specs.receipt.values);
  const selectReceipt = prepareBound(db, specs.selectReceipt.sql, specs.selectReceipt.values);

  const results = await executeBatch(db, [update, receipt, selectReceipt]);
  const storedReceipt = firstBatchRow(results, 2);
  if (!storedReceipt || !receiptMatchesDelivery(storedReceipt, delivery)) {
    throw new ProductionRepositoryError('production-repository-conflict');
  }
  return Object.freeze({
    webhookId: delivery.webhookId,
    status: request.status,
    designCount: designs.length,
  });
}

async function listExpiredDrafts(db, input) {
  const value = readExactDataProperties(input, ['before', 'staleBefore', 'limit']);
  if (!value) throw invalidInput();
  const before = requireTimestamp(value.before);
  const staleBefore = requireTimestamp(value.staleBefore);
  if (staleBefore > before) throw invalidInput();
  if (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > MAX_CLEANUP_LIMIT) {
    throw invalidInput();
  }
  const result = await executeAll(prepareBound(db, `
    SELECT shop, design_id, manifest_key, bundle_key, expires_at,
      cleanup_token, cleanup_started_at
    FROM production_designs
    WHERE (status IN ('upload_pending', 'cart_draft') AND expires_at < ?)
      OR (status = 'cleanup_pending' AND cleanup_started_at <= ?)
    ORDER BY expires_at ASC, design_id ASC
    LIMIT ?
  `, [before, staleBefore, value.limit]));
  return Object.freeze(result.map(normalizeCleanupRow));
}

async function claimExpiredDraft(db, input) {
  const value = readExactDataProperties(input, [
    'shop', 'designId', 'expiresAt', 'claimToken', 'claimedAt', 'staleBefore',
  ]);
  if (!value) throw invalidInput();
  const shop = requirePattern(value.shop, SHOP_PATTERN);
  const designId = requirePattern(value.designId, DESIGN_ID_PATTERN);
  const expiresAt = requireTimestamp(value.expiresAt);
  const claimToken = requirePattern(value.claimToken, CLEANUP_TOKEN_PATTERN);
  const claimedAt = requireTimestamp(value.claimedAt);
  const staleBefore = requireTimestamp(value.staleBefore);
  if (staleBefore >= claimedAt) throw invalidInput();

  const claim = prepareBound(db, `
    UPDATE production_designs
    SET status = 'cleanup_pending', upload_token = NULL, upload_started_at = NULL,
      cleanup_token = ?, cleanup_started_at = ?, updated_at = ?
    WHERE shop = ? AND design_id = ? AND expires_at = ?
      AND (
        (status IN ('upload_pending', 'cart_draft') AND expires_at < ?)
        OR (
          status = 'cleanup_pending'
          AND (cleanup_token = ? OR cleanup_started_at <= ?)
        )
      )
  `, [
    claimToken,
    claimedAt,
    claimedAt,
    shop,
    designId,
    expiresAt,
    claimedAt,
    claimToken,
    staleBefore,
  ]);
  const select = prepareBound(db, `
    SELECT ${ROW_COLUMNS}
    FROM production_designs
    WHERE shop = ? AND design_id = ?
    LIMIT 1
  `, [shop, designId]);
  const results = await executeBatch(db, [claim, select]);
  const row = firstBatchRow(results, 1);
  if (!row) return null;
  const normalized = normalizeRow(row);
  if (
    normalized.status !== 'cleanup_pending'
    || normalized.expiresAt !== expiresAt
    || normalized.cleanupToken !== claimToken
    || normalized.cleanupStartedAt !== claimedAt
  ) throw new ProductionRepositoryError('production-repository-conflict');
  return normalized;
}

async function deleteClaimedDraft(db, input) {
  const value = readExactDataProperties(input, ['shop', 'designId', 'expiresAt', 'claimToken']);
  if (!value) throw invalidInput();
  const shop = requirePattern(value.shop, SHOP_PATTERN);
  const designId = requirePattern(value.designId, DESIGN_ID_PATTERN);
  const expiresAt = requireTimestamp(value.expiresAt);
  const claimToken = requirePattern(value.claimToken, CLEANUP_TOKEN_PATTERN);
  const result = await executeRun(prepareBound(db, `
    DELETE FROM production_designs
    WHERE shop = ? AND design_id = ? AND expires_at = ?
      AND status = 'cleanup_pending' AND cleanup_token = ?
  `, [shop, designId, expiresAt, claimToken]));
  return Number.isSafeInteger(result?.meta?.changes) && result.meta.changes > 0;
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

function validateUploadPending(input) {
  const value = readExactDataProperties(input, UPLOAD_PENDING_INPUT_KEYS);
  if (!value) throw invalidInput();
  const draft = validateDraft(Object.fromEntries(
    DRAFT_INPUT_KEYS.map((key) => [key, value[key]]),
  ));
  return Object.freeze({
    ...draft,
    uploadToken: requirePattern(value.uploadToken, UPLOAD_TOKEN_PATTERN),
    uploadStartedAt: requireTimestamp(value.uploadStartedAt),
  });
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
  const value = readExactDataProperties(row, ROW_COLUMN_KEYS);
  if (!value) throw new ProductionRepositoryError();
  try {
    const normalized = {
      designId: requirePattern(value.design_id, DESIGN_ID_PATTERN),
      shop: requirePattern(value.shop, SHOP_PATTERN),
      uploadId: requirePattern(value.upload_id, UPLOAD_ID_PATTERN),
      bundleId: requireNullablePattern(value.bundle_id, BUNDLE_ID_PATTERN),
      status: requireSetValue(value.status, ALL_STATUSES),
      productId: requirePattern(value.product_id, PRODUCT_ID_PATTERN),
      variantId: requireNullablePattern(value.variant_id, VARIANT_ID_PATTERN),
      size: requirePattern(value.size, SAFE_ID_PATTERN),
      modelId: requirePattern(value.model_id, SAFE_ID_PATTERN),
      modelVersion: requirePattern(value.model_version, SAFE_ID_PATTERN),
      uvExportVersion: requirePattern(value.uv_export_version, SAFE_ID_PATTERN),
      designFingerprint: requirePattern(value.design_fingerprint, FINGERPRINT_PATTERN),
      manifestSha256: requirePattern(value.manifest_sha256, SHA256_PATTERN),
      manifestKey: requirePattern(value.manifest_key, OBJECT_KEY_PATTERN),
      bundleKey: requirePattern(value.bundle_key, OBJECT_KEY_PATTERN),
      bundleFilename: requirePattern(value.bundle_filename, BUNDLE_FILENAME_PATTERN),
      createdAt: requireTimestamp(value.created_at),
      expiresAt: requireTimestamp(value.expires_at),
      paidAt: requireNullableTimestamp(value.paid_at),
      shopifyOrderGid: requireNullablePattern(value.shopify_order_gid, ORDER_GID_PATTERN),
      shopifyOrderName: requireNullablePattern(value.shopify_order_name, ORDER_NAME_PATTERN),
      errorCode: requireNullablePattern(value.error_code, ERROR_CODE_PATTERN),
      uploadToken: requireNullablePattern(value.upload_token, UPLOAD_TOKEN_PATTERN),
      uploadStartedAt: requireNullableTimestamp(value.upload_started_at),
      cleanupToken: requireNullablePattern(value.cleanup_token, CLEANUP_TOKEN_PATTERN),
      cleanupStartedAt: requireNullableTimestamp(value.cleanup_started_at),
      updatedAt: requireTimestamp(value.updated_at),
    };
    if (
      normalized.expiresAt <= normalized.createdAt
      || normalized.updatedAt < normalized.createdAt
      || normalized.manifestKey === normalized.bundleKey
      || (normalized.status === 'upload_pending'
        ? normalized.uploadToken === null
          || normalized.uploadStartedAt === null
          || normalized.cleanupToken !== null
          || normalized.cleanupStartedAt !== null
        : normalized.status === 'cleanup_pending'
          ? normalized.uploadToken !== null
            || normalized.uploadStartedAt !== null
            || normalized.cleanupToken === null
            || normalized.cleanupStartedAt === null
          : normalized.uploadToken !== null
            || normalized.uploadStartedAt !== null
            || normalized.cleanupToken !== null
            || normalized.cleanupStartedAt !== null)
    ) throw invalidInput();
    return Object.freeze(normalized);
  } catch {
    throw new ProductionRepositoryError();
  }
}

function normalizeCleanupRow(row) {
  const value = readExactDataProperties(row, [
    'shop', 'design_id', 'manifest_key', 'bundle_key', 'expires_at',
    'cleanup_token', 'cleanup_started_at',
  ]);
  if (!value) throw new ProductionRepositoryError();
  try {
    const cleanupToken = requireNullablePattern(value.cleanup_token, CLEANUP_TOKEN_PATTERN);
    const cleanupStartedAt = requireNullableTimestamp(value.cleanup_started_at);
    if ((cleanupToken === null) !== (cleanupStartedAt === null)) throw invalidInput();
    return Object.freeze({
      shop: requirePattern(value.shop, SHOP_PATTERN),
      designId: requirePattern(value.design_id, DESIGN_ID_PATTERN),
      manifestKey: requirePattern(value.manifest_key, OBJECT_KEY_PATTERN),
      bundleKey: requirePattern(value.bundle_key, OBJECT_KEY_PATTERN),
      expiresAt: requireTimestamp(value.expires_at),
      cleanupToken,
      cleanupStartedAt,
    });
  } catch {
    throw new ProductionRepositoryError();
  }
}

function receiptMatchesDelivery(row, delivery) {
  const value = readExactDataProperties(row, [
    'webhook_id', 'event_id', 'shop', 'topic', 'order_gid', 'received_at',
  ]);
  if (!value) return false;
  try {
    const webhookId = requirePattern(value.webhook_id, WEBHOOK_ID_PATTERN);
    const eventId = requireNullablePattern(value.event_id, EVENT_ID_PATTERN);
    return value.shop === delivery.shop
      && value.topic === delivery.topic
      && value.order_gid === delivery.orderGid
      && (
        (webhookId === delivery.webhookId && eventId === delivery.eventId)
        || (delivery.eventId !== null && eventId === delivery.eventId)
      );
  } catch {
    return false;
  }
}

async function executeBatch(db, statements) {
  try {
    const result = await db.batch(statements);
    if (
      !Array.isArray(result)
      || result.length !== statements.length
      || result.some((entry) => !isValidD1Result(entry))
    ) throw new TypeError('Invalid D1 batch result.');
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
    if (!isValidD1Result(result) || !Array.isArray(result.results)) {
      throw new TypeError('Invalid D1 result.');
    }
    return result.results;
  } catch {
    throw new ProductionRepositoryError();
  }
}

async function executeRun(statement) {
  try {
    const result = await statement.run();
    if (!isValidD1Result(result)) throw new TypeError('Invalid D1 result.');
    return result;
  } catch {
    throw new ProductionRepositoryError();
  }
}

function firstBatchRow(results, index) {
  const rows = results[index]?.results;
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

function batchChangedExactlyOneRow(results, index) {
  const entry = safeOwnPropertyDescriptors(results[index]);
  const meta = entry?.meta?.value;
  const metaDescriptors = safeOwnPropertyDescriptors(meta);
  const changes = metaDescriptors?.changes;
  return Boolean(changes && Object.hasOwn(changes, 'value') && changes.value === 1);
}

function isValidD1Result(value) {
  if (!isPlainObject(value)) return false;
  const descriptors = safeOwnPropertyDescriptors(value);
  if (!descriptors) return false;
  const success = descriptors.success;
  const meta = descriptors.meta;
  const results = descriptors.results;
  return Boolean(
    success && Object.hasOwn(success, 'value') && success.value === true
    && meta && Object.hasOwn(meta, 'value') && isPlainObject(meta.value)
    && (!results || (Object.hasOwn(results, 'value') && Array.isArray(results.value))),
  );
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

function requireNullableTimestamp(value) {
  return value === null ? null : requireTimestamp(value);
}

function requireNullablePattern(value, pattern) {
  return value === null ? null : requirePattern(value, pattern);
}

function requireSetValue(value, allowed) {
  if (typeof value !== 'string' || !allowed.has(value)) throw invalidInput();
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
  const descriptors = safeOwnPropertyDescriptors(value);
  if (!descriptors) return null;
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
  const descriptors = safeOwnPropertyDescriptors(value);
  if (!descriptors) return null;
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor
    || !Object.hasOwn(lengthDescriptor, 'value')
    || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0
  ) return null;
  const expectedKeys = [
    ...Array.from({ length: lengthDescriptor.value }, (_, index) => String(index)),
    'length',
  ];
  if (
    keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
    || expectedKeys.some((key) => !Object.hasOwn(descriptors[key], 'value'))
  ) return null;
  return expectedKeys.slice(0, -1).map((key) => descriptors[key].value);
}

function safeOwnPropertyDescriptors(value) {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
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
