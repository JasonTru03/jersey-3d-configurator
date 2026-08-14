const TOPICS = new Set(['customers/data_request', 'customers/redact', 'shop/redact']);
const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const WEBHOOK_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const REQUEST_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const ORDER_GID_PATTERN = /^gid:\/\/shopify\/Order\/[1-9][0-9]{0,31}$/u;

export function createPrivacyRepository(db) {
  assertDatabase(db);
  return Object.freeze({
    getRequest: (webhookId) => getRequest(db, webhookId),
    recordRequest: (input) => recordRequest(db, input),
    listDesigns: (input) => listDesigns(db, input),
    completeDataRequest: (input) => completeDataRequest(db, input),
    completeRedaction: (input) => completeRedaction(db, input),
  });
}

async function getRequest(db, webhookIdInput) {
  const webhookId = requirePattern(webhookIdInput, WEBHOOK_ID_PATTERN);
  const row = await db.prepare(`
    SELECT webhook_id, shop, topic, request_id, status, order_gids_json,
      result_json, received_at, completed_at
    FROM shopify_privacy_requests
    WHERE webhook_id = ?
    LIMIT 1
  `).bind(webhookId).first();
  return row ? normalizeRequest(row) : null;
}

async function recordRequest(db, input) {
  const request = validateRequest(input);
  await db.prepare(`
    INSERT OR IGNORE INTO shopify_privacy_requests (
      webhook_id, shop, topic, request_id, status, order_gids_json,
      result_json, received_at, completed_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, NULL, ?, NULL)
  `).bind(
    request.webhookId,
    request.shop,
    request.topic,
    request.requestId,
    JSON.stringify(request.orderGids),
    request.receivedAt,
  ).run();
  const stored = await getRequest(db, request.webhookId);
  if (!stored
    || stored.shop !== request.shop
    || stored.topic !== request.topic
    || stored.requestId !== request.requestId
    || JSON.stringify(stored.orderGids) !== JSON.stringify(request.orderGids)) {
    throw new PrivacyRepositoryError('privacy-repository-conflict');
  }
  return stored;
}

async function listDesigns(db, input) {
  const value = validateScope(input);
  const where = value.topic === 'shop/redact'
    ? 'shop = ?'
    : `shop = ? AND shopify_order_gid IN (${value.orderGids.map(() => '?').join(', ')})`;
  if (value.topic !== 'shop/redact' && value.orderGids.length === 0) return [];
  const rows = await db.prepare(`
    SELECT design_id, shopify_order_gid, status, product_id, variant_id, size,
      manifest_key, bundle_key
    FROM production_designs
    WHERE ${where}
    ORDER BY design_id ASC
  `).bind(value.shop, ...value.orderGids).all();
  if (!rows?.success || !Array.isArray(rows.results)) throw new PrivacyRepositoryError();
  return rows.results.map(normalizeDesign);
}

async function completeDataRequest(db, input) {
  const value = validateCompletion(input, 'customers/data_request');
  const resultJson = JSON.stringify({ designs: value.designs.map(publicDesign) });
  const result = await db.prepare(`
    UPDATE shopify_privacy_requests
    SET status = 'response_ready', result_json = ?, completed_at = ?
    WHERE webhook_id = ? AND shop = ? AND topic = 'customers/data_request'
      AND status IN ('pending', 'response_ready')
  `).bind(resultJson, value.completedAt, value.webhookId, value.shop).run();
  assertChanged(result);
}

async function completeRedaction(db, input) {
  const value = validateCompletion(input);
  if (!['customers/redact', 'shop/redact'].includes(value.topic)) throw invalidInput();
  const designIds = value.designs.map(({ designId }) => designId);
  const statements = [];
  if (designIds.length > 0) {
    const placeholders = designIds.map(() => '?').join(', ');
    statements.push(db.prepare(`
      DELETE FROM admin_download_audit WHERE design_id IN (${placeholders})
    `).bind(...designIds));
    statements.push(db.prepare(`
      DELETE FROM production_designs WHERE shop = ? AND design_id IN (${placeholders})
    `).bind(value.shop, ...designIds));
  }
  if (value.topic === 'shop/redact') {
    statements.push(db.prepare('DELETE FROM shopify_webhook_deliveries WHERE shop = ?')
      .bind(value.shop));
    statements.push(db.prepare('DELETE FROM shopify_oauth_sessions WHERE shop = ?')
      .bind(value.shop));
    statements.push(db.prepare('DELETE FROM shopify_installation_audit WHERE shop = ?')
      .bind(value.shop));
    statements.push(db.prepare('DELETE FROM shopify_installations WHERE shop = ?')
      .bind(value.shop));
    statements.push(db.prepare('DELETE FROM shopify_store_configs WHERE shop = ?')
      .bind(value.shop));
  } else if (value.orderGids.length > 0) {
    const placeholders = value.orderGids.map(() => '?').join(', ');
    statements.push(db.prepare(`
      DELETE FROM shopify_webhook_deliveries
      WHERE shop = ? AND order_gid IN (${placeholders})
    `).bind(value.shop, ...value.orderGids));
  }
  statements.push(db.prepare(`
    UPDATE shopify_privacy_requests
    SET status = 'completed', result_json = ?, completed_at = ?
    WHERE webhook_id = ? AND shop = ? AND topic = ?
      AND status IN ('pending', 'completed')
  `).bind(
    JSON.stringify({ deletedDesigns: designIds.length }),
    value.completedAt,
    value.webhookId,
    value.shop,
    value.topic,
  ));
  const results = await db.batch(statements);
  if (!Array.isArray(results)
    || results.length !== statements.length
    || results.some((entry) => entry?.success !== true)) throw new PrivacyRepositoryError();
}

function validateRequest(input) {
  if (!isPlainObject(input)) throw invalidInput();
  const topic = requireSet(input.topic, TOPICS);
  const orderGids = validateOrderGids(input.orderGids, topic);
  return Object.freeze({
    webhookId: requirePattern(input.webhookId, WEBHOOK_ID_PATTERN),
    shop: requirePattern(input.shop, SHOP_PATTERN),
    topic,
    requestId: requirePattern(input.requestId, REQUEST_ID_PATTERN),
    orderGids,
    receivedAt: requireTimestamp(input.receivedAt),
  });
}

function validateScope(input) {
  if (!isPlainObject(input)) throw invalidInput();
  const topic = requireSet(input.topic, TOPICS);
  return Object.freeze({
    shop: requirePattern(input.shop, SHOP_PATTERN),
    topic,
    orderGids: validateOrderGids(input.orderGids, topic),
  });
}

function validateCompletion(input, requiredTopic) {
  if (!isPlainObject(input)) throw invalidInput();
  const topic = requireSet(input.topic, TOPICS);
  if (requiredTopic && topic !== requiredTopic) throw invalidInput();
  if (!Array.isArray(input.designs) || input.designs.length > 10_000) throw invalidInput();
  const designs = input.designs.map(normalizeDesign);
  if (new Set(designs.map(({ designId }) => designId)).size !== designs.length) throw invalidInput();
  return Object.freeze({
    webhookId: requirePattern(input.webhookId, WEBHOOK_ID_PATTERN),
    shop: requirePattern(input.shop, SHOP_PATTERN),
    topic,
    orderGids: validateOrderGids(input.orderGids, topic),
    designs,
    completedAt: requireTimestamp(input.completedAt),
  });
}

function validateOrderGids(value, topic) {
  if (!Array.isArray(value) || value.length > 250) throw invalidInput();
  const result = value.map((item) => requirePattern(item, ORDER_GID_PATTERN));
  if (new Set(result).size !== result.length) throw invalidInput();
  if (topic === 'shop/redact' && result.length !== 0) throw invalidInput();
  return Object.freeze(result);
}

function normalizeRequest(row) {
  let orderGids;
  try { orderGids = JSON.parse(row.order_gids_json); } catch { throw new PrivacyRepositoryError(); }
  return Object.freeze({
    webhookId: requirePattern(row.webhook_id, WEBHOOK_ID_PATTERN),
    shop: requirePattern(row.shop, SHOP_PATTERN),
    topic: requireSet(row.topic, TOPICS),
    requestId: requirePattern(row.request_id, REQUEST_ID_PATTERN),
    status: requireSet(row.status, new Set(['pending', 'response_ready', 'completed'])),
    orderGids: validateOrderGids(orderGids, row.topic),
    resultJson: row.result_json,
    receivedAt: requireTimestamp(row.received_at),
    completedAt: row.completed_at === null ? null : requireTimestamp(row.completed_at),
  });
}

function normalizeDesign(row) {
  if (!isPlainObject(row)) throw invalidInput();
  return Object.freeze({
    designId: requirePattern(row.design_id ?? row.designId, /^dsg_[A-Za-z0-9_-]{16,64}$/u),
    orderGid: row.shopify_order_gid ?? row.orderGid ?? null,
    status: requirePattern(row.status, /^[a-z_]{3,40}$/u),
    productId: requirePattern(row.product_id ?? row.productId, /^[a-z0-9][a-z0-9-]{0,100}$/u),
    variantId: row.variant_id ?? row.variantId ?? null,
    size: requirePattern(row.size, /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/u),
    manifestKey: requirePattern(row.manifest_key ?? row.manifestKey, /^.{1,1024}$/u),
    bundleKey: requirePattern(row.bundle_key ?? row.bundleKey, /^.{1,1024}$/u),
  });
}

function publicDesign(design) {
  return {
    designId: design.designId,
    orderGid: design.orderGid,
    status: design.status,
    productId: design.productId,
    variantId: design.variantId,
    size: design.size,
  };
}

function assertChanged(result) {
  if (result?.success !== true || !Number.isSafeInteger(result.meta?.changes) || result.meta.changes < 1) {
    throw new PrivacyRepositoryError('privacy-repository-conflict');
  }
}

function requirePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalidInput();
  return value;
}

function requireSet(value, allowed) {
  if (!allowed.has(value)) throw invalidInput();
  return value;
}

function requireTimestamp(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidInput();
  return value;
}

function assertDatabase(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') throw invalidInput();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidInput() {
  return new PrivacyRepositoryError('invalid-privacy-repository-input');
}

export class PrivacyRepositoryError extends Error {
  constructor(code = 'privacy-repository-failed') {
    super('Shopify privacy request repository operation failed.');
    this.name = 'PrivacyRepositoryError';
    this.code = code;
  }
}
