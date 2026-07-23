import { describe, expect, it, vi } from 'vitest';
import { uploadDesignAsset } from './designAssetApi.js';

describe('designAssetApi', () => {
  it('posts atlas, normalized design, metadata, and a Turnstile token without a bearer credential', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ designId: 'dsg_1', url: '/atlas', sha256: 'a', size: 9, version: 1 }))));
    const result = await uploadDesignAsset({ atlas: new Blob([new Uint8Array([1])], { type: 'image/png' }), design: { format: 'jersey-design', version: 2 }, metadata: { projectionVersion: 1 }, turnstileToken: 'captcha-token' });
    expect(result.designId).toBe('dsg_1'); const [, options] = fetch.mock.calls[0]; expect(options.body).toBeInstanceOf(FormData); expect(options.body.get('metadata')).toBe('{"projectionVersion":1}'); expect(options.body.get('turnstileToken')).toBe('captcha-token');
    expect(options.headers).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('requires a Turnstile token before starting an upload', async () => {
    await expect(uploadDesignAsset({ atlas: new Blob([new Uint8Array([1])], { type: 'image/png' }), design: {}, metadata: {} }))
      .rejects.toThrow('Turnstile verification is required.');
  });
});
