import { describe, expect, it, vi } from 'vitest';
import { createDesignAssetsHandler } from './designAssets.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);

function pngBuffer() { return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]).buffer; }
function request(atlas = { type: 'image/png', size: png.length, slice: () => ({ arrayBuffer: async () => pngBuffer() }), arrayBuffer: async () => pngBuffer() }) {
  const form = { get: (key) => ({ atlas, design: { text: async () => '{"version":2}', arrayBuffer: async () => new ArrayBuffer(0), slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }), size: 13 }, metadata: '{"projectionVersion":2}' })[key] };
  return { method: 'POST', url: 'https://example.workers.dev/api/design-assets', headers: { get: () => 'multipart/form-data' }, formData: async () => form };
}

describe('design asset worker', () => {
  it('stores PNG atlas, design, and metadata and returns immutable cart references', async () => {
    const env = { DESIGN_ASSETS: { put: vi.fn(), get: vi.fn() }, ASSETS: { fetch: vi.fn() } };
    const response = await createDesignAssetsHandler(env)(request());
    const body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ designId: expect.stringMatching(/^dsg_/), url: expect.stringContaining('/api/design-assets/dsg_'), size: png.length, version: 2, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(env.DESIGN_ASSETS.put).toHaveBeenCalledTimes(3);
  });

  it('rejects non-PNG and routes non-API requests to static assets', async () => {
    const env = { DESIGN_ASSETS: { put: vi.fn() }, ASSETS: { fetch: vi.fn(() => new Response('app')) } };
    const bad = { type: 'image/jpeg', size: 7, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }), arrayBuffer: async () => new ArrayBuffer(0) };
    expect((await createDesignAssetsHandler(env)(request(bad))).status).toBe(400);
    expect(await (await createDesignAssetsHandler(env)(new Request('https://example.workers.dev/'))).text()).toBe('app');
  });
});
