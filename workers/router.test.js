import { describe, expect, it, vi } from 'vitest';
import { createWorkerHandler } from './router.js';

function createInjectedRouter(overrides = {}) {
  const handlers = {
    cartQuotes: vi.fn(() => new Response('cart quotes')),
    appProxy: vi.fn(() => new Response('app proxy')),
    appProxyLaunch: vi.fn(() => new Response('app proxy launch')),
    orderLifecycleWebhooks: vi.fn(() => new Response('order lifecycle webhooks')),
    privacyWebhooks: vi.fn(() => new Response('privacy webhooks')),
    appLifecycleWebhooks: vi.fn(() => new Response('app lifecycle webhooks')),
    oauth: vi.fn(() => new Response('oauth')),
    merchantApp: vi.fn(() => new Response('merchant app')),
    productionDrafts: vi.fn(() => new Response('production drafts')),
    designAssets: vi.fn(() => new Response('design assets')),
    ...overrides,
  };
  const factories = {
    createCartQuotesHandler: vi.fn(() => handlers.cartQuotes),
    createAppProxyHandler: vi.fn(() => handlers.appProxy),
    createAppProxyLaunchHandler: vi.fn(() => handlers.appProxyLaunch),
    createOrderLifecycleWebhooksHandler: vi.fn(() => handlers.orderLifecycleWebhooks),
    createPrivacyWebhooksHandler: vi.fn(() => handlers.privacyWebhooks),
    createAppLifecycleWebhooksHandler: vi.fn(() => handlers.appLifecycleWebhooks),
    createOAuthHandler: vi.fn(() => handlers.oauth),
    createMerchantAppHandler: vi.fn(() => handlers.merchantApp),
    createProductionDraftsHandler: vi.fn(() => handlers.productionDrafts),
    createDesignAssetsHandler: vi.fn(() => handlers.designAssets),
  };
  const env = { marker: 'runtime' };
  return {
    env,
    handlers,
    factories,
    handler: createWorkerHandler(env, factories),
  };
}

describe('Worker router', () => {
  it.each([
    ['POST', '/api/cart-quotes', 'cartQuotes'],
    ['GET', '/apps/jersey-configurator/cart-handoff', 'appProxy'],
    ['GET', '/apps/jersey-configurator/launch', 'appProxyLaunch'],
    ['POST', '/webhooks/shopify/orders', 'orderLifecycleWebhooks'],
    ['POST', '/webhooks/shopify/privacy', 'privacyWebhooks'],
    ['POST', '/webhooks/shopify/app-lifecycle', 'appLifecycleWebhooks'],
    ['GET', '/auth', 'oauth'],
    ['GET', '/auth/callback', 'oauth'],
    ['GET', '/app', 'merchantApp'],
    ['GET', '/api/production-drafts/config', 'productionDrafts'],
    ['POST', '/api/production-drafts', 'productionDrafts'],
    ['PUT', '/api/production-drafts', 'productionDrafts'],
    ['POST', '/api/production-drafts/config', 'productionDrafts'],
    ['GET', '/storefront.js', 'designAssets'],
  ])('routes %s %s to %s', async (method, pathname, expectedHandler) => {
    const runtime = createInjectedRouter();
    const request = new Request(`https://example.workers.dev${pathname}`, { method });

    await runtime.handler(request);

    expect(runtime.handlers[expectedHandler]).toHaveBeenCalledOnce();
    expect(runtime.handlers[expectedHandler]).toHaveBeenCalledWith(request);
  });

  it('ignores the query string while matching secure routes', async () => {
    const runtime = createInjectedRouter();

    await runtime.handler(new Request('https://example.workers.dev/api/cart-quotes?shop=test', { method: 'POST' }));
    await runtime.handler(new Request('https://example.workers.dev/apps/jersey-configurator/cart-handoff?signature=abc'));

    expect(runtime.handlers.cartQuotes).toHaveBeenCalledOnce();
    expect(runtime.handlers.appProxy).toHaveBeenCalledOnce();
  });

  it.each([
    ['GET', '/api/cart-quotes'],
    ['DELETE', '/api/cart-quotes'],
    ['POST', '/apps/jersey-configurator/cart-handoff'],
    ['PUT', '/apps/jersey-configurator/cart-handoff'],
    ['GET', '/webhooks/shopify/orders'],
    ['PUT', '/webhooks/shopify/orders'],
    ['GET', '/webhooks/shopify/privacy'],
    ['PUT', '/webhooks/shopify/privacy'],
    ['GET', '/webhooks/shopify/app-lifecycle'],
    ['PUT', '/webhooks/shopify/app-lifecycle'],
  ])('falls back for unmatched method %s %s', async (method, pathname) => {
    const runtime = createInjectedRouter();
    const request = new Request(`https://example.workers.dev${pathname}`, { method });

    await runtime.handler(request);

    expect(runtime.handlers.designAssets).toHaveBeenCalledWith(request);
    expect(runtime.handlers.cartQuotes).not.toHaveBeenCalled();
    expect(runtime.handlers.appProxy).not.toHaveBeenCalled();
  });

  it.each([
    '/api/cart-quotes-extra',
    '/api/cart-quotes/',
    '/apps/jersey-configurator/cart-handoff/extra',
    '/apps/jersey-configurator/cart-handoff/',
    '/webhooks/shopify/orders/',
    '/webhooks/shopify/orders/extra',
    '/webhooks/shopify/privacy/',
    '/webhooks/shopify/privacy/extra',
    '/webhooks/shopify/app-lifecycle/',
    '/webhooks/shopify/app-lifecycle/extra',
    '/auth/',
    '/auth/callback/extra',
    '/app/',
    '/api/production-drafts-extra',
    '/api/production-drafts/',
    '/api/production-drafts/config/',
  ])('falls back instead of prefix-matching %s', async (pathname) => {
    const runtime = createInjectedRouter();
    const request = new Request(`https://example.workers.dev${pathname}`);

    await runtime.handler(request);

    expect(runtime.handlers.designAssets).toHaveBeenCalledWith(request);
    expect(runtime.handlers.cartQuotes).not.toHaveBeenCalled();
    expect(runtime.handlers.appProxy).not.toHaveBeenCalled();
  });

  it('initializes each factory once per created router and passes the same env', async () => {
    const runtime = createInjectedRouter();

    await runtime.handler(new Request('https://example.workers.dev/api/cart-quotes', { method: 'POST' }));
    await runtime.handler(new Request('https://example.workers.dev/api/cart-quotes', { method: 'POST' }));
    await runtime.handler(new Request('https://example.workers.dev/'));

    for (const factory of Object.values(runtime.factories)) {
      expect(factory).toHaveBeenCalledOnce();
      expect(factory).toHaveBeenCalledWith(runtime.env);
    }
  });

  it('accepts already-created handler dependencies', async () => {
    const cartQuotesHandler = vi.fn(() => new Response('direct cart'));
    const appProxyHandler = vi.fn(() => new Response('direct proxy'));
    const appProxyLaunchHandler = vi.fn(() => new Response('direct launch'));
    const orderLifecycleWebhooksHandler = vi.fn(() => new Response('direct order webhook'));
    const privacyWebhooksHandler = vi.fn(() => new Response('direct privacy webhook'));
    const appLifecycleWebhooksHandler = vi.fn(() => new Response('direct app lifecycle webhook'));
    const oauthHandler = vi.fn(() => new Response('direct oauth'));
    const merchantAppHandler = vi.fn(() => new Response('direct merchant app'));
    const designAssetsHandler = vi.fn(() => new Response('direct fallback'));
    const productionDraftsHandler = vi.fn(() => new Response('direct production drafts'));
    const handler = createWorkerHandler({}, {
      cartQuotesHandler,
      appProxyHandler,
      appProxyLaunchHandler,
      orderLifecycleWebhooksHandler,
      privacyWebhooksHandler,
      appLifecycleWebhooksHandler,
      oauthHandler,
      merchantAppHandler,
      productionDraftsHandler,
      designAssetsHandler,
    });

    await handler(new Request('https://example.workers.dev/api/cart-quotes', { method: 'POST' }));
    await handler(new Request('https://example.workers.dev/apps/jersey-configurator/cart-handoff'));
    await handler(new Request('https://example.workers.dev/apps/jersey-configurator/launch'));
    await handler(new Request('https://example.workers.dev/webhooks/shopify/orders', { method: 'POST' }));
    await handler(new Request('https://example.workers.dev/webhooks/shopify/privacy', { method: 'POST' }));
    await handler(new Request('https://example.workers.dev/webhooks/shopify/app-lifecycle', { method: 'POST' }));
    await handler(new Request('https://example.workers.dev/auth'));
    await handler(new Request('https://example.workers.dev/app?shop=test.myshopify.com'));
    await handler(new Request('https://example.workers.dev/api/production-drafts', { method: 'POST' }));
    await handler(new Request('https://example.workers.dev/'));

    expect(cartQuotesHandler).toHaveBeenCalledOnce();
    expect(appProxyHandler).toHaveBeenCalledOnce();
    expect(appProxyLaunchHandler).toHaveBeenCalledOnce();
    expect(orderLifecycleWebhooksHandler).toHaveBeenCalledOnce();
    expect(privacyWebhooksHandler).toHaveBeenCalledOnce();
    expect(appLifecycleWebhooksHandler).toHaveBeenCalledOnce();
    expect(oauthHandler).toHaveBeenCalledOnce();
    expect(merchantAppHandler).toHaveBeenCalledOnce();
    expect(productionDraftsHandler).toHaveBeenCalledOnce();
    expect(designAssetsHandler).toHaveBeenCalledOnce();
  });

  it('returns handler values unchanged and lets handler errors propagate', () => {
    const response = new Response('identity');
    const promise = Promise.resolve(response);
    const error = new Error('handler failed');
    const responseRouter = createInjectedRouter({ cartQuotes: vi.fn(() => response) });
    const promiseRouter = createInjectedRouter({ appProxy: vi.fn(() => promise) });
    const errorRouter = createInjectedRouter({ designAssets: vi.fn(() => { throw error; }) });

    expect(responseRouter.handler(new Request('https://example.workers.dev/api/cart-quotes', { method: 'POST' }))).toBe(response);
    expect(promiseRouter.handler(new Request('https://example.workers.dev/apps/jersey-configurator/cart-handoff'))).toBe(promise);
    expect(() => errorRouter.handler(new Request('https://example.workers.dev/'))).toThrow(error);
  });

  it('preserves real production-draft config and static asset behavior', async () => {
    const assetsResponse = new Response('static app');
    const env = {
      LOCAL_PRODUCTION_FILES: 'false',
      TURNSTILE_SITE_KEY: 'public-site-key',
      ASSETS: { fetch: vi.fn(() => assetsResponse) },
    };
    const handler = createWorkerHandler(env, {
      cartQuotesHandler: vi.fn(),
      appProxyHandler: vi.fn(),
      orderLifecycleWebhooksHandler: vi.fn(),
    });

    const configResponse = await handler(new Request('https://example.workers.dev/api/production-drafts/config'));
    const staticRequest = new Request('https://example.workers.dev/assets/app.js');
    const staticResult = await handler(staticRequest);

    await expect(configResponse.json()).resolves.toEqual({ turnstileSiteKey: 'public-site-key' });
    expect(staticResult).toBe(assetsResponse);
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(staticRequest);
  });

  it('forwards only the Shopify cart handoff when an upstream origin is configured', async () => {
    const upstreamFetch = vi.fn(async (request) => new Response(request.url));
    vi.stubGlobal('fetch', upstreamFetch);
    const handler = createWorkerHandler({
      APP_PROXY_UPSTREAM_ORIGIN: 'https://139.199.202.173',
    }, {
      cartQuotesHandler: vi.fn(),
      designAssetsHandler: vi.fn(),
      orderLifecycleWebhooksHandler: vi.fn(),
      productionDraftsHandler: vi.fn(),
    });
    const request = new Request(
      'https://example.workers.dev/apps/jersey-configurator/cart-handoff?signature=abc&token=def',
    );

    const response = await handler(request);

    expect(await response.text()).toBe(
      'https://139.199.202.173/apps/jersey-configurator/cart-handoff?signature=abc&token=def',
    );
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it('preserves real local-production-files and missing-static 404 behavior', async () => {
    const localHandler = createWorkerHandler({ LOCAL_PRODUCTION_FILES: 'true' }, {
      cartQuotesHandler: vi.fn(),
      appProxyHandler: vi.fn(),
      orderLifecycleWebhooksHandler: vi.fn(),
    });
    const defaultHandler = createWorkerHandler({}, {
      cartQuotesHandler: vi.fn(),
      appProxyHandler: vi.fn(),
    });

    const localResponse = await localHandler(new Request('https://example.workers.dev/api/production-drafts/config'));
    const missingResponse = await defaultHandler(new Request('https://example.workers.dev/favicon.ico'));

    expect(localResponse.status).toBe(503);
    await expect(localResponse.json()).resolves.toEqual({
      error: 'Production draft uploads are temporarily unavailable.',
    });
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.text()).resolves.toBe('Not found');
  });
});
