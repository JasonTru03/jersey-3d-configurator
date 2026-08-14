import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppProxyForwardingHandler } from './appProxyForwarder.js';

describe('Shopify App Proxy forwarder', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('streams the signed handoff request to Tencent without changing its path or query', async () => {
    const upstreamFetch = vi.fn(async (request, init) => new Response('handoff', {
      status: 201,
      headers: { 'x-upstream': 'tencent' },
    }));
    vi.stubGlobal('fetch', upstreamFetch);
    const handler = createAppProxyForwardingHandler({
      APP_PROXY_UPSTREAM_ORIGIN: 'https://139.199.202.173',
      SHOPIFY_API_SECRET: 'test-shopify-secret-at-least-32-bytes',
    });
    const request = new Request(
      'https://jersey-3d-configurator.example/apps/jersey-configurator/cart-handoff?shop=test.myshopify.com&signature=abc&token=def',
      { headers: { 'x-shopify-shop-domain': 'test.myshopify.com' } },
    );

    const response = await handler(request);

    expect(response.status).toBe(201);
    expect(response.headers.get('x-upstream')).toBe('tencent');
    expect(await response.text()).toBe('handoff');
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(upstreamFetch.mock.calls[0][0].url).toBe(
      'https://139.199.202.173/apps/jersey-configurator/cart-handoff?shop=test.myshopify.com&signature=abc&token=def',
    );
    expect(upstreamFetch.mock.calls[0][0].headers.get('x-shopify-shop-domain'))
      .toBe('test.myshopify.com');
    expect(upstreamFetch.mock.calls[0][1]).toEqual({ redirect: 'manual' });
  });

  it.each([
    undefined,
    'http://139.199.202.173',
    'https://139.199.202.173/path',
    'https://user:pass@139.199.202.173',
  ])('fails closed for an invalid upstream origin: %s', async (origin) => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);
    const handler = createAppProxyForwardingHandler({ APP_PROXY_UPSTREAM_ORIGIN: origin });

    const response = await handler(new Request(
      'https://example.workers.dev/apps/jersey-configurator/cart-handoff?token=redacted',
    ));

    expect(response.status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('does not become an open proxy for other paths or methods', async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);
    const handler = createAppProxyForwardingHandler({
      APP_PROXY_UPSTREAM_ORIGIN: 'https://139.199.202.173',
    });

    const wrongPath = await handler(new Request('https://example.workers.dev/api/cart-quotes'));
    const wrongMethod = await handler(new Request(
      'https://example.workers.dev/apps/jersey-configurator/cart-handoff',
      { method: 'POST' },
    ));

    expect(wrongPath.status).toBe(404);
    expect(wrongMethod.status).toBe(404);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('returns a generic gateway error when Tencent is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private detail')));
    const handler = createAppProxyForwardingHandler({
      APP_PROXY_UPSTREAM_ORIGIN: 'https://139.199.202.173',
    });

    const response = await handler(new Request(
      'https://example.workers.dev/apps/jersey-configurator/cart-handoff',
    ));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('Bad gateway');
  });
});
