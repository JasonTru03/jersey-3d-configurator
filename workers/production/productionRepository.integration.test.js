// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createProductionRepository } from './productionRepository.js';

const SHOP = 'testcsj.myshopify.com';
const ORDER_GID = 'gid://shopify/Order/1234567890';

describe('production repository against node:sqlite', () => {
  it('persists upload_pending before atomically finalizing the same upload', async () => {
    await withDatabase(async (db) => {
      const repository = createProductionRepository(createD1Adapter(db));
      const pending = await repository.createUploadPending(draft(0));

      expect(pending.status).toBe('upload_pending');
      expect(statuses(db, 0, 1)).toEqual(['upload_pending']);

      const finalized = await repository.finalizeCartDraft({
        shop: SHOP,
        designId: indexedDesignId(0),
        uploadId: 'upl_0000000000000000',
        updatedAt: 1_700_000_000_100,
      });
      expect(finalized.status).toBe('cart_draft');
      expect(statuses(db, 0, 1)).toEqual(['cart_draft']);
    });
  });

  it.each([2, 250])('atomically records %i paid designs from the real migration', async (count) => {
    await withDatabase(async (db) => {
      const repository = createProductionRepository(createD1Adapter(db));
      const designs = await createBoundDrafts(repository, count);

      await expect(repository.recordOrderLifecycle({
        delivery: delivery(),
        designs,
        status: 'paid_pending_production',
      })).resolves.toMatchObject({ designCount: count });

      expect(scalar(db, `
        SELECT COUNT(*) AS value FROM production_designs
        WHERE status = 'paid_pending_production'
      `)).toBe(count);
      expect(scalar(db, 'SELECT COUNT(*) AS value FROM shopify_webhook_deliveries')).toBe(1);
    });
  });

  it('prevents partial lifecycle writes and deduplicates webhook identities', async () => {
    await withDatabase(async (db) => {
      const repository = createProductionRepository(createD1Adapter(db));
      const designs = await createBoundDrafts(repository, 4);

      await expect(repository.recordOrderLifecycle({
        delivery: delivery(),
        designs: [designs[0], { ...designs[1], bundleId: 'bun_9999999999999999' }],
        status: 'paid_pending_production',
      })).rejects.toMatchObject({ code: 'production-repository-conflict' });
      expect(statuses(db, 0, 2)).toEqual(['cart_draft', 'cart_draft']);
      expect(scalar(db, 'SELECT COUNT(*) AS value FROM shopify_webhook_deliveries')).toBe(0);

      await repository.recordOrderLifecycle({
        delivery: delivery(), designs: designs.slice(0, 2), status: 'paid_pending_production',
      });
      await repository.recordOrderLifecycle({
        delivery: delivery(), designs: designs.slice(0, 2), status: 'paid_pending_production',
      });
      await repository.recordOrderLifecycle({
        delivery: delivery({ webhookId: 'wh_2222222222222222' }),
        designs: designs.slice(0, 2),
        status: 'paid_pending_production',
      });
      expect(scalar(db, 'SELECT COUNT(*) AS value FROM shopify_webhook_deliveries')).toBe(1);

      await expect(repository.recordOrderLifecycle({
        delivery: delivery({ orderGid: 'gid://shopify/Order/9999999999' }),
        designs: designs.slice(2),
        status: 'paid_pending_production',
      })).rejects.toMatchObject({ code: 'production-repository-conflict' });
      expect(statuses(db, 2, 4)).toEqual(['cart_draft', 'cart_draft']);

      await repository.recordOrderLifecycle({
        delivery: delivery({
          webhookId: 'wh_3333333333333333',
          eventId: 'evt_3333333333333333',
          topic: 'refunds/create',
          receivedAt: 1_700_000_000_400,
        }),
        designs: [{ designId: indexedDesignId(0), updatedAt: 1_700_000_000_400 }],
        status: 'refunded',
      });
      await expect(repository.recordOrderLifecycle({
        delivery: delivery({
          webhookId: 'wh_4444444444444444',
          eventId: 'evt_4444444444444444',
          topic: 'orders/cancelled',
          receivedAt: 1_700_000_000_350,
        }),
        designs: [{ designId: indexedDesignId(0), updatedAt: 1_700_000_000_350 }],
        status: 'cancelled',
      })).rejects.toMatchObject({ code: 'production-repository-conflict' });
      expect(statuses(db, 0, 1)).toEqual(['refunded']);

      const adapter = createD1Adapter(db);
      await expect(adapter.batch([
        adapter.prepare("UPDATE production_designs SET status = 'cancelled' WHERE design_id = ?")
          .bind(indexedDesignId(0)),
        adapter.prepare(`
          INSERT INTO shopify_webhook_deliveries (
            webhook_id, event_id, shop, topic, order_gid, received_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          'wh_1111111111111111', 'evt_rollback00000001', SHOP,
          'orders/paid', ORDER_GID, 1_700_000_000_500,
        ),
      ])).rejects.toThrow();
      expect(statuses(db, 0, 1)).toEqual(['refunded']);
    });
  });

  it('enforces cleanup consistency, lease ordering and the cleanup index', async () => {
    await withDatabase(async (db) => {
      const repository = createProductionRepository(createD1Adapter(db));
      await createBoundDrafts(repository, 1);

      await expect(repository.claimExpiredDraft({
        shop: SHOP,
        designId: indexedDesignId(0),
        expiresAt: 1_700_000_001_000,
        claimToken: 'cln_1111111111111111',
        claimedAt: 1_700_000_002_000,
        staleBefore: 1_700_000_001_999,
      })).resolves.toMatchObject({ status: 'cleanup_pending' });

      expect(() => db.prepare(`
        UPDATE production_designs
        SET status = 'cart_draft'
        WHERE design_id = ?
      `).run(indexedDesignId(0))).toThrow();
      expect(db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'production_designs_cleanup_started_at_idx'
      `).get()?.name).toBe('production_designs_cleanup_started_at_idx');
    });
  });
});

async function withDatabase(run) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(await readFile('migrations/0001_production_designs.sql', 'utf8'));
    await run(db);
  } finally {
    db.close();
  }
}

function createD1Adapter(database) {
  return {
    prepare(sql) {
      return new D1StatementAdapter(database, sql);
    },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => statement.executeBatch());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

class D1StatementAdapter {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values) ?? null;
    return column === undefined ? row : row?.[column] ?? null;
  }

  async all() {
    return d1Result({ results: this.database.prepare(this.sql).all(...this.values) });
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return d1Result({ changes: Number(result.changes) });
  }

  executeBatch() {
    if (isWriteSql(this.sql)) {
      const result = this.database.prepare(this.sql).run(...this.values);
      return d1Result({ changes: Number(result.changes) });
    }
    return d1Result({ results: this.database.prepare(this.sql).all(...this.values) });
  }
}

function isWriteSql(sql) {
  return /^\s*(?:INSERT|UPDATE|DELETE)\b/iu.test(sql)
    || /\bUPDATE\s+production_designs\b/iu.test(sql)
    || /\bINSERT\s+OR\s+IGNORE\s+INTO\s+shopify_webhook_deliveries\b/iu.test(sql);
}

function d1Result({ changes = 0, results = [] } = {}) {
  return { success: true, meta: { changes }, results };
}

async function createBoundDrafts(repository, count) {
  const designs = [];
  for (let index = 0; index < count; index += 1) {
    await repository.createCartDraft(draft(index));
    await repository.bindCartQuote({
      shop: SHOP,
      designId: indexedDesignId(index),
      bundleId: indexedBundleId(index),
      updatedAt: 1_700_000_000_100,
    });
    designs.push({
      designId: indexedDesignId(index),
      bundleId: indexedBundleId(index),
      orderName: '#1001',
      paidAt: 1_700_000_000_150,
      updatedAt: 1_700_000_000_200,
      errorCode: null,
    });
  }
  return designs;
}

function draft(index) {
  const fingerprint = index.toString(16).padStart(8, '0');
  const designId = indexedDesignId(index);
  return {
    designId,
    shop: SHOP,
    uploadId: `upl_${String(index).padStart(16, '0')}`,
    productId: 'fn8788-jersey',
    variantId: '48039101923479',
    size: 'm',
    modelId: 'chelsea-jersey',
    modelVersion: '2026.08.01',
    uvExportVersion: '2',
    designFingerprint: fingerprint,
    manifestSha256: index.toString(16).padStart(64, '0'),
    manifestKey: `shops/verify/${designId}/manifest.json`,
    bundleKey: `shops/verify/${designId}/bundle.zip`,
    bundleFilename: `fn8788-jersey-design-${fingerprint}.zip`,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_001_000,
    updatedAt: 1_700_000_000_000,
  };
}

function delivery(overrides = {}) {
  return {
    webhookId: 'wh_1111111111111111',
    eventId: 'evt_1111111111111111',
    shop: SHOP,
    topic: 'orders/paid',
    orderGid: ORDER_GID,
    receivedAt: 1_700_000_000_200,
    ...overrides,
  };
}

function indexedDesignId(index) {
  return `dsg_${String(index).padStart(16, '0')}`;
}

function indexedBundleId(index) {
  return `bun_${String(index).padStart(16, '0')}`;
}

function statuses(db, start, end) {
  return Array.from({ length: end - start }, (_, offset) => indexedDesignId(start + offset))
    .map((designId) => db.prepare(
      'SELECT status FROM production_designs WHERE design_id = ?',
    ).get(designId).status);
}

function scalar(db, sql) {
  return Number(db.prepare(sql).get().value);
}
