// @vitest-environment node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openServerDatabase } from '../../server/adapters/sqliteD1.js';
import { createStoreConfigRepository, StoreConfigRepositoryError } from './storeConfigRepository.js';

const SHOP = 'merchant-one.myshopify.com';
const OTHER_SHOP = 'merchant-two.myshopify.com';
const NOW = 1_700_000_000_000;
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe('Shopify store config repository', () => {
  it('falls back to a validated legacy config only when the shop has no database row', async () => {
    const runtime = createRuntime(JSON.stringify({ [SHOP]: config() }));
    try {
      const legacy = await runtime.repository.get(SHOP);
      expect(legacy).toMatchObject({ source: 'legacy', status: 'active', revision: 0 });

      await runtime.repository.saveDraft(draft(SHOP));
      const stored = await runtime.repository.get(SHOP);
      expect(stored).toMatchObject({ source: 'database', status: 'draft', revision: 1 });
      expect(stored.config).toEqual(config());
      expect(await runtime.repository.get(OTHER_SHOP)).toBeNull();
    } finally { runtime.close(); }
  });

  it('marks only the matching draft revision active and preserves shop isolation', async () => {
    const runtime = createRuntime();
    try {
      const revision = await runtime.repository.saveDraft(draft(SHOP));
      await runtime.repository.saveDraft(draft(OTHER_SHOP));
      await expect(runtime.repository.markActive({
        shop: SHOP,
        revision: revision + 1,
        activationLockToken: lockToken(),
        transformRegistrationId: 'gid://shopify/CartTransform/11',
        validationRegistrationId: 'gid://shopify/Validation/12',
        updatedAt: NOW + 1,
      })).rejects.toMatchObject({ code: 'store-config-conflict' });

      await runtime.repository.markActive({
        shop: SHOP,
        revision,
        activationLockToken: lockToken(),
        transformRegistrationId: 'gid://shopify/CartTransform/11',
        validationRegistrationId: 'gid://shopify/Validation/12',
        updatedAt: NOW + 2,
      });
      expect(await runtime.repository.get(SHOP)).toMatchObject({
        status: 'active',
        transformRegistrationId: 'gid://shopify/CartTransform/11',
        validationRegistrationId: 'gid://shopify/Validation/12',
      });
      expect(await runtime.repository.get(OTHER_SHOP)).toMatchObject({ status: 'draft' });
    } finally { runtime.close(); }
  });

  it('increments revisions and prevents a stale activation from replacing a newer draft', async () => {
    const runtime = createRuntime();
    try {
      expect(await runtime.repository.saveDraft(draft(SHOP))).toBe(1);
      await expect(runtime.repository.saveDraft({ ...draft(SHOP), updatedAt: NOW + 1 }))
        .rejects.toMatchObject({ code: 'store-config-conflict' });
      await runtime.repository.markActivationFailed({
        shop: SHOP,
        revision: 1,
        activationLockToken: lockToken(),
        errorCode: 'FUNCTION_ACTIVATION_FAILED',
        updatedAt: NOW + 1,
      });
      expect(await runtime.repository.saveDraft({ ...draft(SHOP), updatedAt: NOW + 1 })).toBe(2);
      await expect(runtime.repository.markActivationFailed({
        shop: SHOP,
        revision: 1,
        activationLockToken: lockToken(),
        errorCode: 'FUNCTION_ACTIVATION_FAILED',
        updatedAt: NOW + 2,
      })).rejects.toBeInstanceOf(StoreConfigRepositoryError);
      expect(await runtime.repository.get(SHOP)).toMatchObject({ status: 'draft', revision: 2 });
    } finally { runtime.close(); }
  });
});

function createRuntime(legacyConfigJson = '{}') {
  const directory = mkdtempSync(path.join(tmpdir(), 'store-config-repository-'));
  temporaryDirectories.push(directory);
  const opened = openServerDatabase({
    databasePath: path.join(directory, 'jersey.sqlite'),
    projectRoot: process.cwd(),
  });
  return {
    repository: createStoreConfigRepository(opened.binding, { legacyConfigJson }),
    close: opened.close,
  };
}

function config() {
  return {
    productId: 'fn8788-jersey',
    currency: 'USD',
    jerseyVariants: { s: '101', m: '102', l: '103', xl: '104' },
    surchargeVariants: { 8: '201', 10: '202' },
  };
}

function draft(shop) {
  return {
    shop,
    shopifyProductGid: 'gid://shopify/Product/99',
    config: config(),
    encryptedSigningSecret: {
      ciphertext: 'A'.repeat(32),
      iv: 'B'.repeat(16),
      keyVersion: 1,
    },
    activationLockToken: lockToken(),
    activationLockExpiresAt: NOW + 15 * 60 * 1000,
    updatedAt: NOW,
  };
}

function lockToken() {
  return 'activation_lock_token_1234567890';
}
