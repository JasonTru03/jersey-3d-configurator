import { afterEach, describe, expect, it, vi } from 'vitest';
import gateway from './tencentTunnelGateway.js';

describe('Tencent HTTPS gateway', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('streams the request to Tencent without changing method, path, query, or body', async () => {
    const writes = [];
    const connect = vi.fn(() => ({
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      close: vi.fn(async () => {}),
      writable: new WritableStream({ write: (chunk) => writes.push(chunk) }),
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'HTTP/1.0 201 Created\r\nContent-Type: text/plain\r\nX-Upstream: ok\r\nContent-Length: 7\r\n\r\npayload',
          ));
          controller.close();
        },
      }),
    }));

    const response = await gateway.fetch(new Request(
      'https://jersey-tencent-gateway.example/api/production-drafts?mode=test',
      { method: 'POST', body: 'payload', headers: { 'content-type': 'text/plain' } },
    ), {
      TENCENT_ORIGIN: 'http://139.199.202.173:8080',
      TENCENT_GATEWAY_SECRET: 'a'.repeat(32),
      __CONNECT: connect,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('x-upstream')).toBe('ok');
    expect(await response.text()).toBe('payload');

    expect(connect).toHaveBeenCalledWith(
      { hostname: '139.199.202.173', port: 8080 },
      { secureTransport: 'off', allowHalfOpen: true },
    );
    const forwarded = new TextDecoder().decode(concatTestWrites(writes));
    expect(forwarded).toContain('POST /api/production-drafts?mode=test HTTP/1.0\r\n');
    expect(forwarded).toContain('host: 139.199.202.173\r\n');
    expect(forwarded).toContain('x-forwarded-host: jersey-tencent-gateway.example\r\n');
    expect(forwarded).toContain(`x-jersey-gateway-secret: ${'a'.repeat(32)}\r\n`);
    expect(forwarded.endsWith('\r\n\r\npayload')).toBe(true);
  });

  it('writes large request bodies in bounded chunks before reading the response', async () => {
    const writes = [];
    const close = vi.fn();
    const connect = vi.fn(() => ({
      opened: Promise.resolve({}),
      closed: Promise.resolve(),
      close: vi.fn(async () => {}),
      writable: new WritableStream({
        write: (chunk) => writes.push(chunk),
        close,
      }),
      readable: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'HTTP/1.0 204 No Content\r\nContent-Length: 0\r\n\r\n',
          ));
          controller.close();
        },
      }),
    }));
    const body = new Uint8Array(160 * 1024 + 7);
    for (let index = 0; index < body.byteLength; index += 1) body[index] = index % 251;

    const response = await gateway.fetch(new Request(
      'https://jersey-tencent-gateway.example/api/production-drafts/dsg_test/bundle',
      { method: 'PUT', body, headers: { 'content-type': 'application/zip' } },
    ), {
      TENCENT_ORIGIN: 'http://139.199.202.173:8080',
      TENCENT_GATEWAY_SECRET: 'a'.repeat(32),
      __CONNECT: connect,
    });

    expect(response.status).toBe(204);
    expect(close).not.toHaveBeenCalled();
    expect(writes.slice(1).map((chunk) => chunk.byteLength)).toEqual([
      64 * 1024,
      64 * 1024,
      32 * 1024 + 7,
    ]);
    const forwarded = concatTestWrites(writes);
    const headerEnd = new TextDecoder().decode(forwarded).indexOf('\r\n\r\n');
    const forwardedBody = forwarded.subarray(headerEnd + 4);
    expect(forwardedBody).toEqual(body);
  });

  it.each([
    undefined,
    'http://139.199.202.173',
    'https://user:pass@139.199.202.173',
    'https://139.199.202.173/path',
  ])('fails closed for an invalid upstream origin: %s', async (origin) => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await gateway.fetch(
      new Request('https://jersey-tencent-gateway.example/healthz'),
      { TENCENT_ORIGIN: origin, TENCENT_GATEWAY_SECRET: 'a'.repeat(32) },
    );

    expect(response.status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it('returns a generic 502 when the tunnel is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private detail')));

    const response = await gateway.fetch(
      new Request('https://jersey-tencent-gateway.example/healthz'),
      {
        TENCENT_ORIGIN: 'https://139.199.202.173',
        TENCENT_GATEWAY_SECRET: 'a'.repeat(32),
      },
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe('Bad gateway');
  });

  it('rewrites same-origin redirects back to the public workers.dev origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: 'https://139.199.202.173/app?shop=test.myshopify.com' },
    })));

    const response = await gateway.fetch(
      new Request('https://jersey-3d-configurator.example/auth/callback'),
      {
        TENCENT_ORIGIN: 'https://139.199.202.173',
        TENCENT_GATEWAY_SECRET: 'a'.repeat(32),
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://jersey-3d-configurator.example/app?shop=test.myshopify.com',
    );
  });

  it('does not rewrite redirects to Shopify', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: 'https://test.myshopify.com/admin' },
    })));

    const response = await gateway.fetch(
      new Request('https://jersey-3d-configurator.example/auth'),
      {
        TENCENT_ORIGIN: 'https://139.199.202.173',
        TENCENT_GATEWAY_SECRET: 'a'.repeat(32),
      },
    );

    expect(response.headers.get('Location')).toBe('https://test.myshopify.com/admin');
  });

  it('fails closed when the gateway secret is missing', async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);

    const response = await gateway.fetch(
      new Request('https://jersey-tencent-gateway.example/healthz'),
      { TENCENT_ORIGIN: 'http://139.199.202.173:8080' },
    );

    expect(response.status).toBe(503);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});

function concatTestWrites(writes) {
  const length = writes.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of writes) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
