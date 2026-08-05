import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadProductionDraft } from './productionDraftApi.js';

const NOW = 1_788_470_400_000;
const SHOP = 'testcsj.myshopify.com';
const UPLOAD_ID = 'upl_1234567890abcdef';
const SUCCESS = {
  designId: 'dsg_1234567890abcdef',
  designFingerprint: '6ac2cd02',
  bundleFilename: 'fn8788-jersey-design-6ac2cd02.zip',
  expiresAt: NOW,
};
const SESSION = {
  ...SUCCESS,
  uploadToken: 'upt_12345678-1234-4234-8234-123456789abc',
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('uploadProductionDraft', () => {
  it('creates a small session then uploads manifest and ZIP without multipart buffering', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);
    const fetchImpl = successfulFetch();
    const result = await uploadProductionDraft(input({ fetchImpl }));

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/production-drafts', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    }));
    const declaration = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(declaration).toMatchObject({
      shop: SHOP,
      uploadId: UPLOAD_ID,
      turnstileToken: 'verified-token',
      design: {
        designFingerprint: SUCCESS.designFingerprint,
        productId: 'fn8788-jersey',
        variantId: '48039101989015',
        size: 'xl',
        modelId: 'chelsea-jersey',
        modelVersion: '1',
        uvExportVersion: '2',
      },
      manifest: { byteLength: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      bundle: {
        filename: SUCCESS.bundleFilename,
        byteLength: 14,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(fetchImpl.mock.calls[1][0]).toBe(`/api/production-drafts/${SUCCESS.designId}/manifest`);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: 'PUT', body: expect.any(Blob), credentials: 'same-origin',
    });
    expect(fetchImpl.mock.calls[1][1].headers).toMatchObject({
      'X-Production-Shop': SHOP,
      'X-Production-Upload-Id': UPLOAD_ID,
      'X-Production-Upload-Token': SESSION.uploadToken,
      'Content-Type': 'application/json',
    });
    expect(fetchImpl.mock.calls[2][0]).toBe(`/api/production-drafts/${SUCCESS.designId}/bundle`);
    expect(fetchImpl.mock.calls[2][1]).toMatchObject({ method: 'PUT', body: expect.any(Blob) });
    expect(result).toEqual(SUCCESS);
  });

  it('returns immediately when the server reports the same upload already complete', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);
    const fetchImpl = vi.fn().mockResolvedValue(json(SUCCESS));
    await expect(uploadProductionDraft(input({ fetchImpl }))).resolves.toEqual(SUCCESS);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    'https://attacker.example/api/production-drafts',
    '//attacker.example/api/production-drafts',
    'data:application/json,{}',
    'file:///production-draft',
  ])('rejects unsafe endpoint %s before hashing or fetch', async (endpoint) => {
    const fetchImpl = vi.fn();
    await expect(uploadProductionDraft(input({ endpoint, fetchImpl })))
      .rejects.toThrow('Production draft endpoint must be same-origin.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'TESTCSJ.myshopify.com', 'testcsj.myshopify.com.attacker.example'])
    ('rejects malformed shop %j', async (shop) => {
      const fetchImpl = vi.fn();
      await expect(uploadProductionDraft(input({ fetchImpl, shop })))
        .rejects.toThrow('A valid shop is required.');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

  it('rejects missing, reordered or malformed production files', async () => {
    for (const mutate of [
      (value) => { value.files.pop(); },
      (value) => { value.files[1].filename = 'design.json'; },
      (value) => { value.files[0].blob = new Blob([], { type: 'application/json' }); },
    ]) {
      const value = artifact();
      mutate(value);
      await expect(uploadProductionDraft(input({ artifact: value, fetchImpl: vi.fn() })))
        .rejects.toThrow('Production draft files are invalid.');
    }
  });

  it('rejects an invalid ZIP or a ZIP identity that differs from the manifest', async () => {
    for (const value of [
      { ...artifact(), blob: new Blob([], { type: 'application/zip' }) },
      { ...artifact(), filename: 'fn8788-jersey-design-deadbeef.zip' },
      { ...artifact(), fingerprint: 'deadbeef' },
    ]) {
      await expect(uploadProductionDraft(input({ artifact: value, fetchImpl: vi.fn() })))
        .rejects.toThrow('Production draft bundle is invalid.');
    }
  });

  it.each([undefined, '', '   '])('requires Turnstile before hashing or fetch', async (turnstileToken) => {
    const fetchImpl = vi.fn();
    await expect(uploadProductionDraft(input({ fetchImpl, turnstileToken })))
      .rejects.toThrow('Turnstile verification is required.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['missing session token', { ...SUCCESS }],
    ['extra session field', { ...SESSION, privateKey: 'shops/private' }],
    ['bad session ID', { ...SESSION, designId: 'dsg_short' }],
    ['mismatched session fingerprint', { ...SESSION, designFingerprint: 'deadbeef' }],
  ])('rejects an unsafe %s response', async (_label, session) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);
    const first = _label === 'missing session token'
      ? { ...session, privateKey: 'unexpected' }
      : session;
    await expect(uploadProductionDraft(input({
      fetchImpl: vi.fn().mockResolvedValue(json(first)),
    }))).rejects.toThrow('Production draft upload failed.');
  });

  it('rejects a final response that differs from the reserved session', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);
    const fetchImpl = successfulFetch({ final: { ...SUCCESS, designFingerprint: 'deadbeef' } });
    await expect(uploadProductionDraft(input({ fetchImpl })))
      .rejects.toThrow('Production draft upload failed.');
  });

  it('uses bounded server errors but hides unsafe bodies and network details', async () => {
    const safe = vi.fn().mockResolvedValue(json(
      { error: 'Production upload session has expired.' }, { status: 409 },
    ));
    await expect(uploadProductionDraft(input({ fetchImpl: safe })))
      .rejects.toThrow('Production upload session has expired.');

    for (const fetchImpl of [
      vi.fn().mockRejectedValue(new Error('private network detail')),
      vi.fn().mockResolvedValue(new Response('<html>private</html>', { status: 503 })),
      vi.fn().mockResolvedValue(json({ error: 'private\nstack' }, { status: 503 })),
    ]) {
      await expect(uploadProductionDraft(input({ fetchImpl })))
        .rejects.toThrow('Production draft upload failed.');
    }
  });

  it('propagates caller cancellation as AbortError and clears listeners', async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = uploadProductionDraft(input({ fetchImpl, signal: controller.signal }));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl.mock.calls[0][1].signal).toHaveProperty('aborted', true);
    expect(removeListener).toHaveBeenCalled();
  });

  it('aborts a stalled stage at the bounded timeout and clears the timer', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = uploadProductionDraft(input({ fetchImpl, timeoutMs: 25 }));
    const rejection = expect(result).rejects.toThrow('Production draft upload timed out. Try again.');
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer after all three requests succeed', async () => {
    vi.useFakeTimers();
    vi.spyOn(Date, 'now').mockReturnValue(NOW - 1);
    await uploadProductionDraft(input({ fetchImpl: successfulFetch() }));
    expect(vi.getTimerCount()).toBe(0);
  });
});

function input(overrides = {}) {
  return {
    artifact: artifact(),
    fetchImpl: successfulFetch(),
    shop: SHOP,
    turnstileToken: 'verified-token',
    uploadId: UPLOAD_ID,
    ...overrides,
  };
}

function artifact() {
  const manifest = {
    designFingerprint: SUCCESS.designFingerprint,
    productId: 'fn8788-jersey',
    variantId: '48039101989015',
    size: 'xl',
    model: { id: 'chelsea-jersey', version: '1' },
    uvExportVersion: '2',
  };
  return {
    blob: new Blob(['production-zip'], { type: 'application/zip' }),
    filename: SUCCESS.bundleFilename,
    fingerprint: SUCCESS.designFingerprint,
    manifest,
    files: FILES.map(([filename, type]) => ({
      filename,
      blob: new Blob([
        filename === 'manifest.json' ? JSON.stringify(manifest) : filename,
      ], { type }),
    })),
  };
}

function successfulFetch({ final = SUCCESS, session = SESSION } = {}) {
  return vi.fn()
    .mockResolvedValueOnce(json(session))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(json(final));
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}
