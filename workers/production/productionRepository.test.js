import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ProductionRepositoryError,
  createProductionRepository,
} from './productionRepository.js';

const SHOP = 'testcsj.myshopify.com';
const OTHER_SHOP = 'other-store.myshopify.com';
const DESIGN_ID = 'dsg_1234567890abcdef';
const UPLOAD_ID = 'upl_1234567890abcdef';
const BUNDLE_ID = 'bun_1234567890abcdef';
const ORDER_GID = 'gid://shopify/Order/1234567890';

describe('0001_production_designs migration', () => {
  it('defines the required production records, lifecycle guard and uniqueness rules', async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/CREATE TABLE\s+production_designs/iu);
    for (const column of [
      'design_id TEXT PRIMARY KEY', 'shop TEXT NOT NULL', 'upload_id TEXT NOT NULL',
      'bundle_id TEXT', 'product_id TEXT NOT NULL', 'variant_id TEXT', 'size TEXT NOT NULL',
      'model_id TEXT NOT NULL', 'model_version TEXT NOT NULL', 'uv_export_version TEXT NOT NULL',
      'design_fingerprint TEXT NOT NULL', 'manifest_sha256 TEXT NOT NULL',
      'manifest_key TEXT NOT NULL', 'bundle_key TEXT NOT NULL', 'bundle_filename TEXT NOT NULL',
      'created_at INTEGER NOT NULL', 'expires_at INTEGER NOT NULL', 'paid_at INTEGER',
      'shopify_order_gid TEXT', 'shopify_order_name TEXT', 'error_code TEXT',
      'updated_at INTEGER NOT NULL',
    ]) expect(normalizeSql(sql)).toContain(normalizeSql(column));
    for (const status of [
      'cart_draft', 'paid_pending_production', 'file_error',
      'cancelled', 'refunded', 'archived',
    ]) expect(sql).toContain(`'${status}'`);
    expect(sql).toMatch(/UNIQUE\s*\(\s*shop\s*,\s*upload_id\s*\)/iu);
    expect(sql).toMatch(/UNIQUE\s*\(\s*shop\s*,\s*shopify_order_gid\s*,\s*design_id\s*\)/iu);
  });

  it('defines scoped order indexes, expiry index and webhook delivery receipt table', async () => {
    const sql = await readMigration();

    expect(sql).toMatch(/CREATE TABLE\s+shopify_webhook_deliveries/iu);
    for (const column of [
      'webhook_id TEXT PRIMARY KEY', 'event_id TEXT', 'shop TEXT NOT NULL',
      'topic TEXT NOT NULL', 'order_gid TEXT', 'received_at INTEGER NOT NULL',
    ]) expect(normalizeSql(sql)).toContain(normalizeSql(column));
    expect(sql).toMatch(/CREATE INDEX[^;]+production_designs\s*\(\s*shop\s*,\s*status\s*,\s*created_at\s*\)/iu);
    expect(sql).toMatch(/CREATE INDEX[^;]+production_designs\s*\(\s*shop\s*,\s*shopify_order_name\s*\)/iu);
    expect(sql).toMatch(/CREATE INDEX[^;]+production_designs\s*\(\s*expires_at\s*\)/iu);
  });
});

describe('createProductionRepository', () => {
  it('rejects an invalid D1 binding before preparing SQL', () => {
    expect(() => createProductionRepository(null)).toThrow(ProductionRepositoryError);
    expect(() => createProductionRepository({ prepare() {} })).toThrow(ProductionRepositoryError);
  });

  it('accepts a platform binding with a non-plain prototype', () => {
    const db = createFakeD1();
    Object.setPrototypeOf(db, Object.freeze({ platformBinding: true }));

    expect(() => createProductionRepository(db)).not.toThrow();
  });

  it('turns synchronous prepare failures into stable errors without leaking database details', async () => {
    const db = createFakeD1();
    db.prepare = () => { throw new Error(`SQL failed at ${draft().manifestKey}`); };

    const error = await createProductionRepository(db).getDesign(SHOP, DESIGN_ID)
      .then(() => null, (reason) => reason);

    expect(error).toMatchObject({
      code: 'production-repository-failed',
      message: 'Production design repository operation failed.',
    });
    expect(error.message).not.toContain('SQL');
    expect(error.message).not.toContain('shops/');
  });
});

describe('createCartDraft', () => {
  it('atomically inserts a parameterized cart draft and returns the authoritative selected row', async () => {
    const expected = databaseRow();
    const db = createFakeD1({ batchResults: [{ success: true }, { results: [expected] }] });
    const repository = createProductionRepository(db);

    const result = await repository.createCartDraft(draft());

    expect(db.batches).toHaveLength(1);
    const [insert, select] = db.batches[0];
    expect(insert.sql).toMatch(/^\s*INSERT OR IGNORE INTO production_designs/iu);
    expect(insert.sql).toContain("'cart_draft'");
    expect(insert.sql).not.toContain(SHOP);
    expect(insert.sql).not.toContain(DESIGN_ID);
    expect(insert.values).toContain(SHOP);
    expect(insert.values).toContain(DESIGN_ID);
    expect(select.sql).toMatch(/WHERE\s+shop\s*=\s*\?\s+AND\s+upload_id\s*=\s*\?/iu);
    expect(select.values).toEqual([SHOP, UPLOAD_ID]);
    expect(result).toEqual(authoritativeRow());
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('returns an existing duplicate upload without overwriting its fingerprint, keys or order fields', async () => {
    const existing = databaseRow({
      design_fingerprint: 'deadbeef',
      manifest_key: 'shops/original/manifest.json',
      bundle_key: 'shops/original/bundle.zip',
      shopify_order_gid: ORDER_GID,
    });
    const db = createFakeD1({ batchResults: [{ success: true }, { results: [existing] }] });

    const result = await createProductionRepository(db).createCartDraft(draft());

    expect(result.designFingerprint).toBe('deadbeef');
    expect(result.manifestKey).toBe(existing.manifest_key);
    expect(result.bundleKey).toBe(existing.bundle_key);
    expect(result.shopifyOrderGid).toBe(ORDER_GID);
    expect(db.batches[0][0].sql).not.toMatch(/ON CONFLICT.+DO UPDATE/isu);
  });

  it('fails explicitly when the insert/select batch returns no authoritative row', async () => {
    const db = createFakeD1({ batchResults: [{ success: true }, { results: [] }] });

    await expect(createProductionRepository(db).createCartDraft(draft())).rejects.toMatchObject({
      code: 'production-repository-failed',
      message: 'Production design repository operation failed.',
      name: 'ProductionRepositoryError',
    });
  });

  it('strictly snapshots the draft and never invokes accessor fields', async () => {
    const db = createFakeD1();
    const withExtra = { ...draft(), arbitraryColumn: 'status' };
    const withGetter = Object.defineProperties({}, {
      ...Object.fromEntries(Object.entries(draft()).map(([key, value]) => [key, {
        enumerable: true,
        value,
      }])),
      shop: { enumerable: true, get: () => { throw new Error('getter ran'); } },
    });

    await expect(createProductionRepository(db).createCartDraft(withExtra))
      .rejects.toMatchObject({ code: 'invalid-production-repository-input' });
    await expect(createProductionRepository(db).createCartDraft(withGetter))
      .rejects.toMatchObject({ code: 'invalid-production-repository-input' });
    expect(db.prepared).toHaveLength(0);
  });
});

describe('shop-scoped reads and quote binding', () => {
  it('gets a design only by both shop and design ID', async () => {
    const db = createFakeD1({ firstResults: [databaseRow()] });

    const result = await createProductionRepository(db).getDesign(SHOP, DESIGN_ID);

    expect(db.prepared[0].sql).toMatch(/WHERE\s+shop\s*=\s*\?\s+AND\s+design_id\s*=\s*\?/iu);
    expect(db.prepared[0].values).toEqual([SHOP, DESIGN_ID]);
    expect(result).toEqual(authoritativeRow());
  });

  it('returns null for a missing scoped design', async () => {
    const db = createFakeD1({ firstResults: [null] });
    await expect(createProductionRepository(db).getDesign(OTHER_SHOP, DESIGN_ID))
      .resolves.toBeNull();
  });

  it('binds a quote only to an unexpired same-shop cart draft and never replaces another bundle', async () => {
    const row = databaseRow({ bundle_id: BUNDLE_ID, updated_at: 1_700_000_000_100 });
    const db = createFakeD1({ batchResults: [{ meta: { changes: 1 } }, { results: [row] }] });

    const result = await createProductionRepository(db).bindCartQuote({
      shop: SHOP,
      designId: DESIGN_ID,
      bundleId: BUNDLE_ID,
      updatedAt: 1_700_000_000_100,
    });

    const [update, select] = db.batches[0];
    expect(update.sql).toMatch(/WHERE\s+shop\s*=\s*\?\s+AND\s+design_id\s*=\s*\?/iu);
    expect(update.sql).toContain("status = 'cart_draft'");
    expect(update.sql).toMatch(/expires_at\s*>\s*\?/iu);
    expect(update.sql).toMatch(/bundle_id\s+IS NULL\s+OR\s+bundle_id\s*=\s*\?/iu);
    expect(update.values).toEqual([
      BUNDLE_ID, 1_700_000_000_100, SHOP, DESIGN_ID,
      1_700_000_000_100, BUNDLE_ID,
    ]);
    expect(select.values).toEqual([SHOP, DESIGN_ID]);
    expect(result.bundleId).toBe(BUNDLE_ID);
  });

  it.each([
    ['different bundle', databaseRow({ bundle_id: 'bun_fedcba0987654321' })],
    ['expired', databaseRow({ bundle_id: BUNDLE_ID, expires_at: 1_699_999_999_999 })],
    ['paid', databaseRow({ bundle_id: BUNDLE_ID, status: 'paid_pending_production' })],
  ])('rejects a quote bind when the authoritative row is %s', async (_label, row) => {
    const db = createFakeD1({ batchResults: [{ meta: { changes: 0 } }, { results: [row] }] });
    await expect(createProductionRepository(db).bindCartQuote({
      shop: SHOP,
      designId: DESIGN_ID,
      bundleId: BUNDLE_ID,
      updatedAt: 1_700_000_000_100,
    })).rejects.toMatchObject({ code: 'production-repository-conflict' });
  });
});

describe('webhook lifecycle', () => {
  it('checks webhook delivery existence by both shop and webhook ID', async () => {
    const db = createFakeD1({ firstResults: [{ webhook_id: 'wh_1234567890abcdef' }] });

    await expect(createProductionRepository(db).hasWebhookDelivery({
      shop: SHOP,
      webhookId: 'wh_1234567890abcdef',
    })).resolves.toBe(true);

    expect(db.prepared[0].sql).toMatch(/WHERE\s+shop\s*=\s*\?\s+AND\s+webhook_id\s*=\s*\?/iu);
    expect(db.prepared[0].values).toEqual([SHOP, 'wh_1234567890abcdef']);
  });

  it('records paid designs and the delivery in one batch with guarded, idempotent updates', async () => {
    const db = createFakeD1({ batchResults: [{ success: true }, { success: true }] });
    const repository = createProductionRepository(db);

    const result = await repository.recordOrderLifecycle({
      delivery: delivery(),
      designs: [paidDesign()],
      status: 'paid_pending_production',
    });

    expect(db.batches).toHaveLength(1);
    const [update, receipt] = db.batches[0];
    expect(update.sql).toMatch(/^\s*UPDATE production_designs/iu);
    expect(update.sql).toMatch(/WHERE\s+shop\s*=\s*\?\s+AND\s+design_id\s*=\s*\?/iu);
    expect(update.sql).toMatch(/bundle_id\s*=\s*\?/iu);
    expect(update.sql).toMatch(/shopify_order_gid\s+IS NULL\s+OR\s+shopify_order_gid\s*=\s*\?/iu);
    expect(update.sql).toMatch(/status\s+IN\s*\(\s*'cart_draft'\s*,\s*'paid_pending_production'\s*,\s*'file_error'\s*\)/iu);
    expect(update.values).toContain(SHOP);
    expect(update.values.filter((value) => value === ORDER_GID).length).toBeGreaterThanOrEqual(2);
    expect(receipt.sql).toMatch(/^\s*INSERT OR IGNORE INTO shopify_webhook_deliveries/iu);
    expect(receipt.sql).not.toContain(SHOP);
    expect(receipt.values).toEqual([
      'wh_1234567890abcdef', 'evt_1234567890abcdef', SHOP,
      'orders/paid', ORDER_GID, 1_700_000_000_200,
    ]);
    expect(result).toEqual(Object.freeze({
      webhookId: 'wh_1234567890abcdef',
      status: 'paid_pending_production',
      designCount: 1,
    }));
  });

  it.each(['cancelled', 'refunded'])('updates %s only for designs already bound to the same shop and order', async (status) => {
    const db = createFakeD1({ batchResults: [{ success: true }, { success: true }] });

    await createProductionRepository(db).recordOrderLifecycle({
      delivery: delivery({ topic: status === 'cancelled' ? 'orders/cancelled' : 'refunds/create' }),
      designs: [{ designId: DESIGN_ID, updatedAt: 1_700_000_000_300 }],
      status,
    });

    const [update] = db.batches[0];
    expect(update.sql).toMatch(/WHERE\s+shop\s*=\s*\?\s+AND\s+design_id\s*=\s*\?/iu);
    expect(update.sql).toMatch(/shopify_order_gid\s*=\s*\?/iu);
    expect(update.sql).not.toMatch(/shopify_order_gid\s+IS NULL/iu);
    expect(update.values).toEqual([status, 1_700_000_000_300, SHOP, DESIGN_ID, ORDER_GID]);
  });

  it('rejects arbitrary lifecycle status or extra design fields before touching D1', async () => {
    const db = createFakeD1();
    const repository = createProductionRepository(db);

    await expect(repository.recordOrderLifecycle({
      delivery: delivery(), designs: [paidDesign()], status: 'archived',
    })).rejects.toMatchObject({ code: 'invalid-production-repository-input' });
    await expect(repository.recordOrderLifecycle({
      delivery: delivery(),
      designs: [{ ...paidDesign(), sql: 'DROP TABLE production_designs' }],
      status: 'paid_pending_production',
    })).rejects.toMatchObject({ code: 'invalid-production-repository-input' });
    expect(db.prepared).toHaveLength(0);
  });

  it('validates the complete lifecycle design list before preparing any statement', async () => {
    const db = createFakeD1();
    const repository = createProductionRepository(db);

    await expect(repository.recordOrderLifecycle({
      delivery: delivery(),
      designs: [paidDesign(), { ...paidDesign(), sql: 'untrusted' }],
      status: 'paid_pending_production',
    })).rejects.toMatchObject({ code: 'invalid-production-repository-input' });
    expect(db.prepared).toHaveLength(0);
  });

  it('turns a rejected D1 batch into a stable failure without leaking SQL or object keys', async () => {
    const db = createFakeD1({ batchError: new Error(`SQL failed at ${draft().manifestKey}`) });

    const error = await createProductionRepository(db).recordOrderLifecycle({
      delivery: delivery(), designs: [paidDesign()], status: 'paid_pending_production',
    }).then(() => null, (reason) => reason);

    expect(error).toMatchObject({
      code: 'production-repository-failed',
      message: 'Production design repository operation failed.',
    });
    expect(error.message).not.toContain('SQL');
    expect(error.message).not.toContain('shops/');
  });
});

describe('expired draft cleanup', () => {
  it('lists at most 100 expired cart drafts globally in stable order with only cleanup fields', async () => {
    const rows = [databaseRow(), databaseRow({ design_id: 'dsg_fedcba0987654321' })];
    const db = createFakeD1({ allResults: [{ results: rows }] });

    const result = await createProductionRepository(db).listExpiredDrafts({
      before: 1_700_000_000_200,
      limit: 100,
    });

    const statement = db.prepared[0];
    expect(statement.sql).toContain("status = 'cart_draft'");
    expect(statement.sql).toMatch(/expires_at\s*<\s*\?/iu);
    expect(statement.sql).toMatch(/ORDER BY\s+expires_at\s+ASC\s*,\s*design_id\s+ASC/iu);
    expect(statement.sql).toMatch(/LIMIT\s+\?/iu);
    expect(statement.values).toEqual([1_700_000_000_200, 100]);
    expect(Object.keys(result[0])).toEqual([
      'shop', 'designId', 'manifestKey', 'bundleKey', 'expiresAt',
    ]);
    expect(result).toHaveLength(2);
  });

  it.each([0, 101, 1.5, '100'])('rejects invalid cleanup limit %j', async (limit) => {
    const db = createFakeD1();
    await expect(createProductionRepository(db).listExpiredDrafts({
      before: 1_700_000_000_200,
      limit,
    })).rejects.toMatchObject({ code: 'invalid-production-repository-input' });
    expect(db.prepared).toHaveLength(0);
  });

  it('deletes only the unchanged same-shop expired cart draft and returns whether a row changed', async () => {
    const db = createFakeD1({ runResults: [{ meta: { changes: 1 } }] });

    await expect(createProductionRepository(db).deleteExpiredDraft({
      shop: SHOP,
      designId: DESIGN_ID,
      expiresAt: 1_700_000_001_000,
    })).resolves.toBe(true);

    const statement = db.prepared[0];
    expect(statement.sql).toMatch(/^\s*DELETE FROM production_designs/iu);
    expect(statement.sql).toMatch(/shop\s*=\s*\?\s+AND\s+design_id\s*=\s*\?\s+AND\s+expires_at\s*=\s*\?/iu);
    expect(statement.sql).toContain("status = 'cart_draft'");
    expect(statement.values).toEqual([SHOP, DESIGN_ID, 1_700_000_001_000]);
  });
});

function draft(overrides = {}) {
  return {
    designId: DESIGN_ID,
    shop: SHOP,
    uploadId: UPLOAD_ID,
    productId: 'fn8788-jersey',
    variantId: '48039101923479',
    size: 'm',
    modelId: 'chelsea-jersey',
    modelVersion: '2026.08.01',
    uvExportVersion: '2',
    designFingerprint: '6ac2cd02',
    manifestSha256: 'a'.repeat(64),
    manifestKey: `shops/shop-hash/designs/${DESIGN_ID}/manifest.json`,
    bundleKey: `shops/shop-hash/designs/${DESIGN_ID}/fn8788-jersey-design-6ac2cd02.zip`,
    bundleFilename: 'fn8788-jersey-design-6ac2cd02.zip',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_001_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function databaseRow(overrides = {}) {
  const value = draft();
  return {
    design_id: value.designId,
    shop: value.shop,
    upload_id: value.uploadId,
    bundle_id: null,
    status: 'cart_draft',
    product_id: value.productId,
    variant_id: value.variantId,
    size: value.size,
    model_id: value.modelId,
    model_version: value.modelVersion,
    uv_export_version: value.uvExportVersion,
    design_fingerprint: value.designFingerprint,
    manifest_sha256: value.manifestSha256,
    manifest_key: value.manifestKey,
    bundle_key: value.bundleKey,
    bundle_filename: value.bundleFilename,
    created_at: value.createdAt,
    expires_at: value.expiresAt,
    paid_at: null,
    shopify_order_gid: null,
    shopify_order_name: null,
    error_code: null,
    updated_at: value.updatedAt,
    ...overrides,
  };
}

function authoritativeRow(overrides = {}) {
  const row = databaseRow(overrides);
  return {
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
  };
}

function delivery(overrides = {}) {
  return {
    webhookId: 'wh_1234567890abcdef',
    eventId: 'evt_1234567890abcdef',
    shop: SHOP,
    topic: 'orders/paid',
    orderGid: ORDER_GID,
    receivedAt: 1_700_000_000_200,
    ...overrides,
  };
}

function paidDesign(overrides = {}) {
  return {
    designId: DESIGN_ID,
    bundleId: BUNDLE_ID,
    orderName: '#1001',
    paidAt: 1_700_000_000_100,
    updatedAt: 1_700_000_000_200,
    errorCode: null,
    ...overrides,
  };
}

function createFakeD1({
  allResults = [],
  batchError,
  batchResults = [],
  firstResults = [],
  runResults = [],
} = {}) {
  const db = {
    prepared: [],
    batches: [],
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          return firstResults.shift() ?? null;
        },
        async all() {
          return allResults.shift() ?? { results: [] };
        },
        async run() {
          return runResults.shift() ?? { success: true, meta: { changes: 0 } };
        },
      };
      db.prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      db.batches.push(statements);
      if (batchError) throw batchError;
      return batchResults;
    },
  };
  return db;
}

async function readMigration() {
  return readFile('migrations/0001_production_designs.sql', 'utf8');
}

function normalizeSql(value) {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}
