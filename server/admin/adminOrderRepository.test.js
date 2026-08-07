// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openServerDatabase } from '../adapters/sqliteD1.js';
import { createAdminOrderRepository } from './adminOrderRepository.js';

const temporaryDirectories = [];
const SHOP = 'test.myshopify.com';

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('admin order repository', () => {
  it('lists only order-linked designs for the configured shop with safe filters', async () => {
    const opened = await openDatabase();
    insertDesign(opened.database, {
      designId: 'dsg_1234567890abcdef',
      orderGid: 'gid://shopify/Order/1001',
      orderName: '#1001',
      paidAt: 2_000,
      status: 'paid_pending_production',
    });
    insertDesign(opened.database, {
      designId: 'dsg_2234567890abcdef',
      orderGid: 'gid://shopify/Order/1002',
      orderName: '#1002',
      paidAt: 3_000,
      status: 'refunded',
    });
    insertDesign(opened.database, {
      designId: 'dsg_3234567890abcdef',
      orderGid: null,
      orderName: null,
      paidAt: null,
      status: 'cart_draft',
    });
    insertDesign(opened.database, {
      designId: 'dsg_4234567890abcdef',
      orderGid: 'gid://shopify/Order/2001',
      orderName: '#2001',
      paidAt: 4_000,
      shop: 'other.myshopify.com',
      status: 'paid_pending_production',
    });
    indexBundle(opened.database, 'shops/test/dsg_1234567890abcdef/design.zip');
    const repository = createAdminOrderRepository(opened.database);

    const all = repository.listOrders({ shop: SHOP });
    const filtered = repository.listOrders({
      shop: SHOP,
      query: '1001',
      status: 'paid_pending_production',
      from: 1_500,
      to: 2_500,
    });

    expect(all.total).toBe(2);
    expect(all.items.map(({ orderName }) => orderName)).toEqual(['#1002', '#1001']);
    expect(filtered).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(filtered.items[0]).toMatchObject({
      designId: 'dsg_1234567890abcdef',
      orderName: '#1001',
      status: 'paid_pending_production',
      bundleIndexed: true,
    });
    opened.close();
  });

  it('finds an order-owned bundle and records download outcomes', async () => {
    const opened = await openDatabase();
    insertDesign(opened.database, {
      designId: 'dsg_5234567890abcdef',
      orderGid: 'gid://shopify/Order/1005',
      orderName: '#1005',
      paidAt: 5_000,
      status: 'paid_pending_production',
    });
    const repository = createAdminOrderRepository(opened.database);

    expect(repository.getOrderFile({
      shop: SHOP,
      designId: 'dsg_5234567890abcdef',
    })).toMatchObject({
      bundleFilename: 'fn8788-jersey-design-12345678.zip',
      bundleKey: 'shops/test/dsg_5234567890abcdef/design.zip',
      orderName: '#1005',
    });
    repository.recordDownload({
      designId: 'dsg_5234567890abcdef',
      downloadedAt: 6_000,
      outcome: 'started',
      shop: SHOP,
    });
    repository.recordDownload({
      designId: 'dsg_5234567890abcdef',
      downloadedAt: 7_000,
      outcome: 'missing',
      shop: SHOP,
    });

    expect(opened.database.prepare(`
      SELECT outcome, downloaded_at
      FROM admin_download_audit
      ORDER BY downloaded_at
    `).all()).toEqual([
      { outcome: 'started', downloaded_at: 6_000 },
      { outcome: 'missing', downloaded_at: 7_000 },
    ]);
    opened.close();
  });
});

async function openDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), 'jersey-admin-orders-'));
  temporaryDirectories.push(directory);
  return openServerDatabase({
    databasePath: path.join(directory, 'jersey.sqlite'),
    projectRoot: process.cwd(),
  });
}

function insertDesign(database, {
  designId,
  orderGid,
  orderName,
  paidAt,
  shop = SHOP,
  status,
}) {
  const suffix = designId.slice(4, 12);
  database.prepare(`
    INSERT INTO production_designs (
      design_id, shop, upload_id, bundle_id, status, product_id, variant_id,
      size, model_id, model_version, uv_export_version, design_fingerprint,
      manifest_sha256, manifest_bytes, manifest_key, bundle_sha256, bundle_bytes,
      bundle_key, bundle_filename, created_at, expires_at, paid_at,
      shopify_order_gid, shopify_order_name, error_code, upload_token,
      cleanup_token, cleanup_started_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      NULL, NULL, NULL, NULL, ?
    )
  `).run(
    designId,
    shop,
    `upl_${suffix}890abcdef`,
    `bun_${suffix}890abcdef`,
    status,
    'fn8788-jersey',
    '123456789',
    's',
    'chelsea-jersey',
    '1',
    '1',
    '12345678',
    'a'.repeat(64),
    100,
    `shops/test/${designId}/manifest.json`,
    'b'.repeat(64),
    200,
    `shops/test/${designId}/design.zip`,
    'fn8788-jersey-design-12345678.zip',
    1_000,
    100_000,
    paidAt,
    orderGid,
    orderName,
    paidAt ?? 1_000,
  );
}

function indexBundle(database, key) {
  database.prepare(`
    INSERT INTO server_objects (
      key, size, native_sha256, http_metadata_json, custom_metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(key, 200, 'b'.repeat(64), '{}', '{}', 1_000, 1_000);
}
