// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openServerDatabase } from '../../server/adapters/sqliteD1.js';
import { createPrivacyRepository } from './privacyRepository.js';
import { createOAuthRepository } from './oauthRepository.js';

const SHOP = 'privacy-test.myshopify.com';
const OTHER_SHOP = 'other-shop.myshopify.com';
const NOW = 1_700_000_000_000;
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe('Shopify privacy repository', () => {
  it('prepares a minimal data response without exposing private object keys', async () => {
    const runtime = createRuntime();
    try {
      insertDesign(runtime.database, { designId: 'dsg_1234567890abcdef', shop: SHOP, orderId: '1001' });
      await runtime.repository.recordRequest(request({
        topic: 'customers/data_request',
        requestId: '7001',
        orderGids: ['gid://shopify/Order/1001'],
      }));
      const designs = await runtime.repository.listDesigns({
        shop: SHOP,
        topic: 'customers/data_request',
        orderGids: ['gid://shopify/Order/1001'],
      });
      await runtime.repository.completeDataRequest({
        ...request({ topic: 'customers/data_request', requestId: '7001', orderGids: ['gid://shopify/Order/1001'] }),
        designs,
        completedAt: NOW + 1,
      });

      const stored = await runtime.repository.getRequest('privacy-webhook-12345678');
      expect(stored.status).toBe('response_ready');
      expect(stored.resultJson).toContain('dsg_1234567890abcdef');
      expect(stored.resultJson).not.toMatch(/manifestKey|bundleKey|shops\//u);
    } finally { runtime.close(); }
  });

  it('deletes only requested order rows, receipts and download audits', async () => {
    const runtime = createRuntime();
    try {
      insertDesign(runtime.database, { designId: 'dsg_1234567890abcdef', shop: SHOP, orderId: '1001' });
      insertDesign(runtime.database, { designId: 'dsg_2234567890abcdef', shop: SHOP, orderId: '1002' });
      insertDesign(runtime.database, { designId: 'dsg_3234567890abcdef', shop: OTHER_SHOP, orderId: '1001' });
      await runtime.repository.recordRequest(request({
        topic: 'customers/redact', requestId: '99', orderGids: ['gid://shopify/Order/1001'],
      }));
      const designs = await runtime.repository.listDesigns({
        shop: SHOP, topic: 'customers/redact', orderGids: ['gid://shopify/Order/1001'],
      });
      await runtime.repository.completeRedaction({
        ...request({ topic: 'customers/redact', requestId: '99', orderGids: ['gid://shopify/Order/1001'] }),
        designs,
        completedAt: NOW + 1,
      });

      expect(designIds(runtime.database)).toEqual([
        'dsg_2234567890abcdef',
        'dsg_3234567890abcdef',
      ]);
      expect(runtime.database.prepare('SELECT COUNT(*) AS total FROM admin_download_audit').get().total).toBe(2);
      expect(runtime.database.prepare(`
        SELECT COUNT(*) AS total FROM shopify_webhook_deliveries
        WHERE shop = ? AND order_gid = ?
      `).get(SHOP, 'gid://shopify/Order/1001').total).toBe(0);
    } finally { runtime.close(); }
  });

  it('shop redaction stays isolated and is idempotent', async () => {
    const runtime = createRuntime();
    try {
      insertDesign(runtime.database, { designId: 'dsg_1234567890abcdef', shop: SHOP, orderId: '1001' });
      insertDesign(runtime.database, { designId: 'dsg_3234567890abcdef', shop: OTHER_SHOP, orderId: '1001' });
      await runtime.oauthRepository.saveInstallation({
        shop: SHOP,
        status: 'active',
        ciphertext: 'A'.repeat(44),
        iv: 'B'.repeat(16),
        keyVersion: 1,
        scopes: ['read_orders'],
        installedAt: NOW,
      });
      const value = request({ topic: 'shop/redact', requestId: '123', orderGids: [] });
      await runtime.repository.recordRequest(value);
      await runtime.repository.recordRequest(value);
      const designs = await runtime.repository.listDesigns({ shop: SHOP, topic: 'shop/redact', orderGids: [] });
      await runtime.repository.completeRedaction({ ...value, designs, completedAt: NOW + 1 });

      expect(designIds(runtime.database)).toEqual(['dsg_3234567890abcdef']);
      expect((await runtime.repository.getRequest(value.webhookId)).status).toBe('completed');
      expect(await runtime.oauthRepository.getInstallation(SHOP)).toBeNull();
      expect(runtime.database.prepare(`
        SELECT COUNT(*) AS total FROM shopify_installation_audit WHERE shop = ?
      `).get(SHOP).total).toBe(0);
    } finally { runtime.close(); }
  });

  it('accepts separate redaction requests for the same customer', async () => {
    const runtime = createRuntime();
    try {
      const first = request({
        topic: 'customers/redact', requestId: '99', orderGids: [],
      });
      const second = { ...first, webhookId: 'privacy-webhook-87654321' };

      await runtime.repository.recordRequest(first);
      await runtime.repository.recordRequest(second);

      expect((await runtime.repository.getRequest(first.webhookId)).requestId).toBe('99');
      expect((await runtime.repository.getRequest(second.webhookId)).requestId).toBe('99');
    } finally { runtime.close(); }
  });
});

function createRuntime() {
  const directory = mkdtempSync(path.join(tmpdir(), 'privacy-repository-'));
  temporaryDirectories.push(directory);
  const opened = openServerDatabase({
    databasePath: path.join(directory, 'jersey.sqlite'),
    projectRoot: process.cwd(),
  });
  return {
    database: opened.database,
    oauthRepository: createOAuthRepository(opened.binding),
    repository: createPrivacyRepository(opened.binding),
    close: opened.close,
  };
}

function request(overrides) {
  return {
    webhookId: 'privacy-webhook-12345678',
    shop: SHOP,
    receivedAt: NOW,
    ...overrides,
  };
}

function insertDesign(database, { designId, shop, orderId }) {
  const uploadId = `upl_${designId.slice(4)}`;
  const bundleId = `bun_${designId.slice(4)}`;
  const orderGid = `gid://shopify/Order/${orderId}`;
  database.prepare(`
    INSERT INTO production_designs (
      design_id, shop, upload_id, bundle_id, status, product_id, variant_id,
      size, model_id, model_version, uv_export_version, design_fingerprint,
      manifest_sha256, manifest_bytes, manifest_key, bundle_sha256, bundle_bytes,
      bundle_key, bundle_filename, created_at, expires_at, paid_at,
      shopify_order_gid, shopify_order_name, error_code, upload_token,
      cleanup_token, cleanup_started_at, updated_at
    ) VALUES (?, ?, ?, ?, 'paid_pending_production', 'fn8788-jersey', '12345678901234',
      's', 'chelsea', '1', '1', 'deadbeef', ?, 100, ?, ?, 200,
      ?, 'fn8788-jersey-design-deadbeef.zip', ?, ?, ?, ?, '#1001', NULL, NULL,
      NULL, NULL, ?)
  `).run(
    designId, shop, uploadId, bundleId, 'a'.repeat(64),
    `shops/${shop}/designs/${designId}/manifest.json`, 'b'.repeat(64),
    `shops/${shop}/designs/${designId}/bundle.zip`, NOW - 1000, NOW + 1000,
    NOW - 500, orderGid, NOW,
  );
  database.prepare(`
    INSERT INTO shopify_webhook_deliveries
      (webhook_id, event_id, shop, topic, order_gid, received_at)
    VALUES (?, NULL, ?, 'orders/paid', ?, ?)
  `).run(`delivery-${designId}`, shop, orderGid, NOW);
  database.prepare(`
    INSERT INTO admin_download_audit (shop, design_id, downloaded_at, outcome)
    VALUES (?, ?, ?, 'started')
  `).run(shop, designId, NOW);
}

function designIds(database) {
  return database.prepare('SELECT design_id FROM production_designs ORDER BY design_id')
    .all().map(({ design_id: designId }) => designId);
}
