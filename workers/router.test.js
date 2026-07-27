import { describe, expect, it, vi } from 'vitest';
import { createWorkerHandler } from './router.js';

function createInjectedRouter(overrides = {}) {
  const handlers = {
    cartQuotes: vi.fn(() => new Response('cart quotes')),
    appProxy: vi.fn(() => new Response('app proxy')),
    designAssets: vi.fn(() => new Response('design assets')),
    ...overrides,
  };
  const factories = {
    createCartQuotesHandler: vi.fn(() => handlers.cartQuotes),
    createAppProxyHandler: vi.fn(() => handlers.appProxy),
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
    ['/api/cart-quotes', 'cartQuotes'],
    ['/apps/jersey-configurator/cart-handoff', 'appProxy'],
    ['/api/design-assets/config', 'designAssets'],
    ['/storefront.js', 'designAssets'],
  ])('routes exact pathname %s to %s', async (pathname, expectedHandler) => {
    const runtime = createInjectedRouter();
    const request = new Request(`https://example.workers.dev${pathname}`);

    await runtime.handler(request);

    expect(runtime.handlers[expectedHandler]).toHaveBeenCalledOnce();
    expect(runtime.handlers[expectedHandler]).toHaveBeenCalledWith(request);
  });

  it('ignores the query string while matching secure routes', async () => {
    const runtime = createInjectedRouter();

    await runtime.handler(new Request('https://example.workers.dev/api/cart-quotes?shop=test'));
    await runtime.handler(new Request('https://example.workers.dev/apps/jersey-configurator/cart-handoff?signature=abc'));

    expect(runtime.handlers.cartQuotes).toHaveBeenCalledOnce();
    expect(runtime.handlers.appProxy).toHaveBeenCalledOnce();
  });

  it('passes every method to the matched secure handler', async () => {
    const runtime = createInjectedRouter();
    const cartRequest = new Request('https://example.workers.dev/api/cart-quotes', { method: 'DELETE' });
    const proxyRequest = new Request('https://example.workers.dev/apps/jersey-configurator/cart-handoff', { method: 'POST' });

    await runtime.handler(cartRequest);
    await runtime.handler(proxyRequest);

    expect(runtime.handlers.cartQuotes).toHaveBeenCalledWith(cartRequest);
    expect(runtime.handlers.appProxy).toHaveBeenCalledWith(proxyRequest);
  });

  it.each([
    '/api/cart-quotes-extra',
    '/api/cart-quotes/',
    '/apps/jersey-configurator/cart-handoff/extra',
    '/apps/jersey-configurator/cart-handoff/',
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

    await runtime.handler(new Request('https://example.workers.dev/api/cart-quotes'));
    await runtime.handler(new Request('https://example.workers.dev/api/cart-quotes'));
    await runtime.handler(new Request('https://example.workers.dev/'));

    for (const factory of Object.values(runtime.factories)) {
      expect(factory).toHaveBeenCalledOnce();
      expect(factory).toHaveBeenCalledWith(runtime.env);
    }
  });

  it('accepts already-created handler dependencies', async () => {
    const cartQuotesHandler = vi.fn(() => new Response('direct cart'));
    const appProxyHandler = vi.fn(() => new Response('direct proxy'));
    const designAssetsHandler = vi.fn(() => new Response('direct fallback'));
    const handler = createWorkerHandler({}, {
      cartQuotesHandler,
      appProxyHandler,
      designAssetsHandler,
    });

    await handler(new Request('https://example.workers.dev/api/cart-quotes'));
    await handler(new Request('https://example.workers.dev/apps/jersey-configurator/cart-handoff'));
    await handler(new Request('https://example.workers.dev/'));

    expect(cartQuotesHandler).toHaveBeenCalledOnce();
    expect(appProxyHandler).toHaveBeenCalledOnce();
    expect(designAssetsHandler).toHaveBeenCalledOnce();
  });

  it('returns handler values unchanged and lets handler errors propagate', () => {
    const response = new Response('identity');
    const promise = Promise.resolve(response);
    const error = new Error('handler failed');
    const responseRouter = createInjectedRouter({ cartQuotes: vi.fn(() => response) });
    const promiseRouter = createInjectedRouter({ appProxy: vi.fn(() => promise) });
    const errorRouter = createInjectedRouter({ designAssets: vi.fn(() => { throw error; }) });

    expect(responseRouter.handler(new Request('https://example.workers.dev/api/cart-quotes'))).toBe(response);
    expect(promiseRouter.handler(new Request('https://example.workers.dev/apps/jersey-configurator/cart-handoff'))).toBe(promise);
    expect(() => errorRouter.handler(new Request('https://example.workers.dev/'))).toThrow(error);
  });

  it('preserves real design-assets config and static asset behavior', async () => {
    const assetsResponse = new Response('static app');
    const env = {
      TURNSTILE_SITE_KEY: 'public-site-key',
      ASSETS: { fetch: vi.fn(() => assetsResponse) },
    };
    const handler = createWorkerHandler(env, {
      cartQuotesHandler: vi.fn(),
      appProxyHandler: vi.fn(),
    });

    const configResponse = await handler(new Request('https://example.workers.dev/api/design-assets/config'));
    const staticRequest = new Request('https://example.workers.dev/assets/app.js');
    const staticResult = await handler(staticRequest);

    await expect(configResponse.json()).resolves.toEqual({ turnstileSiteKey: 'public-site-key' });
    expect(staticResult).toBe(assetsResponse);
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(staticRequest);
  });

  it('preserves real local-production-files and missing-static 404 behavior', async () => {
    const localHandler = createWorkerHandler({ LOCAL_PRODUCTION_FILES: 'true' }, {
      cartQuotesHandler: vi.fn(),
      appProxyHandler: vi.fn(),
    });
    const defaultHandler = createWorkerHandler({}, {
      cartQuotesHandler: vi.fn(),
      appProxyHandler: vi.fn(),
    });

    const localResponse = await localHandler(new Request('https://example.workers.dev/api/design-assets/config'));
    const missingResponse = await defaultHandler(new Request('https://example.workers.dev/favicon.ico'));

    expect(localResponse.status).toBe(503);
    await expect(localResponse.json()).resolves.toEqual({
      error: 'Design asset storage is unavailable in LOCAL_PRODUCTION_FILES mode.',
    });
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.text()).resolves.toBe('Not found');
  });
});
