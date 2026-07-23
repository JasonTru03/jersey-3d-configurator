import { describe, expect, it, vi } from 'vitest';
import { createDesignAssetsHandler } from './designAssets.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);

function pngBuffer() { return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]).buffer; }
function request(input = {}) {
  const { atlas = { type: 'image/png', size: png.length, slice: () => ({ arrayBuffer: async () => pngBuffer() }), arrayBuffer: async () => pngBuffer() }, metadata = '{"atlasSize":2048,"projectionVersion":1}' } = input?.arrayBuffer ? { atlas: input } : input;
  const form = { get: (key) => ({ atlas, design: { text: async () => '{"version":2}', arrayBuffer: async () => new ArrayBuffer(0), slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }), size: 13 }, metadata })[key] };
  const authorization = Object.hasOwn(input, 'authorization') ? input.authorization : 'Bearer short-lived-token';
  return { method: 'POST', url: 'https://example.workers.dev/api/design-assets', headers: { get: (name) => name === 'authorization' ? authorization : 'multipart/form-data' }, formData: async () => form };
}

describe('design asset worker', () => {
  it('stores PNG atlas, design, and metadata and returns immutable cart references', async () => {
    const env = { DESIGN_ASSET_WRITE_TOKEN: 'short-lived-token', DESIGN_ASSETS: { put: vi.fn(), get: vi.fn() }, ASSETS: { fetch: vi.fn() } };
    const response = await createDesignAssetsHandler(env)(request());
    const body = await response.json();
    expect(response.status).toBe(201); expect(body).toMatchObject({ designId: expect.stringMatching(/^dsg_/), url: expect.stringContaining('/api/design-assets/dsg_'), size: png.length, version: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(env.DESIGN_ASSETS.put).toHaveBeenCalledTimes(3);
  });

  it('rejects non-PNG and routes non-API requests to static assets', async () => {
    const env = { DESIGN_ASSET_WRITE_TOKEN: 'short-lived-token', DESIGN_ASSETS: { put: vi.fn() }, ASSETS: { fetch: vi.fn(() => new Response('app')) } };
    const bad = { type: 'image/jpeg', size: 7, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }), arrayBuffer: async () => new ArrayBuffer(0) };
    expect((await createDesignAssetsHandler(env)(request(bad))).status).toBe(400);
    expect(await (await createDesignAssetsHandler(env)(new Request('https://example.workers.dev/'))).text()).toBe('app');
  });

  it('requires the fixed 2048 atlas and projection version 1 metadata', async () => {
    const env = { DESIGN_ASSET_WRITE_TOKEN: 'short-lived-token', DESIGN_ASSETS: { put: vi.fn() }, ASSETS: { fetch: vi.fn() } };
    expect((await createDesignAssetsHandler(env)(request({ metadata: '{"atlasSize":1024,"projectionVersion":1}' }))).status).toBe(400);
    expect((await createDesignAssetsHandler(env)(request({ metadata: '{"atlasSize":2048,"projectionVersion":2}' }))).status).toBe(400);
  });

  it('requires the configured bearer token before accepting writes', async () => {
    const env = { DESIGN_ASSET_WRITE_TOKEN: 'short-lived-token', DESIGN_ASSETS: { put: vi.fn() }, ASSETS: { fetch: vi.fn() } };
    expect((await createDesignAssetsHandler(env)(request({ authorization: null }))).status).toBe(401);
    expect((await createDesignAssetsHandler(env)(request({ authorization: 'Bearer wrong-token' }))).status).toBe(401);
    expect(env.DESIGN_ASSETS.put).not.toHaveBeenCalled();
  });

  it('rejects writes when the worker token secret is absent', async () => {
    const env = { DESIGN_ASSETS: { put: vi.fn() }, ASSETS: { fetch: vi.fn() } };
    expect((await createDesignAssetsHandler(env)(request())).status).toBe(401);
    expect(env.DESIGN_ASSETS.put).not.toHaveBeenCalled();
  });
});
