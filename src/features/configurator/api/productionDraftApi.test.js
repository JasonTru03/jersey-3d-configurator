import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadProductionDraft } from './productionDraftApi.js';

const NOW = 1_788_470_400_000;
const SHOP = 'testcsj.myshopify.com';
const UPLOAD_ID = 'upl_1234567890abcdef';
const SUCCESS = {
  designId: 'dsg_1234567890abcdef',
  designFingerprint: '6ac2cd02',
  bundleFilename: 'fn8788-jersey-design-6ac2cd02.zip',
  expiresAt: 1_788_470_400_000,
};
const FILES = [
  ['design.json', 'application/json'],
  ['uv-atlas.png', 'image/png'],
  ['uv-pattern-pieces.png', 'image/png'],
  ['uv-reference.pdf', 'application/pdf'],
  ['preview-front.png', 'image/png'],
  ['preview-back.png', 'image/png'],
  ['manifest.json', 'application/json'],
];
const MEBIBYTE = 1024 * 1024;
const FILE_SIZE_LIMITS = Object.freeze({
  'design.json': 8 * MEBIBYTE,
  'uv-atlas.png': 16 * MEBIBYTE,
  'uv-pattern-pieces.png': 16 * MEBIBYTE,
  'uv-reference.pdf': 8 * MEBIBYTE,
  'preview-front.png': 8 * MEBIBYTE,
  'preview-back.png': 8 * MEBIBYTE,
  'manifest.json': MEBIBYTE,
});

function artifact(sizes = {}) {
  return {
    files: FILES.map(([filename, type]) => {
      const blob = new Blob([filename], { type });
      if (sizes[filename] !== undefined) {
        Object.defineProperty(blob, 'size', { value: sizes[filename] });
      }
      return { blob, filename };
    }),
  };
}

function json(body = SUCCESS, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('uploadProductionDraft', () => {
  it('posts only the ordered production files and stable upload fields as multipart', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);
    const fetchImpl = vi.fn().mockResolvedValue(json());

    const result = await uploadProductionDraft({
      artifact: artifact(),
      fetchImpl,
      shop: SHOP,
      turnstileToken: 'verified-token',
      uploadId: UPLOAD_ID,
    });

    expect(fetchImpl).toHaveBeenCalledWith('/api/production-drafts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      body: expect.any(FormData),
      signal: expect.any(AbortSignal),
    });
    const form = fetchImpl.mock.calls[0][1].body;
    expect([...form.keys()]).toEqual([
      'shop',
      'uploadId',
      'turnstileToken',
      ...FILES.map(([filename]) => filename),
    ]);
    expect(form.get('shop')).toBe(SHOP);
    expect(form.get('uploadId')).toBe(UPLOAD_ID);
    expect(form.get('turnstileToken')).toBe('verified-token');
    for (const [filename, type] of FILES) {
      const file = form.get(filename);
      expect(file).toBeInstanceOf(Blob);
      expect(file.name).toBe(filename);
      expect(file.type).toBe(type);
    }
    expect([...form.keys()]).not.toContain('metadata');
    expect(result).toEqual(SUCCESS);
    expect(result).not.toBe(SUCCESS);
  });

  it.each([
    'https://attacker.example/api/production-drafts',
    '//attacker.example/api/production-drafts',
    'http://testcsj.myshopify.com/api/production-drafts',
  ])('rejects cross-origin endpoint %s before fetch', async (endpoint) => {
    const fetchImpl = vi.fn();

    await expect(uploadProductionDraft({
      artifact: artifact(), endpoint, fetchImpl, shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    })).rejects.toThrow('Production draft endpoint must be same-origin.');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['blob', `blob:${window.location.origin}/production-draft`],
    ['data', 'data:application/json,{}'],
    ['file', 'file:///production-draft'],
  ])('rejects a non-http(s) %s endpoint before fetch', async (_protocol, endpoint) => {
    const fetchImpl = vi.fn().mockResolvedValue(json());
    const request = uploadProductionDraft({
      artifact: artifact(), endpoint, fetchImpl, shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(request).rejects.toThrow('Production draft endpoint must be same-origin.');
  });

  it.each([
    undefined,
    '',
    'TESTCSJ.myshopify.com',
    'testcsj.myshopify.com.attacker.example',
    'testcsj.myshopify.com/',
  ])('rejects malformed shop %j before fetch', async (shop) => {
    const fetchImpl = vi.fn();

    await expect(uploadProductionDraft({
      artifact: artifact(), fetchImpl, shop, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    })).rejects.toThrow('A valid shop is required.');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['missing file', (files) => files.slice(0, -1)],
    ['duplicate filename', (files) => files.map((file, index) => (
      index === 1 ? { ...file, filename: 'design.json' } : file
    ))],
  ])('rejects an artifact with a %s before fetch', async (_label, mutate) => {
    const fetchImpl = vi.fn();
    const value = artifact();
    value.files = mutate(value.files);

    await expect(uploadProductionDraft({
      artifact: value, fetchImpl, shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    })).rejects.toThrow('Production draft files are invalid.');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(Object.entries(FILE_SIZE_LIMITS))('accepts the exact %s size limit', async (filename, maxBytes) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);
    const fetchImpl = vi.fn().mockResolvedValue(json());

    await uploadProductionDraft({
      artifact: artifact({ [filename]: maxBytes }), fetchImpl, shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each(Object.entries(FILE_SIZE_LIMITS))('rejects a %s file above its size limit before fetch', async (filename, maxBytes) => {
    const fetchImpl = vi.fn().mockResolvedValue(json());
    const request = uploadProductionDraft({
      artifact: artifact({ [filename]: maxBytes + 1 }), fetchImpl, shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(request).rejects.toThrow('Production draft files are invalid.');
  });

  it('accepts an artifact at the aggregate size limit', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);
    const fetchImpl = vi.fn().mockResolvedValue(json());
    const sizes = {
      'design.json': 4 * MEBIBYTE,
      'uv-atlas.png': 8 * MEBIBYTE,
      'uv-pattern-pieces.png': 8 * MEBIBYTE,
      'uv-reference.pdf': 4 * MEBIBYTE,
      'preview-front.png': 4 * MEBIBYTE,
      'preview-back.png': 3 * MEBIBYTE,
      'manifest.json': MEBIBYTE,
    };

    const result = await uploadProductionDraft({
      artifact: artifact(sizes), fetchImpl, shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toEqual(SUCCESS);
  });

  it('rejects an artifact above the aggregate size limit before fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json());
    const sizes = {
      'design.json': FILE_SIZE_LIMITS['design.json'],
      'uv-atlas.png': FILE_SIZE_LIMITS['uv-atlas.png'],
      'uv-pattern-pieces.png': FILE_SIZE_LIMITS['uv-pattern-pieces.png'],
      'uv-reference.pdf': FILE_SIZE_LIMITS['uv-reference.pdf'],
      'preview-front.png': FILE_SIZE_LIMITS['preview-front.png'],
      'preview-back.png': FILE_SIZE_LIMITS['preview-back.png'],
      'manifest.json': 1,
    };

    const request = uploadProductionDraft({
      artifact: artifact(sizes), fetchImpl, shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(request).rejects.toThrow('Production draft files are invalid.');
  });

  it.each([undefined, '', '   '])('requires a Turnstile token before fetch', async (turnstileToken) => {
    const fetchImpl = vi.fn();

    await expect(uploadProductionDraft({
      artifact: artifact(), fetchImpl, shop: SHOP, turnstileToken, uploadId: UPLOAD_ID,
    })).rejects.toThrow('Turnstile verification is required.');

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['missing field', { ...SUCCESS, designId: undefined }],
    ['extra field', { ...SUCCESS, privateR2Key: 'shops/private/key' }],
    ['bad ID', { ...SUCCESS, designId: 'dsg_short' }],
    ['bad fingerprint', { ...SUCCESS, designFingerprint: 'not-a-fingerprint' }],
    ['unrelated filename', { ...SUCCESS, bundleFilename: 'https://private.example/bundle.zip' }],
    ['mismatched filename fingerprint', { ...SUCCESS, bundleFilename: 'fn8788-jersey-design-abcdef12.zip' }],
    ['unsafe expiry', { ...SUCCESS, expiresAt: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects an unsafe success response with %s', async (_label, body) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);
    const normalized = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));

    await expect(uploadProductionDraft({
      artifact: artifact(), fetchImpl: vi.fn().mockResolvedValue(json(normalized)), shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    })).rejects.toThrow('Production draft upload failed.');
  });

  it('rejects an expired response', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);

    await expect(uploadProductionDraft({
      artifact: artifact(), fetchImpl: vi.fn().mockResolvedValue(json({ ...SUCCESS, expiresAt: NOW })), shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    })).rejects.toThrow('Production draft upload failed.');
  });

  it('uses a bounded safe server error without exposing unsafe response bodies', async () => {
    const safe = vi.fn().mockResolvedValue(json(
      { error: 'Production package could not be verified.' },
      { status: 422 },
    ));
    await expect(uploadProductionDraft({
      artifact: artifact(), fetchImpl: safe, shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    })).rejects.toThrow('Production package could not be verified.');

    for (const response of [
      new Response('<html>internal key: shops/private</html>', { status: 503 }),
      json({ error: 'x'.repeat(201) }, { status: 500 }),
      json({ error: 'private\nstack trace' }, { status: 500 }),
    ]) {
      await expect(uploadProductionDraft({
        artifact: artifact(), fetchImpl: vi.fn().mockResolvedValue(response), shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
      })).rejects.toThrow('Production draft upload failed.');
    }
  });

  it('uses a stable error for network and non-JSON success failures', async () => {
    await expect(uploadProductionDraft({
      artifact: artifact(), fetchImpl: vi.fn().mockRejectedValue(new Error('private network detail')), shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    })).rejects.toThrow('Production draft upload failed.');

    await expect(uploadProductionDraft({
      artifact: artifact(), fetchImpl: vi.fn().mockResolvedValue(new Response('not-json', { status: 201 })), shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    })).rejects.toThrow('Production draft upload failed.');
  });

  it('propagates caller cancellation as an AbortError', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = uploadProductionDraft({
      artifact: artifact(), fetchImpl, shop: SHOP, signal: controller.signal, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    });

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl.mock.calls[0][1].signal).toHaveProperty('aborted', true);
    expect(removeListener).toHaveBeenCalled();
  });

  it('clears the timeout after a successful response', async () => {
    vi.useFakeTimers();
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);

    await uploadProductionDraft({
      artifact: artifact(), fetchImpl: vi.fn().mockResolvedValue(json()), shop: SHOP, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a stalled request at its timeout and reports a finite error', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = uploadProductionDraft({
      artifact: artifact(), fetchImpl, shop: SHOP, timeoutMs: 25, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    });
    const rejection = expect(result).rejects.toThrow('Production draft upload timed out. Try again.');

    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(fetchImpl.mock.calls[0][1].signal).toHaveProperty('aborted', true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a stalled response body read at its timeout and clears the timer', async () => {
    vi.useFakeTimers();
    const response = { ok: true, json: vi.fn(() => new Promise(() => {})) };
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const result = uploadProductionDraft({
      artifact: artifact(), fetchImpl, shop: SHOP, timeoutMs: 25, turnstileToken: 'verified-token', uploadId: UPLOAD_ID,
    });
    const rejection = expect(result).rejects.toThrow('Production draft upload timed out. Try again.');

    await vi.advanceTimersByTimeAsync(0);
    expect(response.json).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(fetchImpl.mock.calls[0][1].signal).toHaveProperty('aborted', true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
