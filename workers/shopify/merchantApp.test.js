import { describe, expect, it, vi } from 'vitest';
import { createAppSession, createCsrfToken } from './appSession.js';
import { createMerchantAppHandler } from './merchantApp.js';

const SHOP = 'merchant-app.myshopify.com';
const SECRET = 'merchant-app-secret-that-is-at-least-32';
const NOW = 1_700_000_000_000;
const ACCESS_TOKEN = 'shpat_private_offline_token_123456';

describe('Shopify merchant app', () => {
  it('renders an authenticated, nonce-protected product configuration page', async () => {
    const runtime = await createRuntime();
    const response = await runtime.handler(await request('GET', runtime.session));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('3D 球衣定制管理');
    expect(html).toContain('球衣商品配置');
    expect(html).toContain('v1.0.0');
    expect(html).toContain('查看定制订单');
    expect(html).toContain('href="/admin/"');
    expect(html).toContain('Test Jersey');
    expect(html).toContain('secure-jersey-launcher');
    expect(html).not.toContain('商品配置将在下一阶段开放');
    expect(html).not.toContain(ACCESS_TOKEN);
    expect(response.headers.get('Content-Security-Policy')).toMatch(/script-src 'nonce-[A-Za-z0-9_-]+'/u);
    expect(response.headers.get('Content-Security-Policy')).not.toContain("script-src 'unsafe-inline'");
    expect(runtime.createGraphql).toHaveBeenCalledWith({ shop: SHOP, accessToken: ACCESS_TOKEN });
  });

  it('rejects an invalid CSRF token before validating or saving configuration', async () => {
    const runtime = await createRuntime();
    const response = await runtime.handler(await request('POST', runtime.session, {
      csrf: '0'.repeat(64),
      body: input(),
    }));

    expect(response.status).toBe(403);
    expect(runtime.verifyVariants).not.toHaveBeenCalled();
    expect(runtime.configRepository.saveDraft).not.toHaveBeenCalled();
  });

  it('validates ownership, saves a draft, activates Functions and only then marks it active', async () => {
    const runtime = await createRuntime();
    const response = await runtime.handler(await request('POST', runtime.session, {
      csrf: await createCsrfToken(runtime.session, SECRET),
      body: input(),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'active', revision: 3 });
    expect(runtime.verifyVariants).toHaveBeenCalledWith({
      graphql: runtime.graphql,
      productGid: 'gid://shopify/Product/9',
      jerseyVariantGids: [101, 102, 103, 104].map(variantGid),
      surchargeVariantGids: [201].map(variantGid),
    });
    expect(runtime.configRepository.saveDraft).toHaveBeenCalledBefore(runtime.activate);
    expect(runtime.activate).toHaveBeenCalledBefore(runtime.configRepository.markActive);
    expect(runtime.configRepository.markActive).toHaveBeenCalledWith({
      shop: SHOP,
      revision: 3,
      activationLockToken: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u),
      transformRegistrationId: 'gid://shopify/CartTransform/11',
      validationRegistrationId: 'gid://shopify/Validation/12',
      updatedAt: NOW,
    });
  });

  it('keeps a failed activation inactive and returns no secret details', async () => {
    const runtime = await createRuntime({
      activate: vi.fn().mockRejectedValue(new Error('upstream included a private token')),
    });
    const response = await runtime.handler(await request('POST', runtime.session, {
      csrf: await createCsrfToken(runtime.session, SECRET),
      body: input(),
    }));
    const text = await response.text();

    expect(response.status).toBe(502);
    expect(text).not.toContain('private token');
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(runtime.configRepository.markActive).not.toHaveBeenCalled();
    expect(runtime.configRepository.markActivationFailed).toHaveBeenCalledWith({
      shop: SHOP,
      revision: 3,
      activationLockToken: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/u),
      errorCode: 'FUNCTION_ACTIVATION_FAILED',
      updatedAt: NOW,
    });
  });

  it('rejects cross-product size selections before persisting a draft', async () => {
    const runtime = await createRuntime({
      verifyVariants: vi.fn().mockRejectedValue(new Error('not owned')),
    });
    const response = await runtime.handler(await request('POST', runtime.session, {
      csrf: await createCsrfToken(runtime.session, SECRET),
      body: input(),
    }));

    expect(response.status).toBe(400);
    expect(runtime.configRepository.saveDraft).not.toHaveBeenCalled();
  });

  it('rejects non-USD stores because the checkout Functions are USD-only', async () => {
    const runtime = await createRuntime({
      verifyVariants: vi.fn().mockResolvedValue({ currency: 'EUR', title: 'Test Jersey' }),
    });
    const response = await runtime.handler(await request('POST', runtime.session, {
      csrf: await createCsrfToken(runtime.session, SECRET),
      body: input(),
    }));

    expect(response.status).toBe(400);
    expect(runtime.configRepository.saveDraft).not.toHaveBeenCalled();
  });
});

async function createRuntime(overrides = {}) {
  const session = await createAppSession(SHOP, NOW + 60 * 60 * 1000, SECRET);
  const graphql = vi.fn();
  const tokenVault = { decrypt: vi.fn().mockResolvedValue(ACCESS_TOKEN) };
  const configSecretVault = {
    encrypt: vi.fn().mockResolvedValue({ ciphertext: 'A'.repeat(32), iv: 'B'.repeat(16), keyVersion: 1 }),
  };
  const configRepository = {
    get: vi.fn().mockResolvedValue(null),
    saveDraft: vi.fn().mockResolvedValue(3),
    markActive: vi.fn().mockResolvedValue(undefined),
    markActivationFailed: vi.fn().mockResolvedValue(undefined),
  };
  const activate = overrides.activate ?? vi.fn().mockResolvedValue({
    transformRegistrationId: 'gid://shopify/CartTransform/11',
    validationRegistrationId: 'gid://shopify/Validation/12',
  });
  const verifyVariants = overrides.verifyVariants
    ?? vi.fn().mockResolvedValue({ currency: 'USD', title: 'Test Jersey' });
  const createGraphql = vi.fn(() => graphql);
  const handler = createMerchantAppHandler({
    SHOPIFY_API_SECRET: SECRET,
    SHOPIFY_API_KEY: 'public-app-client-id',
    SHOPIFY_STORE_CONFIG_JSON: '{}',
    SHOPIFY_TOKEN_ENCRYPTION_KEY: 'test-key',
    PRODUCTION_DB: {},
  }, {
    activateStore: activate,
    createAdminGraphqlClient: createGraphql,
    createOAuthRepository: () => ({
      getInstallation: vi.fn().mockResolvedValue({ status: 'active' }),
    }),
    createStoreConfigRepository: () => configRepository,
    createTokenVault: (_key, options) => (options?.purpose ? configSecretVault : tokenVault),
    listProducts: vi.fn().mockResolvedValue([{
      id: 'gid://shopify/Product/9',
      title: 'Test Jersey',
      variants: {
        nodes: [101, 102, 103, 104].map((id) => ({
          id: variantGid(id), title: `Size ${id}`, price: '89.00',
        })),
      },
    }]),
    verifySelectedVariants: verifyVariants,
    now: () => NOW,
    randomBytes: (length) => new Uint8Array(length).fill(7),
    logger: { error: vi.fn() },
  });
  return {
    activate,
    configRepository,
    createGraphql,
    graphql,
    handler,
    session,
    verifyVariants,
  };
}

async function request(method, session, options = {}) {
  const headers = { Cookie: `__Host-shopify_app_session=${session}` };
  const init = { method, headers };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = options.csrf;
    init.body = JSON.stringify(options.body);
  }
  return new Request(`https://app.example/app?shop=${SHOP}`, init);
}

function input() {
  return {
    shopifyProductGid: 'gid://shopify/Product/9',
    jerseyVariants: { s: '101', m: '102', l: '103', xl: '104' },
    surchargeVariants: { 8: '201' },
  };
}

function variantGid(id) {
  return `gid://shopify/ProductVariant/${id}`;
}
