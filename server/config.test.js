// @vitest-environment node

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAdminPasswordHash } from './admin/adminAuth.js';
import { readServerConfig } from './config.js';

describe('server configuration', () => {
  it('normalizes an explicit production configuration without exposing secret values', async () => {
    const config = readServerConfig({
      projectRoot: process.cwd(),
      source: await validEnvironment(),
    });

    expect(config).toMatchObject({
      port: 8080,
      publicOrigin: 'https://jersey.example',
      trustProxy: true,
      localProductionFiles: 'false',
      adminShop: 'test.myshopify.com',
      adminShops: ['test.myshopify.com', 'second.myshopify.com'],
    });
    expect(config.dataDirectory).toBe(path.resolve(process.cwd(), '.server-test-data'));
  });

  it.each([
    ['HTTP public origin', { PUBLIC_ORIGIN: 'http://jersey.example' }],
    ['enabled local files', { LOCAL_PRODUCTION_FILES: 'true' }],
    ['short signing secret', { CART_QUOTE_SIGNING_SECRET: 'short' }],
    ['placeholder secret', { SHOPIFY_API_SECRET: 'CHANGE_ME_WITH_AT_LEAST_32_CHARACTERS' }],
    ['invalid Shopify API key', { SHOPIFY_API_KEY: 'short' }],
    ['invalid token encryption key', { SHOPIFY_TOKEN_ENCRYPTION_KEY: 'not-base64' }],
    ['invalid store JSON', { SHOPIFY_STORE_CONFIG_JSON: '{bad' }],
    ['invalid store domain', {
      SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({
        'TEST.myshopify.com': {},
        'test.myshopify.com': {},
      }),
    }],
    ['admin shop outside configured stores', { ADMIN_SHOP: 'other.myshopify.com' }],
    ['invalid admin password hash', { ADMIN_PASSWORD_HASH: 'plaintext-password' }],
    ['short admin session secret', { ADMIN_SESSION_SECRET: 'short' }],
  ])('fails closed for %s', async (_label, override) => {
    const source = await validEnvironment();
    expect(() => readServerConfig({
      projectRoot: process.cwd(),
      source: { ...source, ...override },
    })).toThrow('configuration');
  });
});

async function validEnvironment() {
  return {
    PORT: '8080',
    PUBLIC_ORIGIN: 'https://jersey.example',
    TRUST_PROXY: 'true',
    DATA_DIR: '.server-test-data',
    LOCAL_PRODUCTION_FILES: 'false',
    ADMIN_SHOP: 'test.myshopify.com',
    ADMIN_PASSWORD_HASH: await createAdminPasswordHash('test-admin-password', {
      randomBytes: () => Buffer.alloc(16, 8),
    }),
    ADMIN_SESSION_SECRET: 'a'.repeat(32),
    SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({
      'test.myshopify.com': {
        productId: 'fn8788-jersey',
        currency: 'USD',
        jerseyVariants: { s: '123' },
        surchargeVariants: { 8: '456' },
      },
      'second.myshopify.com': {
        productId: 'fn8788-jersey',
        currency: 'USD',
        jerseyVariants: { s: '789' },
        surchargeVariants: { 8: '987' },
      },
    }),
    SHOPIFY_API_SECRET: 's'.repeat(32),
    SHOPIFY_API_KEY: 'public-app-client-id',
    SHOPIFY_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    CART_QUOTE_SIGNING_SECRET: 'q'.repeat(32),
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 't'.repeat(32),
  };
}
