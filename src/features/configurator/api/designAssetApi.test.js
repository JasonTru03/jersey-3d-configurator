import { describe, expect, it, vi } from 'vitest';
import { uploadDesignAsset } from './designAssetApi.js';

describe('designAssetApi', () => {
  it('posts atlas, design, and metadata as multipart form data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ designId: 'dsg_1', url: '/atlas', sha256: 'a', size: 9, version: 2 }))));
    const result = await uploadDesignAsset({ atlas: new Blob([new Uint8Array([1])], { type: 'image/png' }), design: { version: 2 }, metadata: { projectionVersion: 2 }, token: 'short-lived-token' });
    expect(result.designId).toBe('dsg_1'); const [, options] = fetch.mock.calls[0]; expect(options.body).toBeInstanceOf(FormData); expect(options.body.get('metadata')).toBe('{"projectionVersion":2}');
    expect(options.headers).toEqual({ Authorization: 'Bearer short-lived-token' });
    vi.unstubAllGlobals();
  });

  it('requires the launch-scoped token before starting an upload', async () => {
    await expect(uploadDesignAsset({ atlas: new Blob([new Uint8Array([1])], { type: 'image/png' }), design: {}, metadata: {} }))
      .rejects.toThrow('A design upload token is required.');
  });
});
