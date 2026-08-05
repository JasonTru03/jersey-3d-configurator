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
const CLEANUP_TOKEN = 'cln_1234567890abcdef';
const UPLOAD_TOKEN = 'upt_1234567890abcdef';
const NEXT_UPLOAD_TOKEN = 'upt_fedcba0987654321';

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
      'cleanup_token TEXT', 'cleanup_started_at INTEGER', 'updated_at INTEGER NOT NULL',
      'upload_token TEXT',
    ]) expect(normalizeSql(sql)).toContain(normalizeSql(column));
    for (const status of [
      'upload_pending', 'cart_draft', 'paid_pending_production', 'file_error',
      'cancelled', 'refunded', 'archived', 'cleanup_pending',
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
    expect(sql).toMatch(/CREATE UNIQUE INDEX[^;]+shopify_webhook_deliveries\s*\(\s*shop\s*,\s*topic\s*,\s*event_id\s*\)[^;]+WHERE\s+event_id\s+IS\s+NOT\s+NULL/iu);
    expect(sql).toMatch(/CREATE INDEX[^;]+production_designs\s*\(\s*cleanup_started_at\s*\)[^;]+WHERE\s+status\s*=\s*'cleanup_pending'/iu);
    const normalized = normalizeSql(sql);
    expect(normalized).toContain(normalizeSql(
      "status = 'upload_pending' AND upload_token IS NOT NULL",
    ));
    expect(normalized).toContain(normalizeSql(
      "status = 'cleanup_pending' AND upload_token IS NULL",
    ));
    expect(normalized).not.toContain('upload_started_at');
    expect(normalized).toContain(normalizeSql(
      'cleanup_token IS NOT NULL AND cleanup_started_at IS NOT NULL',
    ));
  });
});

describe('0002 free-tier streaming upload migration', () => {
  it('adds the declared manifest and ZIP integrity fields without rewriting old rows', async () => {
    const sql = await readFile('migrations/0002_free_tier_streaming_upload.sql', 'utf8');
    expect(normalizeSql(sql)).toContain('add column manifest_bytes integer');
    expect(normalizeSql(sql)).toContain('add column bundle_sha256 text');
    expect(normalizeSql(sql)).toContain('add column bundle_bytes integer');
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
    const db = createFakeD1({ batchResults: [d1Result({ changes: 1 }), d1Result({ results: [expected] })] });
    const repository = createProductionRepository(db);

    const result = await repository.createCartDraft(draft());

    expect(db.batches).toHaveLength(1);
    const [insert, select] = db.batches[0];
    expect(insert.sql).toMatch(/^\s*INSERT OR IGNORE INTO production_designs/iu);
    expect(insert.values).toContain('cart_draft');
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
    const db = createFakeD1({ batchResults: [d1Result(), d1Result({ results: [existing] })] });

    const result = await createProductionRepository(db).createCartDraft(draft());

    expect(result.designFingerprint).toBe('deadbeef');
    expect(result.manifestKey).toBe(existing.manifest_key);
    expect(result.bundleKey).toBe(existing.bundle_key);
    expect(result.shopifyOrderGid).toBe(ORDER_GID);
    expect(db.batches[0][0].sql).not.toMatch(/ON CONFLICT.+DO UPDATE/isu);
  });

  it('fails explicitly when the insert/select batch returns no authoritative row', async () => {
    const db = createFakeD1({ batchResults: [d1Result({ changes: 1 }), d1Result()] });

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

describe('upload pending reservation and finalization', () => {
  it('atomically reserves an upload_pending row before R2 writes', async () => {
    const pending = databaseRow({
      status: 'upload_pending', upload_token: UPLOAD_TOKEN,
    });
    const db = createFakeD1({
      batchResults: [d1Result({ changes: 1 }), d1Result({ results: [pending] })],
    });

    const result = await createProductionRepository(db).createUploadPending({
      ...draft(), uploadToken: UPLOAD_TOKEN,
    });

    const [insert, select] = db.batches[0];
    expect(insert.sql).toMatch(/^\s*INSERT OR IGNORE INTO production_designs/iu);
    expect(insert.values).toContain('upload_pending');
    expect(insert.values).toContain(UPLOAD_TOKEN);
    expect(select.values).toEqual([SHOP, UPLOAD_ID]);
    expect(result).toEqual(authoritativeRow({
      status: 'upload_pending', upload_token: UPLOAD_TOKEN,
    }));
  });

  it('atomically finalizes only the owning upload_pending row as cart_draft', async () => {
    const cart = databaseRow({ status: 'cart_draft', updated_at: 1_700_000_000_100 });
    const db = createFakeD1({
      batchResults: [d1Result({ changes: 1 }), d1Result({ results: [cart] })],
    });

    const result = await createProductionRepository(db).finalizeCartDraft({
      shop: SHOP,
      designId: DESIGN_ID,
      uploadId: UPLOAD_ID,
      uploadToken: UPLOAD_TOKEN,
      updatedAt: 1_700_000_000_100,
    });

    const [update, select] = db.batches[0];
    expect(update.sql).toMatch(/^\s*UPDATE production_designs/iu);
    expect(update.sql).toMatch(/SET\s+status\s*=\s*'cart_draft'/iu);
    expect(update.sql).toMatch(/status\s*=\s*'upload_pending'/iu);
    expect(update.values).toEqual([
      1_700_000_000_100, SHOP, DESIGN_ID, UPLOAD_ID, UPLOAD_TOKEN,
    ]);
    expect(select.values).toEqual([SHOP, UPLOAD_ID]);
    expect(result).toEqual(authoritativeRow({ updated_at: 1_700_000_000_100 }));
  });

  it('conflicts when finalization does not produce the owning cart draft', async () => {
    const other = databaseRow({
      status: 'upload_pending',
      design_id: 'dsg_fedcba0987654321',
      upload_token: UPLOAD_TOKEN,
    });
    const db = createFakeD1({
      batchResults: [d1Result(), d1Result({ results: [other] })],
    });

    await expect(createProductionRepository(db).finalizeCartDraft({
      shop: SHOP,
      designId: DESIGN_ID,
      uploadId: UPLOAD_ID,
      uploadToken: UPLOAD_TOKEN,
      updatedAt: 1_700_000_000_100,
    })).rejects.toMatchObject({ code: 'production-repository-conflict' });
  });

  it('rejects a wrong-token finalization even when SELECT sees an already finalized cart row', async () => {
    const cart = databaseRow({ status: 'cart_draft', updated_at: 1_700_000_000_100 });
    const db = createFakeD1({
      batchResults: [d1Result({ changes: 0 }), d1Result({ results: [cart] })],
    });

    await expect(createProductionRepository(db).finalizeCartDraft({
      shop: SHOP,
      designId: DESIGN_ID,
      uploadId: UPLOAD_ID,
      uploadToken: NEXT_UPLOAD_TOKEN,
      updatedAt: 1_700_000_000_100,
    })).rejects.toMatchObject({ code: 'production-repository-conflict' });
  });

  it('claims only its owned upload token for cleanup before R2 deletion', async () => {
    const claimed = databaseRow({
      status: 'cleanup_pending',
      cleanup_token: CLEANUP_TOKEN,
      cleanup_started_at: 1_700_000_000_200,
      updated_at: 1_700_000_000_200,
    });
    const db = createFakeD1({
      batchResults: [d1Result({ changes: 1 }), d1Result({ results: [claimed] })],
    });

    const result = await createProductionRepository(db).claimOwnedUploadCleanup({
      shop: SHOP,
      designId: DESIGN_ID,
      expiresAt: 1_700_000_001_000,
      uploadToken: UPLOAD_TOKEN,
      cleanupToken: CLEANUP_TOKEN,
      claimedAt: 1_700_000_000_200,
    });

    const [claim] = db.batches[0];
    expect(claim.sql).toMatch(/status\s*=\s*'upload_pending'/iu);
    expect(claim.sql).toMatch(/upload_token\s*=\s*\?/iu);
    expect(claim.sql).toMatch(/upload_token\s*=\s*NULL/iu);
    expect(claim.sql).not.toMatch(/upload_started_at/iu);
    expect(result).toMatchObject({ status: 'cleanup_pending', cleanupToken: CLEANUP_TOKEN });
  });

  it('rejects cleanup ownership when its claim UPDATE changed no row', async () => {
    const claimed = databaseRow({
      status: 'cleanup_pending',
      cleanup_token: CLEANUP_TOKEN,
      cleanup_started_at: 1_700_000_000_200,
      updated_at: 1_700_000_000_200,
    });
    const db = createFakeD1({
      batchResults: [d1Result({ changes: 0 }), d1Result({ results: [claimed] })],
    });

    await expect(createProductionRepository(db).claimOwnedUploadCleanup({
      shop: SHOP,
      designId: DESIGN_ID,
      expiresAt: 1_700_000_001_000,
      uploadToken: UPLOAD_TOKEN,
      cleanupToken: CLEANUP_TOKEN,
      claimedAt: 1_700_000_000_200,
    })).rejects.toMatchObject({ code: 'production-repository-conflict' });
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

  it('strictly snapshots D1 rows and rejects accessors, extra columns and malformed values', async () => {
    let getterCalls = 0;
    const accessorRow = Object.defineProperties({}, {
      ...Object.fromEntries(Object.entries(databaseRow()).map(([key, value]) => [key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      }])),
      status: {
        configurable: true,
        enumerable: true,
        get() { getterCalls += 1; return 'cart_draft'; },
      },
    });
    const db = createFakeD1({ firstResults: [
      accessorRow,
      { ...databaseRow(), unexpected_column: 'x' },
      { ...databaseRow(), created_at: '1700000000000' },
      {},
    ] });
    const repository = createProductionRepository(db);

    for (let index = 0; index < 4; index += 1) {
      await expect(repository.getDesign(SHOP, DESIGN_ID))
        .rejects.toMatchObject({ code: 'production-repository-failed' });
    }
    expect(getterCalls).toBe(0);
  });

  it('accepts a complete D1 row with a null prototype', async () => {
    const row = Object.assign(Object.create(null), databaseRow());
    const db = createFakeD1({ firstResults: [row] });

    await expect(createProductionRepository(db).getDesign(SHOP, DESIGN_ID))
      .resolves.toEqual(authoritativeRow());
  });

  it('gets a cart draft by the same-shop upload ID for pre-R2 deduplication', async () => {
    const db = createFakeD1({ firstResults: [databaseRow()] });

    const result = await createProductionRepository(db).getCartDraftByUpload(SHOP, UPLOAD_ID);

    expect(db.prepared[0].sql).toMatch(/WHERE\s+shop\s*=\s*\?\s+AND\s+upload_id\s*=\s*\?/iu);
    expect(db.prepared[0].values).toEqual([SHOP, UPLOAD_ID]);
    expect(result).toEqual(authoritativeRow());
  });

  it('does not expose an upload from another shop and returns null when absent', async () => {
    const db = createFakeD1({ firstResults: [null, null] });
    const repository = createProductionRepository(db);

    await expect(repository.getCartDraftByUpload(OTHER_SHOP, UPLOAD_ID)).resolves.toBeNull();
    await expect(repository.getCartDraftByUpload(SHOP, 'upl_fedcba0987654321')).resolves.toBeNull();
    expect(db.prepared.map((statement) => statement.values[0])).toEqual([OTHER_SHOP, SHOP]);
  });

  it('authorizes a pending stream only when shop, design, upload and token all match in SQL', async () => {
    const pending = databaseRow({ status: 'upload_pending', upload_token: UPLOAD_TOKEN });
    const db = createFakeD1({ firstResults: [pending] });
    const result = await createProductionRepository(db).getOwnedUploadPending({
      shop: SHOP,
      designId: DESIGN_ID,
      uploadId: UPLOAD_ID,
      uploadToken: UPLOAD_TOKEN,
    });

    expect(db.prepared[0].sql).toMatch(/shop\s*=\s*\?.*design_id\s*=\s*\?.*upload_id\s*=\s*\?/isu);
    expect(db.prepared[0].sql).toContain("status = 'upload_pending'");
    expect(db.prepared[0].sql).toMatch(/upload_token\s*=\s*\?/iu);
    expect(db.prepared[0].values).toEqual([SHOP, DESIGN_ID, UPLOAD_ID, UPLOAD_TOKEN]);
    expect(result).toEqual(authoritativeRow({ status: 'upload_pending', upload_token: UPLOAD_TOKEN }));
  });

  it('returns a stable repository error when the upload lookup fails in D1', async () => {
    const db = createFakeD1({ firstError: new Error('D1 unavailable') });

    await expect(createProductionRepository(db).getCartDraftByUpload(SHOP, UPLOAD_ID))
      .rejects.toMatchObject({ code: 'production-repository-failed' });
  });

  it('binds a quote only to an unexpired same-shop cart draft and fixes the first issued timestamp', async () => {
    const row = databaseRow({ bundle_id: BUNDLE_ID, updated_at: 1_700_000_000_100 });
    const db = createFakeD1({ batchResults: [d1Result({ changes: 1 }), d1Result({ results: [row] })] });

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
    expect(update.sql).toMatch(/bundle_id\s*=\s*COALESCE\s*\(\s*bundle_id\s*,\s*\?\s*\)/iu);
    expect(update.sql).toMatch(/updated_at\s*=\s*CASE\s+WHEN\s+bundle_id\s+IS NULL\s+THEN\s+\?/iu);
    expect(update.sql).toMatch(/bundle_id\s+IS NOT NULL\s+OR\s+updated_at\s*<=\s*\?/iu);
    expect(update.values).toEqual([
      BUNDLE_ID, 1_700_000_000_100, SHOP, DESIGN_ID,
      1_700_000_000_100, 1_700_000_000_100,
    ]);
    expect(select.values).toEqual([SHOP, DESIGN_ID]);
    expect(result.bundleId).toBe(BUNDLE_ID);
  });

  it('returns the first authoritative bundle and timestamp when a racing quote proposed another bundle', async () => {
    const firstBundle = 'bun_fedcba0987654321';
    const firstIssuedAt = 1_700_000_000_050;
    const row = databaseRow({ bundle_id: firstBundle, updated_at: firstIssuedAt });
    const db = createFakeD1({ batchResults: [d1Result({ changes: 1 }), d1Result({ results: [row] })] });

    await expect(createProductionRepository(db).bindCartQuote({
      shop: SHOP,
      designId: DESIGN_ID,
      bundleId: BUNDLE_ID,
      updatedAt: 1_700_000_000_100,
    })).resolves.toMatchObject({ bundleId: firstBundle, updatedAt: firstIssuedAt });
  });

  it.each([
    ['expired', databaseRow({ bundle_id: BUNDLE_ID, expires_at: 1_700_000_000_050 })],
    ['paid', databaseRow({ bundle_id: BUNDLE_ID, status: 'paid_pending_production' })],
    ['claimed for cleanup', databaseRow({
      bundle_id: BUNDLE_ID,
      status: 'cleanup_pending',
      cleanup_token: CLEANUP_TOKEN,
      cleanup_started_at: 1_700_000_000_050,
    })],
  ])('rejects a quote bind when the authoritative row is %s', async (_label, row) => {
    const db = createFakeD1({ batchResults: [d1Result(), d1Result({ results: [row] })] });
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

  it('checks an optional event identity by shop, topic and event ID', async () => {
    const db = createFakeD1({ firstResults: [{ event_id: 'evt_1234567890abcdef' }] });

    await expect(createProductionRepository(db).hasWebhookEvent({
      shop: SHOP,
      topic: 'orders/paid',
      eventId: 'evt_1234567890abcdef',
    })).resolves.toBe(true);

    expect(db.prepared[0].sql).toMatch(/WHERE\s+shop\s*=\s*\?\s+AND\s+topic\s*=\s*\?\s+AND\s+event_id\s*=\s*\?/iu);
    expect(db.prepared[0].values).toEqual([SHOP, 'orders/paid', 'evt_1234567890abcdef']);
  });

  it('records all paid designs and the delivery atomically with one guarded CTE update', async () => {
    const db = createFakeD1({ batchResults: lifecycleBatchResults() });
    const repository = createProductionRepository(db);

    const result = await repository.recordOrderLifecycle({
      delivery: delivery(),
      designs: [
        paidDesign(),
        paidDesign({ designId: 'dsg_fedcba0987654321' }),
      ],
      status: 'paid_pending_production',
    });

    expect(db.batches).toHaveLength(1);
    const [update, receipt, selectedReceipt] = db.batches[0];
    expect(db.batches[0]).toHaveLength(3);
    expect(update.sql).toMatch(/^\s*WITH\s+input_designs/iu);
    expect(update.sql).toMatch(/UPDATE\s+production_designs/iu);
    expect(update.sql).toMatch(/COUNT\s*\(\s*\*\s*\)[^;]+COUNT\s*\(\s*\*\s*\)/isu);
    expect(update.sql).toMatch(/updated_at\s*<=/iu);
    expect(update.sql).toMatch(/NOT\s+EXISTS[^;]+shopify_webhook_deliveries/isu);
    expect((update.sql.match(/UPDATE\s+production_designs/giu) ?? [])).toHaveLength(1);
    expect(update.sql).toMatch(/FROM\s+json_each\s*\(\s*\?\s*\)/iu);
    expect(update.sql).toMatch(/CAST\s*\(\s*json_extract\([^)]+'\$\.updated_at'\)\s+AS\s+INTEGER\s*\)/iu);
    expect(update.sql).not.toContain(DESIGN_ID);
    expect(update.values).toContain(SHOP);
    expect(JSON.parse(update.values[0]).map((design) => design.design_id))
      .toContain('dsg_fedcba0987654321');
    expect(update.values.filter((value) => value === ORDER_GID).length).toBeGreaterThanOrEqual(2);
    expect(receipt.sql).toMatch(/^\s*WITH\s+input_designs/iu);
    expect(receipt.sql).toMatch(/INSERT OR IGNORE INTO shopify_webhook_deliveries/iu);
    expect(receipt.sql).toMatch(/SELECT[^;]+WHERE[^;]+COUNT\s*\(\s*\*\s*\)/isu);
    expect(receipt.sql).not.toContain(SHOP);
    expect(selectedReceipt.sql).toMatch(/FROM\s+shopify_webhook_deliveries/iu);
    expect(selectedReceipt.sql).toMatch(/webhook_id\s*=\s*\?[^;]+event_id\s*=\s*\?/isu);
    expect(result).toEqual(Object.freeze({
      webhookId: 'wh_1234567890abcdef',
      status: 'paid_pending_production',
      designCount: 2,
    }));
  });

  it.each(['paid_pending_production', 'file_error'])(
    'keeps an exact 250-design %s lifecycle within a bounded bind count',
    async (status) => {
      const db = createFakeD1({ batchResults: lifecycleBatchResults() });
      const designs = Array.from({ length: 250 }, (_, index) => paidDesignAt(index, status));

      await expect(createProductionRepository(db).recordOrderLifecycle({
        delivery: delivery(), designs, status,
      })).resolves.toMatchObject({ designCount: 250 });

      expect(db.batches[0]).toHaveLength(3);
      for (const statement of db.batches[0]) expect(statement.values.length).toBeLessThanOrEqual(100);
    },
  );

  it.each([
    ['cancelled', 'orders/cancelled'],
    ['refunded', 'refunds/create'],
  ])('keeps an exact 250-design %s lifecycle within a bounded bind count', async (status, topic) => {
    const db = createFakeD1({ batchResults: lifecycleBatchResults({ topic }) });
    const designs = Array.from({ length: 250 }, (_, index) => ({
      designId: indexedDesignId(index),
      updatedAt: 1_700_000_000_300,
    }));

    await expect(createProductionRepository(db).recordOrderLifecycle({
      delivery: delivery({ topic }), designs, status,
    })).resolves.toMatchObject({ designCount: 250 });

    for (const statement of db.batches[0]) expect(statement.values.length).toBeLessThanOrEqual(100);
  });

  it('rejects 251 lifecycle designs before preparing SQL', async () => {
    const db = createFakeD1();
    const designs = Array.from({ length: 251 }, (_, index) => paidDesignAt(index));

    await expect(createProductionRepository(db).recordOrderLifecycle({
      delivery: delivery(), designs, status: 'paid_pending_production',
    })).rejects.toMatchObject({ code: 'invalid-production-repository-input' });
    expect(db.prepared).toHaveLength(0);
  });

  it.each([
    ['cancelled', 'orders/cancelled', "'paid_pending_production', 'file_error', 'cancelled'"],
    ['refunded', 'refunds/create', "'paid_pending_production', 'file_error', 'cancelled', 'refunded'"],
  ])('updates %s monotonically for the same shop/order', async (status, topic, allowedStates) => {
    const db = createFakeD1({ batchResults: lifecycleBatchResults({ topic }) });

    await createProductionRepository(db).recordOrderLifecycle({
      delivery: delivery({ topic }),
      designs: [{ designId: DESIGN_ID, updatedAt: 1_700_000_000_300 }],
      status,
    });

    const [update] = db.batches[0];
    expect(update.sql).toMatch(/^\s*WITH\s+input_designs/iu);
    expect(update.sql).toMatch(/shopify_order_gid\s*=\s*\?/iu);
    expect(update.sql).not.toMatch(/shopify_order_gid\s+IS NULL/iu);
    expect(normalizeSql(update.sql)).toContain(normalizeSql(`status IN (${allowedStates})`));
    expect(update.sql).toMatch(/updated_at\s*<=/iu);
  });

  it('returns a stable conflict and no receipt when any design misses its guard', async () => {
    const db = createFakeD1({ batchResults: lifecycleBatchResults({ receipt: null }) });

    await expect(createProductionRepository(db).recordOrderLifecycle({
      delivery: delivery(),
      designs: [paidDesign(), paidDesign({ designId: 'dsg_fedcba0987654321' })],
      status: 'paid_pending_production',
    })).rejects.toMatchObject({ code: 'production-repository-conflict' });

    expect(db.batches[0]).toHaveLength(3);
  });

  it('treats a repeated webhook or a different delivery for the same event as idempotent success', async () => {
    const repeated = lifecycleBatchResults({ receiptInserted: false });
    const sameEvent = lifecycleBatchResults({
      webhookId: 'wh_original12345678', receiptInserted: false,
    });
    const db = createFakeD1({ batchResultsQueue: [repeated, sameEvent] });
    const repository = createProductionRepository(db);

    await expect(repository.recordOrderLifecycle({
      delivery: delivery(), designs: [paidDesign()], status: 'paid_pending_production',
    })).resolves.toMatchObject({ designCount: 1 });
    await expect(repository.recordOrderLifecycle({
      delivery: delivery({ webhookId: 'wh_different123456' }),
      designs: [paidDesign()],
      status: 'paid_pending_production',
    })).resolves.toMatchObject({ designCount: 1 });
  });

  it('rejects a webhook ID collision from another scope without reporting lifecycle success', async () => {
    const db = createFakeD1({ batchResults: lifecycleBatchResults({ receipt: null }) });

    await expect(createProductionRepository(db).recordOrderLifecycle({
      delivery: delivery(), designs: [paidDesign()], status: 'paid_pending_production',
    })).rejects.toMatchObject({ code: 'production-repository-conflict' });

    expect(db.batches[0][0].sql).toMatch(/NOT\s+EXISTS[^;]+webhook_id\s*=\s*\?/isu);
  });

  it('rejects a late cancellation after refund while allowing a newer refund after cancellation', async () => {
    const cancelledDb = createFakeD1({ batchResults: lifecycleBatchResults({ receipt: null }) });
    await expect(createProductionRepository(cancelledDb).recordOrderLifecycle({
      delivery: delivery({ topic: 'orders/cancelled' }),
      designs: [{ designId: DESIGN_ID, updatedAt: 1_700_000_000_250 }],
      status: 'cancelled',
    })).rejects.toMatchObject({ code: 'production-repository-conflict' });

    const refundedDb = createFakeD1({
      batchResults: lifecycleBatchResults({ topic: 'refunds/create' }),
    });
    await expect(createProductionRepository(refundedDb).recordOrderLifecycle({
      delivery: delivery({ topic: 'refunds/create', receivedAt: 1_700_000_000_400 }),
      designs: [{ designId: DESIGN_ID, updatedAt: 1_700_000_000_400 }],
      status: 'refunded',
    })).resolves.toMatchObject({ status: 'refunded' });
  });

  it('snapshots a Proxy lifecycle array without reading its length getter', async () => {
    const db = createFakeD1({ batchResults: lifecycleBatchResults() });
    let lengthReads = 0;
    const designs = new Proxy([paidDesign()], {
      get(target, property, receiver) {
        if (property === 'length') {
          lengthReads += 1;
          throw new Error('length getter ran');
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(createProductionRepository(db).recordOrderLifecycle({
      delivery: delivery(), designs, status: 'paid_pending_production',
    })).resolves.toMatchObject({ designCount: 1 });
    expect(lengthReads).toBe(0);
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
    expect(db.rolledBack).toBe(true);
  });
});

describe('expired draft cleanup', () => {
  it('lists expired drafts and stale cleanup leases in stable order with validated cleanup fields', async () => {
    const rows = [
      cleanupListRow(),
      cleanupListRow({
        design_id: 'dsg_fedcba0987654321',
        cleanup_token: CLEANUP_TOKEN,
        cleanup_started_at: 1_700_000_000_050,
      }),
    ];
    const db = createFakeD1({ allResults: [d1Result({ results: rows })] });

    const result = await createProductionRepository(db).listExpiredDrafts({
      before: 1_700_000_000_200,
      staleBefore: 1_700_000_000_100,
      limit: 100,
    });

    const statement = db.prepared[0];
    expect(statement.sql).toMatch(/status\s+IN\s*\(\s*'upload_pending'\s*,\s*'cart_draft'\s*\)/iu);
    expect(statement.sql).toContain("status = 'cleanup_pending'");
    expect(statement.sql).toMatch(/expires_at\s*<\s*\?/iu);
    expect(statement.sql).toMatch(/cleanup_started_at\s*<=\s*\?/iu);
    expect(statement.sql).toMatch(/ORDER BY\s+expires_at\s+ASC\s*,\s*design_id\s+ASC/iu);
    expect(statement.sql).toMatch(/LIMIT\s+\?/iu);
    expect(statement.values).toEqual([1_700_000_000_200, 1_700_000_000_100, 100]);
    expect(Object.keys(result[0])).toEqual([
      'shop', 'designId', 'manifestKey', 'bundleKey', 'expiresAt',
      'cleanupToken', 'cleanupStartedAt',
    ]);
    expect(result[1]).toMatchObject({
      cleanupToken: CLEANUP_TOKEN,
      cleanupStartedAt: 1_700_000_000_050,
    });
    expect(result).toHaveLength(2);
  });

  it.each([0, 101, 1.5, '100'])('rejects invalid cleanup limit %j', async (limit) => {
    const db = createFakeD1();
    await expect(createProductionRepository(db).listExpiredDrafts({
      before: 1_700_000_000_200,
      staleBefore: 1_700_000_000_100,
      limit,
    })).rejects.toMatchObject({ code: 'invalid-production-repository-input' });
    expect(db.prepared).toHaveLength(0);
  });

  it('atomically claims an expired same-shop draft before any R2 deletion', async () => {
    const claimed = databaseRow({
      status: 'cleanup_pending',
      cleanup_token: CLEANUP_TOKEN,
      cleanup_started_at: 1_700_000_000_200,
      updated_at: 1_700_000_000_200,
    });
    const db = createFakeD1({ batchResults: [d1Result({ changes: 1 }), d1Result({ results: [claimed] })] });

    const result = await createProductionRepository(db).claimExpiredDraft({
      shop: SHOP,
      designId: DESIGN_ID,
      expiresAt: 1_700_000_001_000,
      claimToken: CLEANUP_TOKEN,
      claimedAt: 1_700_000_000_200,
      staleBefore: 1_699_999_000_000,
    });

    const [claim, select] = db.batches[0];
    expect(claim.sql).toMatch(/^\s*UPDATE production_designs/iu);
    expect(claim.sql).toMatch(/SET\s+status\s*=\s*'cleanup_pending'/iu);
    expect(claim.sql).toMatch(/upload_token\s*=\s*NULL/iu);
    expect(claim.sql).not.toMatch(/upload_started_at/iu);
    expect(claim.sql).toMatch(/status\s+IN\s*\(\s*'upload_pending'\s*,\s*'cart_draft'\s*\)[^;]+expires_at\s*</isu);
    expect(claim.sql).toMatch(/status\s*=\s*'cleanup_pending'[^;]+cleanup_started_at\s*<=/isu);
    expect(claim.values).toContain(CLEANUP_TOKEN);
    expect(select.values).toEqual([SHOP, DESIGN_ID]);
    expect(result).toEqual(authoritativeRow({
      status: 'cleanup_pending',
      cleanup_token: CLEANUP_TOKEN,
      cleanup_started_at: 1_700_000_000_200,
      updated_at: 1_700_000_000_200,
    }));
  });

  it('returns null for a missing claim target and conflicts for a paid or differently claimed row', async () => {
    const missingDb = createFakeD1({
      batchResults: [d1Result({ changes: 0 }), d1Result({ results: [] })],
    });
    await expect(createProductionRepository(missingDb).claimExpiredDraft(cleanupClaim()))
      .resolves.toBeNull();

    const paidDb = createFakeD1({
      batchResults: [
        d1Result({ changes: 0 }),
        d1Result({ results: [databaseRow({ status: 'paid_pending_production' })] }),
      ],
    });
    await expect(createProductionRepository(paidDb).claimExpiredDraft(cleanupClaim()))
      .rejects.toMatchObject({ code: 'production-repository-conflict' });
  });

  it('reclaims a stale cleanup lease with a new token but not a live lease', async () => {
    const reclaimed = databaseRow({
      status: 'cleanup_pending',
      cleanup_token: CLEANUP_TOKEN,
      cleanup_started_at: 1_700_000_000_200,
      updated_at: 1_700_000_000_200,
    });
    const staleDb = createFakeD1({
      batchResults: [d1Result({ changes: 1 }), d1Result({ results: [reclaimed] })],
    });
    await expect(createProductionRepository(staleDb).claimExpiredDraft(cleanupClaim()))
      .resolves.toMatchObject({ cleanupToken: CLEANUP_TOKEN });

    const liveRow = databaseRow({
      status: 'cleanup_pending',
      cleanup_token: 'cln_fedcba0987654321',
      cleanup_started_at: 1_700_000_000_150,
      updated_at: 1_700_000_000_150,
    });
    const liveDb = createFakeD1({
      batchResults: [d1Result(), d1Result({ results: [liveRow] })],
    });
    await expect(createProductionRepository(liveDb).claimExpiredDraft(cleanupClaim()))
      .rejects.toMatchObject({ code: 'production-repository-conflict' });
  });

  it('rejects an equal cleanup lease boundary before touching D1', async () => {
    const db = createFakeD1();

    await expect(createProductionRepository(db).claimExpiredDraft(cleanupClaim({
      claimedAt: 1_700_000_000_200,
      staleBefore: 1_700_000_000_200,
    }))).rejects.toMatchObject({ code: 'invalid-production-repository-input' });
    expect(db.prepared).toHaveLength(0);
  });

  it('deletes only the same cleanup lease token after R2 succeeds', async () => {
    const db = createFakeD1({ runResults: [d1Result({ changes: 1 })] });

    await expect(createProductionRepository(db).deleteClaimedDraft({
      shop: SHOP,
      designId: DESIGN_ID,
      expiresAt: 1_700_000_001_000,
      claimToken: CLEANUP_TOKEN,
    })).resolves.toBe(true);

    const statement = db.prepared[0];
    expect(statement.sql).toMatch(/^\s*DELETE FROM production_designs/iu);
    expect(statement.sql).toMatch(/shop\s*=\s*\?\s+AND\s+design_id\s*=\s*\?\s+AND\s+expires_at\s*=\s*\?/iu);
    expect(statement.sql).toContain("status = 'cleanup_pending'");
    expect(statement.sql).toMatch(/cleanup_token\s*=\s*\?/iu);
    expect(statement.values).toEqual([SHOP, DESIGN_ID, 1_700_000_001_000, CLEANUP_TOKEN]);
  });

  it('rejects malformed cleanup rows instead of normalizing missing values', async () => {
    const db = createFakeD1({ allResults: [d1Result({ results: [{}] })] });

    await expect(createProductionRepository(db).listExpiredDrafts({
      before: 1_700_000_000_200,
      staleBefore: 1_700_000_000_100,
      limit: 100,
    })).rejects.toMatchObject({ code: 'production-repository-failed' });
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
    manifestBytes: 1024,
    manifestKey: `shops/shop-hash/designs/${DESIGN_ID}/manifest.json`,
    bundleSha256: 'b'.repeat(64),
    bundleBytes: 4096,
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
    manifest_bytes: value.manifestBytes,
    manifest_key: value.manifestKey,
    bundle_sha256: value.bundleSha256,
    bundle_bytes: value.bundleBytes,
    bundle_key: value.bundleKey,
    bundle_filename: value.bundleFilename,
    created_at: value.createdAt,
    expires_at: value.expiresAt,
    paid_at: null,
    shopify_order_gid: null,
    shopify_order_name: null,
    error_code: null,
    cleanup_token: null,
    cleanup_started_at: null,
    upload_token: null,
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
    manifestBytes: row.manifest_bytes,
    manifestKey: row.manifest_key,
    bundleSha256: row.bundle_sha256,
    bundleBytes: row.bundle_bytes,
    bundleKey: row.bundle_key,
    bundleFilename: row.bundle_filename,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    shopifyOrderGid: row.shopify_order_gid,
    shopifyOrderName: row.shopify_order_name,
    errorCode: row.error_code,
    cleanupToken: row.cleanup_token,
    cleanupStartedAt: row.cleanup_started_at,
    uploadToken: row.upload_token,
    updatedAt: row.updated_at,
  };
}

function cleanupListRow(overrides = {}) {
  const row = databaseRow();
  return {
    shop: row.shop,
    design_id: row.design_id,
    manifest_key: row.manifest_key,
    bundle_key: row.bundle_key,
    expires_at: row.expires_at,
    cleanup_token: row.cleanup_token,
    cleanup_started_at: row.cleanup_started_at,
    ...overrides,
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

function indexedDesignId(index) {
  return `dsg_${String(index).padStart(16, '0')}`;
}

function paidDesignAt(index, status = 'paid_pending_production') {
  return paidDesign({
    designId: indexedDesignId(index),
    bundleId: `bun_${String(index).padStart(16, '0')}`,
    errorCode: status === 'file_error' ? 'FILE_MISSING' : null,
  });
}

function cleanupClaim(overrides = {}) {
  return {
    shop: SHOP,
    designId: DESIGN_ID,
    expiresAt: 1_700_000_001_000,
    claimToken: CLEANUP_TOKEN,
    claimedAt: 1_700_000_000_200,
    staleBefore: 1_699_999_000_000,
    ...overrides,
  };
}

function d1Result({ changes = 0, results = [] } = {}) {
  return {
    success: true,
    meta: { changes },
    results,
  };
}

function lifecycleReceipt(overrides = {}) {
  return {
    webhook_id: 'wh_1234567890abcdef',
    event_id: 'evt_1234567890abcdef',
    shop: SHOP,
    topic: 'orders/paid',
    order_gid: ORDER_GID,
    received_at: 1_700_000_000_200,
    ...overrides,
  };
}

function lifecycleBatchResults({
  receipt = lifecycleReceipt(), topic, webhookId, receiptInserted = true,
} = {}) {
  const resolvedReceipt = receipt && {
    ...receipt,
    ...(topic ? { topic } : {}),
    ...(webhookId ? { webhook_id: webhookId } : {}),
  };
  return [
    d1Result({ changes: receipt ? 1 : 0 }),
    d1Result({ changes: receipt && receiptInserted ? 1 : 0 }),
    d1Result({ results: resolvedReceipt ? [resolvedReceipt] : [] }),
  ];
}

function createFakeD1({
  allResults = [],
  batchError,
  batchResults = [],
  batchResultsQueue = null,
  firstError,
  firstResults = [],
  runResults = [],
} = {}) {
  const db = {
    prepared: [],
    batches: [],
    rolledBack: false,
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (firstError) throw firstError;
          return firstResults.shift() ?? null;
        },
        async all() {
          return allResults.shift() ?? d1Result();
        },
        async run() {
          return runResults.shift() ?? d1Result();
        },
      };
      db.prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      db.batches.push(statements);
      if (batchError) {
        db.rolledBack = true;
        throw batchError;
      }
      return batchResultsQueue ? batchResultsQueue.shift() : batchResults;
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
