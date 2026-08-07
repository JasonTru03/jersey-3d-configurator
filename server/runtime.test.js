// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAdminPasswordHash } from './admin/adminAuth.js';
import { createServerRuntime } from './runtime.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('Tencent server runtime', () => {
  it('wires persistent bindings into the existing Worker router and static build', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'jersey-server-runtime-'));
    temporaryDirectories.push(directory);
    const distDirectory = path.join(directory, 'dist');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(distDirectory));
    await writeFile(path.join(distDirectory, 'index.html'), '<h1>Runtime</h1>');
    const runtime = createServerRuntime({
      config: {
        adminPasswordHash: await createAdminPasswordHash('test-admin-password', {
          randomBytes: () => Buffer.alloc(16, 6),
        }),
        adminSessionSecret: 'a'.repeat(32),
        adminShop: 'test.myshopify.com',
        projectRoot: process.cwd(),
        dataDirectory: path.join(directory, 'data'),
        distDirectory,
        localProductionFiles: 'false',
        shopifyStoreConfigJson: JSON.stringify({ 'test.myshopify.com': {} }),
        shopifyApiSecret: 's'.repeat(32),
        cartQuoteSigningSecret: 'q'.repeat(32),
        turnstileSiteKey: 'site-key',
        turnstileSecretKey: 't'.repeat(32),
      },
    });

    const config = await runtime.handler(new Request(
      'https://jersey.example/api/production-drafts/config',
    ));
    const staticPage = await runtime.handler(new Request('https://jersey.example/'));
    const adminPage = await runtime.handler(new Request('https://jersey.example/admin/'));

    expect(await config.json()).toEqual({ turnstileSiteKey: 'site-key' });
    expect(await staticPage.text()).toBe('<h1>Runtime</h1>');
    expect(await adminPage.text()).toContain('球衣定制订单后台');
    expect(runtime.env.PRODUCTION_DB).toBeTruthy();
    expect(runtime.env.PRODUCTION_ASSETS).toBeTruthy();
    runtime.close();
  });
});
