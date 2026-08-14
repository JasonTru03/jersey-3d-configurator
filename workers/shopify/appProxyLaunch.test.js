import { describe, expect, it, vi } from 'vitest';
import { createAppProxyLaunchHandler } from './appProxyLaunch.js';

const SHOP = 'launch-test.myshopify.com';
const SECRET = 'launch-test-secret-that-is-at-least-32';
const NOW = 1_700_000_000_000;

describe('Shopify app proxy configurator launch', () => {
  it('redirects a signed active-store request using only authoritative variant maps', async () => {
    const runtime = createRuntime();
    const response = await runtime.handler(new Request(await signedUrl()));
    const location = new URL(response.headers.get('Location'));

    expect(response.status).toBe(302);
    expect(location.origin).toBe('https://worker.example');
    expect(location.searchParams.get('shop')).toBe(SHOP);
    expect(JSON.parse(location.searchParams.get('variantMap'))).toEqual(config().jerseyVariants);
    expect(JSON.parse(location.searchParams.get('surchargeVariantMap'))).toEqual(config().surchargeVariants);
    expect(location.searchParams.has('signature')).toBe(false);
    expect(runtime.repository.get).toHaveBeenCalledWith(SHOP);
  });

  it('rejects forged, expired and unconfigured-variant requests', async () => {
    const runtime = createRuntime();
    const forged = new URL(await signedUrl());
    forged.searchParams.set('signature', '0'.repeat(64));
    expect((await runtime.handler(new Request(forged))).status).toBe(401);

    expect((await runtime.handler(new Request(await signedUrl({
      timestamp: String(Math.floor(NOW / 1000) - 301),
    })))).status).toBe(401);
    expect((await runtime.handler(new Request(await signedUrl({ variantId: '999' })))).status).toBe(400);
  });

  it('fails closed for inactive stores and isolates repository failures', async () => {
    const inactive = createRuntime({ stored: { status: 'draft', config: config() } });
    expect((await inactive.handler(new Request(await signedUrl()))).status).toBe(409);

    const logger = { error: vi.fn() };
    const failed = createRuntime({ logger, get: vi.fn().mockRejectedValue(new Error('private db detail')) });
    const response = await failed.handler(new Request(await signedUrl()));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private db detail');
    expect(logger.error).toHaveBeenCalledWith('SHOPIFY_APP_PROXY_LAUNCH_FAILED');
  });
});

function createRuntime(overrides = {}) {
  const repository = {
    get: overrides.get ?? vi.fn().mockResolvedValue(
      overrides.stored ?? { status: 'active', config: config() },
    ),
  };
  return {
    repository,
    handler: createAppProxyLaunchHandler({
      SHOPIFY_API_SECRET: SECRET,
      SHOPIFY_STORE_CONFIG_JSON: '{}',
      PRODUCTION_DB: {},
    }, {
      createStoreConfigRepository: () => repository,
      now: () => NOW,
      logger: overrides.logger ?? { error: vi.fn() },
    }),
  };
}

function config() {
  return {
    productId: 'fn8788-jersey',
    currency: 'USD',
    jerseyVariants: { s: '101', m: '102', l: '103', xl: '104' },
    surchargeVariants: { 8: '201', 12: '202' },
  };
}

async function signedUrl(overrides = {}) {
  const url = new URL('https://worker.example/apps/jersey-configurator/launch');
  const values = {
    logged_in_customer_id: '',
    path_prefix: '/apps/jersey-configurator',
    productHandle: 'chelsea-match-jersey',
    returnPath: '/cart',
    shop: SHOP,
    timestamp: String(Math.floor(NOW / 1000)),
    variantId: '102',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  const canonical = [...url.searchParams]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(canonical),
  ));
  url.searchParams.set('signature', [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  return url.toString();
}
