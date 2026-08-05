// @vitest-environment node

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readServerConfig } from './config.js';

describe('server configuration', () => {
  it('normalizes an explicit production configuration without exposing secret values', () => {
    const config = readServerConfig({
      projectRoot: process.cwd(),
      source: validEnvironment(),
    });

    expect(config).toMatchObject({
      port: 8080,
      publicOrigin: 'https://jersey.example',
      trustProxy: true,
      localProductionFiles: 'false',
    });
    expect(config.dataDirectory).toBe(path.resolve(process.cwd(), '.server-test-data'));
  });

  it.each([
    ['HTTP public origin', { PUBLIC_ORIGIN: 'http://jersey.example' }],
    ['enabled local files', { LOCAL_PRODUCTION_FILES: 'true' }],
    ['short signing secret', { CART_QUOTE_SIGNING_SECRET: 'short' }],
    ['placeholder secret', { SHOPIFY_API_SECRET: 'CHANGE_ME_WITH_AT_LEAST_32_CHARACTERS' }],
    ['invalid store JSON', { SHOPIFY_STORE_CONFIG_JSON: '{bad' }],
  ])('fails closed for %s', (_label, override) => {
    expect(() => readServerConfig({
      projectRoot: process.cwd(),
      source: { ...validEnvironment(), ...override },
    })).toThrow('configuration');
  });
});

function validEnvironment() {
  return {
    PORT: '8080',
    PUBLIC_ORIGIN: 'https://jersey.example',
    TRUST_PROXY: 'true',
    DATA_DIR: '.server-test-data',
    LOCAL_PRODUCTION_FILES: 'false',
    SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({
      'test.myshopify.com': {
        productId: 'fn8788-jersey',
        currency: 'USD',
        jerseyVariants: { s: '123' },
        surchargeVariants: { 8: '456' },
      },
    }),
    SHOPIFY_API_SECRET: 's'.repeat(32),
    CART_QUOTE_SIGNING_SECRET: 'q'.repeat(32),
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 't'.repeat(32),
  };
}
