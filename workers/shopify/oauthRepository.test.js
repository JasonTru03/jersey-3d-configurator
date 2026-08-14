// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openServerDatabase } from '../../server/adapters/sqliteD1.js';
import { createOAuthRepository } from './oauthRepository.js';

const SHOP = 'oauth-test.myshopify.com';
const NOW = 1_700_000_000_000;
const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe('Shopify OAuth repository', () => {
  it('consumes each state exactly once and rejects expired state', async () => {
    const runtime = createRuntime();
    try {
      await runtime.repository.createSession({
        stateHash: 'a'.repeat(64), shop: SHOP, createdAt: NOW, expiresAt: NOW + 60_000,
      });
      await runtime.repository.consumeSession({
        stateHash: 'a'.repeat(64), shop: SHOP, consumedAt: NOW + 1,
      });
      await expect(runtime.repository.consumeSession({
        stateHash: 'a'.repeat(64), shop: SHOP, consumedAt: NOW + 2,
      })).rejects.toMatchObject({ code: 'oauth-session-invalid' });
      await runtime.repository.createSession({
        stateHash: 'b'.repeat(64), shop: SHOP, createdAt: NOW, expiresAt: NOW + 10,
      });
      await expect(runtime.repository.consumeSession({
        stateHash: 'b'.repeat(64), shop: SHOP, consumedAt: NOW + 11,
      })).rejects.toMatchObject({ code: 'oauth-session-invalid' });
    } finally { runtime.close(); }
  });

  it('stores encrypted installation metadata and clears token on uninstall', async () => {
    const runtime = createRuntime();
    try {
      await runtime.repository.saveInstallation(installation());
      expect(await runtime.repository.getInstallation(SHOP)).toMatchObject({
        status: 'active',
        ciphertext: 'A'.repeat(44),
        scopes: ['read_orders', 'write_app_proxy'],
      });

      await runtime.repository.markUninstalled({
        webhookId: 'webhook-uninstall-1234', shop: SHOP, event: 'uninstalled',
        scopes: [], createdAt: NOW + 10,
      });
      expect(await runtime.repository.getInstallation(SHOP)).toMatchObject({
        status: 'uninstalled', ciphertext: null, iv: null, keyVersion: null,
      });
      const audit = runtime.database.prepare(`
        SELECT event FROM shopify_installation_audit WHERE shop = ? ORDER BY id
      `).all(SHOP).map(({ event }) => event);
      expect(audit).toEqual(['installed', 'uninstalled']);
    } finally { runtime.close(); }
  });

  it('marks missing required scopes invalid and supports reinstall', async () => {
    const runtime = createRuntime();
    try {
      await runtime.repository.saveInstallation(installation());
      await runtime.repository.updateScopes({
        webhookId: 'webhook-scopes-123456', shop: SHOP, event: 'scopes_updated',
        scopes: ['read_orders'], requiredScopes: ['read_orders', 'write_app_proxy'],
        createdAt: NOW + 1,
      });
      expect((await runtime.repository.getInstallation(SHOP)).status).toBe('scope_invalid');
      await runtime.repository.markUninstalled({
        webhookId: 'webhook-uninstall-5678', shop: SHOP, event: 'uninstalled',
        scopes: [], createdAt: NOW + 2,
      });
      await runtime.repository.saveInstallation({ ...installation(), installedAt: NOW + 3 });
      expect((await runtime.repository.getInstallation(SHOP)).status).toBe('active');
      expect(runtime.database.prepare(`
        SELECT event FROM shopify_installation_audit WHERE shop = ? ORDER BY id DESC LIMIT 1
      `).get(SHOP).event).toBe('reinstalled');
    } finally { runtime.close(); }
  });

  it('does not let a duplicate old uninstall clear a reinstalled token', async () => {
    const runtime = createRuntime();
    try {
      await runtime.repository.saveInstallation(installation());
      const uninstall = {
        webhookId: 'webhook-uninstall-replay', shop: SHOP, event: 'uninstalled',
        scopes: [], createdAt: NOW + 1,
      };
      await runtime.repository.markUninstalled(uninstall);
      await runtime.repository.saveInstallation({ ...installation(), installedAt: NOW + 2 });
      await runtime.repository.markUninstalled({ ...uninstall, createdAt: NOW + 3 });

      expect(await runtime.repository.getInstallation(SHOP)).toMatchObject({
        status: 'active', ciphertext: 'A'.repeat(44),
      });
    } finally { runtime.close(); }
  });

  it('ignores an older scope event after a newer scope event', async () => {
    const runtime = createRuntime();
    try {
      await runtime.repository.saveInstallation(installation());
      await runtime.repository.updateScopes({
        webhookId: 'webhook-scopes-newest', shop: SHOP, event: 'scopes_updated',
        scopes: ['read_orders', 'write_app_proxy'],
        requiredScopes: ['read_orders', 'write_app_proxy'], createdAt: NOW + 20,
      });
      await runtime.repository.updateScopes({
        webhookId: 'webhook-scopes-older1', shop: SHOP, event: 'scopes_updated',
        scopes: ['read_orders'], requiredScopes: ['read_orders', 'write_app_proxy'],
        createdAt: NOW + 10,
      });

      expect(await runtime.repository.getInstallation(SHOP)).toMatchObject({
        status: 'active', scopes: ['read_orders', 'write_app_proxy'],
      });
    } finally { runtime.close(); }
  });
});

function createRuntime() {
  const directory = mkdtempSync(path.join(tmpdir(), 'oauth-repository-'));
  directories.push(directory);
  const opened = openServerDatabase({
    databasePath: path.join(directory, 'jersey.sqlite'),
    projectRoot: process.cwd(),
  });
  return {
    database: opened.database,
    repository: createOAuthRepository(opened.binding),
    close: opened.close,
  };
}

function installation() {
  return {
    shop: SHOP,
    status: 'active',
    ciphertext: 'A'.repeat(44),
    iv: 'B'.repeat(16),
    keyVersion: 1,
    scopes: ['write_app_proxy', 'read_orders'],
    installedAt: NOW,
  };
}
