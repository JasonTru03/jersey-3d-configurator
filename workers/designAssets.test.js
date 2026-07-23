import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesignAssetsHandler } from './designAssets.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const transform = { offset: { u: 0, v: 0 }, scale: 1, rotationDeg: 0, repeat: { u: 3, v: 4 } };
const metadata = { atlasSize: 2048, projectionVersion: 1, sourceHash: 'asset://pattern-a', transform, projectionId: 'chelsea-jersey-cylindrical-v1', bakeKey: 'bottom-pattern-atlas:pattern-a' };

afterEach(() => vi.unstubAllGlobals());

function design(overrides = {}) {
  return {
    format: 'jersey-design',
    version: 2,
    productId: 'jersey-1',
    savedAt: '2026-07-23T00:00:00.000Z',
    state: { overrides: { bottomPattern: { enabled: true, source: { assetRef: 'asset://pattern-a' }, transform, projectionVersion: 1, modelProjectionId: 'chelsea-jersey-cylindrical-v1', bakeMetadata: metadata } } },
    ...overrides,
  };
}

function request({ designDocument = design(), uploadMetadata = metadata, turnstileToken = 'valid-turnstile-token', ip = '203.0.113.1', atlas = { type: 'image/png', size: png.length, slice: () => ({ arrayBuffer: async () => png.buffer }), arrayBuffer: async () => png.buffer } } = {}) {
  const form = { get: (key) => ({ atlas, design: { text: async () => JSON.stringify(designDocument) }, metadata: JSON.stringify(uploadMetadata), turnstileToken })[key] };
  return { method: 'POST', url: 'https://example.workers.dev/api/design-assets', headers: { get: (name) => ({ 'content-type': 'multipart/form-data', 'cf-connecting-ip': ip }[name] ?? null) }, formData: async () => form };
}

function env(overrides = {}) {
  return {
    TURNSTILE_SECRET_KEY: 'secret',
    TURNSTILE_SITE_KEY: 'public-site-key',
    DESIGN_UPLOAD_RATE_LIMIT: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
    DESIGN_ASSETS: { put: vi.fn(), get: vi.fn() },
    ASSETS: { fetch: vi.fn(() => new Response('app')) },
    ...overrides,
  };
}

function acceptTurnstile() {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true })));
}

describe('design asset worker', () => {
  it('publishes only the configured public Turnstile site key', async () => {
    const response = await createDesignAssetsHandler(env())(new Request('https://example.workers.dev/api/design-assets/config'));
    expect(await response.json()).toEqual({ turnstileSiteKey: 'public-site-key' });
  });

  it('stores a captcha-verified, rate-limited, internally consistent normalized design', async () => {
    acceptTurnstile();
    const runtime = env();
    const response = await createDesignAssetsHandler(runtime)(request());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ designId: expect.stringMatching(/^dsg_/), url: expect.stringContaining('/api/design-assets/dsg_'), size: png.length, version: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(fetch).toHaveBeenCalledWith('https://challenges.cloudflare.com/turnstile/v0/siteverify', expect.objectContaining({ method: 'POST' }));
    expect(runtime.DESIGN_UPLOAD_RATE_LIMIT.put).toHaveBeenCalledTimes(1);
    expect(runtime.DESIGN_ASSETS.put).toHaveBeenCalledTimes(3);
  });

  it('rejects missing or failed Turnstile verification before storage', async () => {
    const runtime = env();
    expect((await createDesignAssetsHandler(runtime)(request({ turnstileToken: '' }))).status).toBe(403);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false })));
    expect((await createDesignAssetsHandler(runtime)(request())).status).toBe(403);
    expect(runtime.DESIGN_ASSETS.put).not.toHaveBeenCalled();
  });

  it('rejects production writes without rate-limit KV and over the per-minute IP quota', async () => {
    acceptTurnstile();
    expect((await createDesignAssetsHandler(env({ DESIGN_UPLOAD_RATE_LIMIT: undefined }))(request())).status).toBe(503);
    const runtime = env({ DESIGN_UPLOAD_RATE_LIMIT: { get: vi.fn(async () => '10'), put: vi.fn() } });
    expect((await createDesignAssetsHandler(runtime)(request())).status).toBe(429);
    expect(runtime.DESIGN_ASSETS.put).not.toHaveBeenCalled();
  });

  it('rejects a design whose bottom-pattern source, bake key, projection, or transform differs from upload metadata', async () => {
    acceptTurnstile();
    const mismatched = structuredClone(metadata);
    mismatched.bakeKey = 'bottom-pattern-atlas:other';
    const response = await createDesignAssetsHandler(env())(request({ uploadMetadata: mismatched }));
    expect(response.status).toBe(400);
  });

  it('rejects non-PNG uploads and routes non-API requests to static assets', async () => {
    const runtime = env();
    const bad = { type: 'image/jpeg', size: 7, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }), arrayBuffer: async () => new ArrayBuffer(0) };
    expect((await createDesignAssetsHandler(runtime)(request({ atlas: bad }))).status).toBe(400);
    expect(await (await createDesignAssetsHandler(runtime)(new Request('https://example.workers.dev/'))).text()).toBe('app');
  });
});
