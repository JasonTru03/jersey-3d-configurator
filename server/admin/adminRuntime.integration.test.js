// @vitest-environment node

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminPasswordHash } from './adminAuth.js';
import { createServerRuntime } from '../runtime.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('admin runtime integration', () => {
  it('logs in, lists a paid order and streams its real filesystem object', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'jersey-admin-runtime-'));
    temporaryDirectories.push(directory);
    const dataDirectory = path.join(directory, 'data');
    const distDirectory = path.join(directory, 'dist');
    await mkdir(distDirectory);
    await writeFile(path.join(distDirectory, 'index.html'), '<h1>Runtime</h1>');
    const passwordHash = await createAdminPasswordHash('integration-password', {
      randomBytes: () => Buffer.alloc(16, 6),
    });
    const runtime = createServerRuntime({
      config: {
        adminPasswordHash: passwordHash,
        adminSessionSecret: 'a'.repeat(32),
        adminShop: 'test.myshopify.com',
        projectRoot: process.cwd(),
        dataDirectory,
        distDirectory,
        localProductionFiles: 'false',
        shopifyStoreConfigJson: JSON.stringify({ 'test.myshopify.com': {} }),
        shopifyApiSecret: 's'.repeat(32),
        cartQuoteSigningSecret: 'q'.repeat(32),
        turnstileSiteKey: 'site-key',
        turnstileSecretKey: 't'.repeat(32),
      },
      now: () => 10_000,
    });
    const bundle = Buffer.from('integration-production-zip');
    const sha256 = createHash('sha256').update(bundle).digest('hex');
    const bundleKey = 'shops/test/designs/dsg_6234567890abcdef/design.zip';
    const database = new DatabaseSync(path.join(dataDirectory, 'jersey.sqlite'));
    insertPaidDesign(database, { bundleKey, bundleBytes: bundle.byteLength, sha256 });
    database.close();
    await runtime.env.PRODUCTION_ASSETS.put(bundleKey, bundle, {
      sha256,
      httpMetadata: { contentType: 'application/zip' },
    });

    const login = await runtime.handler(new Request('https://jersey.example/admin/api/login', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '127.0.0.1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ password: 'integration-password' }),
    }));
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const orders = await runtime.handler(new Request('https://jersey.example/admin/api/orders', {
      headers: { cookie },
    }));
    const download = await runtime.handler(new Request(
      'https://jersey.example/admin/api/orders/dsg_6234567890abcdef/download',
      { headers: { cookie } },
    ));

    expect(login.status).toBe(204);
    expect(await orders.json()).toMatchObject({
      total: 1,
      items: [{ orderName: '#1601', bundleIndexed: true }],
    });
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bundle);

    const auditDatabase = new DatabaseSync(path.join(dataDirectory, 'jersey.sqlite'));
    expect(auditDatabase.prepare(`
      SELECT design_id, outcome FROM admin_download_audit
    `).all()).toEqual([{
      design_id: 'dsg_6234567890abcdef',
      outcome: 'started',
    }]);
    auditDatabase.close();
    runtime.close();
  });
});

function insertPaidDesign(database, { bundleKey, bundleBytes, sha256 }) {
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
    'dsg_6234567890abcdef',
    'test.myshopify.com',
    'upl_6234567890abcdef',
    'bun_6234567890abcdef',
    'paid_pending_production',
    'fn8788-jersey',
    '123456789',
    's',
    'chelsea-jersey',
    '1',
    '1',
    '12345678',
    'a'.repeat(64),
    100,
    'shops/test/designs/dsg_6234567890abcdef/manifest.json',
    sha256,
    bundleBytes,
    bundleKey,
    'fn8788-jersey-design-12345678.zip',
    1_000,
    100_000,
    2_000,
    'gid://shopify/Order/1601',
    '#1601',
    2_000,
  );
}
