const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const QUERY_MAX_LENGTH = 128;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const ORDER_STATUSES = new Set([
  'paid_pending_production',
  'file_error',
  'cancelled',
  'refunded',
  'archived',
]);
const DOWNLOAD_OUTCOMES = new Set(['started', 'missing', 'invalid']);

export function createAdminOrderRepository(database) {
  assertDatabase(database);
  return Object.freeze({
    listOrders: (input) => listOrders(database, input),
    getOrderFile: (input) => getOrderFile(database, input),
    recordDownload: (input) => recordDownload(database, input),
  });
}

function listOrders(database, input = {}) {
  const shop = readShop(input.shop);
  const query = readQuery(input.query ?? '');
  const status = readStatus(input.status ?? '');
  const from = readNullableTimestamp(input.from ?? null, 'from');
  const to = readNullableTimestamp(input.to ?? null, 'to');
  const page = readPositiveInteger(input.page ?? 1, 10_000, 'page');
  const pageSize = readPositiveInteger(
    input.pageSize ?? DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    'page size',
  );
  if (from !== null && to !== null && from > to) {
    throw new TypeError('Admin order date range is invalid.');
  }

  const filters = ['pd.shop = ?', 'pd.shopify_order_gid IS NOT NULL'];
  const values = [shop];
  if (query) {
    const like = `%${escapeLike(query)}%`;
    filters.push(`(
      pd.shopify_order_name LIKE ? ESCAPE '\\'
      OR pd.design_id LIKE ? ESCAPE '\\'
      OR pd.bundle_filename LIKE ? ESCAPE '\\'
    )`);
    values.push(like, like, like);
  }
  if (status) {
    filters.push('pd.status = ?');
    values.push(status);
  }
  if (from !== null) {
    filters.push('COALESCE(pd.paid_at, pd.updated_at) >= ?');
    values.push(from);
  }
  if (to !== null) {
    filters.push('COALESCE(pd.paid_at, pd.updated_at) <= ?');
    values.push(to);
  }
  const where = filters.join(' AND ');
  const totalRow = database.prepare(`
    SELECT COUNT(*) AS total
    FROM production_designs pd
    WHERE ${where}
  `).get(...values);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) throw new TypeError('Admin order page is invalid.');
  const rows = database.prepare(`
    SELECT
      pd.design_id, pd.shopify_order_gid, pd.shopify_order_name, pd.status,
      pd.product_id, pd.variant_id, pd.size, pd.model_id, pd.model_version,
      pd.uv_export_version, pd.design_fingerprint, pd.bundle_filename,
      pd.bundle_bytes, pd.created_at, pd.paid_at, pd.updated_at, pd.error_code,
      EXISTS (
        SELECT 1 FROM server_objects so WHERE so.key = pd.bundle_key
      ) AS bundle_indexed
    FROM production_designs pd
    WHERE ${where}
    ORDER BY COALESCE(pd.paid_at, pd.updated_at) DESC, pd.design_id ASC
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset);

  return Object.freeze({
    items: Object.freeze(rows.map(normalizeOrderRow)),
    total: Number(totalRow?.total ?? 0),
    page,
    pageSize,
  });
}

function getOrderFile(database, input = {}) {
  const shop = readShop(input.shop);
  const designId = readDesignId(input.designId);
  const row = database.prepare(`
    SELECT design_id, status, shopify_order_name, bundle_key, bundle_filename,
      bundle_bytes, bundle_sha256
    FROM production_designs
    WHERE shop = ? AND design_id = ? AND shopify_order_gid IS NOT NULL
    LIMIT 1
  `).get(shop, designId);
  if (!row) return null;
  return Object.freeze({
    designId: row.design_id,
    status: row.status,
    orderName: row.shopify_order_name,
    bundleKey: row.bundle_key,
    bundleFilename: row.bundle_filename,
    bundleBytes: Number(row.bundle_bytes),
    bundleSha256: row.bundle_sha256,
  });
}

function recordDownload(database, input = {}) {
  const shop = readShop(input.shop);
  const designId = readDesignId(input.designId);
  const downloadedAt = readNullableTimestamp(input.downloadedAt, 'downloaded at');
  if (downloadedAt === null) throw new TypeError('Admin download time is invalid.');
  if (!DOWNLOAD_OUTCOMES.has(input.outcome)) {
    throw new TypeError('Admin download outcome is invalid.');
  }
  const result = database.prepare(`
    INSERT INTO admin_download_audit (shop, design_id, downloaded_at, outcome)
    SELECT shop, design_id, ?, ?
    FROM production_designs
    WHERE shop = ? AND design_id = ? AND shopify_order_gid IS NOT NULL
  `).run(downloadedAt, input.outcome, shop, designId);
  if (Number(result.changes) !== 1) throw new TypeError('Admin download order is invalid.');
}

function normalizeOrderRow(row) {
  return Object.freeze({
    designId: row.design_id,
    orderGid: row.shopify_order_gid,
    orderName: row.shopify_order_name,
    status: row.status,
    productId: row.product_id,
    variantId: row.variant_id,
    size: row.size,
    modelId: row.model_id,
    modelVersion: row.model_version,
    uvExportVersion: row.uv_export_version,
    designFingerprint: row.design_fingerprint,
    bundleFilename: row.bundle_filename,
    bundleBytes: Number(row.bundle_bytes),
    createdAt: Number(row.created_at),
    paidAt: row.paid_at === null ? null : Number(row.paid_at),
    updatedAt: Number(row.updated_at),
    errorCode: row.error_code,
    bundleIndexed: Number(row.bundle_indexed) === 1,
  });
}

function readShop(value) {
  if (typeof value !== 'string' || !SHOP_PATTERN.test(value)) {
    throw new TypeError('Admin shop is invalid.');
  }
  return value;
}

function readDesignId(value) {
  if (typeof value !== 'string' || !DESIGN_ID_PATTERN.test(value)) {
    throw new TypeError('Admin design ID is invalid.');
  }
  return value;
}

function readQuery(value) {
  if (typeof value !== 'string') throw new TypeError('Admin order query is invalid.');
  const result = value.trim();
  if (result.length > QUERY_MAX_LENGTH) throw new TypeError('Admin order query is invalid.');
  return result;
}

function readStatus(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !ORDER_STATUSES.has(value)) {
    throw new TypeError('Admin order status is invalid.');
  }
  return value;
}

function readNullableTimestamp(value, name) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Admin order ${name} is invalid.`);
  }
  return value;
}

function readPositiveInteger(value, maximum, name) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`Admin order ${name} is invalid.`);
  }
  return value;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('Admin database is invalid.');
  }
}
