import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
  sha256Hex,
} from '../../src/features/configurator/designs/productionManifest.js';
import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import { selectedOptions } from '../../src/features/configurator/config/selectors.js';
import { createProductionPackage } from '../../src/features/configurator/designs/productionPackage.js';
import { createProductionDraftsHandler } from './productionDrafts.js';
import { validateAndRebuildUploadedProductionPackage } from './productionPackageValidator.js';

const SHOP = 'testcsj.myshopify.com';
const UPLOAD_ID = 'upl_1234567890abcdef';
const NOW = 1_788_480_000_000;
const EXPIRES_AT = NOW + 30 * 24 * 60 * 60 * 1000;
const UUID = '11111111-1111-4111-8111-111111111111';
const DESIGN_ID = `dsg_${UUID}`;
const FINGERPRINT = '6ac2cd02';
const PRODUCT_ID = 'fn8788-jersey';
const VARIANT_ID = '48039101989015';
const SIZE = 'xl';
const BUNDLE_FILENAME = `${PRODUCT_ID}-design-${FINGERPRINT}.zip`;
const EXISTING_UPLOAD_TOKEN = 'upt_22222222-2222-4222-8222-222222222222';
const MAX_MULTIPART_BYTES = MAX_PRODUCTION_PACKAGE_BYTES + 64 * 1024;
const ARTIFACT_HASHES = Object.freeze([
  '1'.repeat(64),
  '2'.repeat(64),
  '3'.repeat(64),
  '4'.repeat(64),
  '5'.repeat(64),
  '6'.repeat(64),
]);
const originalBlobStream = Object.getOwnPropertyDescriptor(Blob.prototype, 'stream');

let runtime;

beforeEach(() => {
  runtime = createRuntime();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalBlobStream) Object.defineProperty(Blob.prototype, 'stream', originalBlobStream);
  else delete Blob.prototype.stream;
});

describe('production draft configuration', () => {
  it('returns only the public Turnstile site key with no-store caching', async () => {
    const response = await runtime.handler(request({ method: 'GET', pathname: '/api/production-drafts/config' }));
    const responseCopy = response.clone();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ turnstileSiteKey: 'public-site-key' });
    expect(JSON.stringify(await responseCopy.json())).not.toContain('secret');
  });

  it.each([
    [{ LOCAL_PRODUCTION_FILES: 'true' }, 'local mode'],
    [{ TURNSTILE_SITE_KEY: '' }, 'missing site key'],
  ])('returns a stable 503 for %s without exposing configuration', async (envOverride) => {
    const current = createRuntime({ env: envOverride });
    const response = await current.handler(request({ method: 'GET', pathname: '/api/production-drafts/config' }));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Production draft uploads are temporarily unavailable.' });
  });
});

describe('production draft request gates', () => {
  it('returns 405 with Allow for unsupported methods', async () => {
    const response = await runtime.handler(request({ method: 'PUT' }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it.each([
    ['PRODUCTION_ASSETS', undefined],
    ['PRODUCTION_DB', undefined],
    ['PRODUCTION_UPLOAD_RATE_LIMIT', undefined],
    ['TURNSTILE_SITE_KEY', ''],
    ['TURNSTILE_SECRET_KEY', ''],
    ['SHOPIFY_STORE_CONFIG_JSON', ''],
    ['SHOPIFY_STORE_CONFIG_JSON', '{broken'],
  ])('rejects an invalid %s binding before reading the body', async (key, value) => {
    const current = createRuntime({ env: { [key]: value } });
    const body = bodyTrackingRequest();

    const response = await current.handler(body.request);

    expect(response.status).toBe(503);
    expect(body.formData).not.toHaveBeenCalled();
    expect(body.bodyReads()).toBe(0);
    await expect(response.json()).resolves.toEqual({ error: 'Production draft uploads are temporarily unavailable.' });
  });

  it.each([
    ['array root', '[]'],
    ['missing pricing fields', JSON.stringify({
      [SHOP]: { productId: PRODUCT_ID, jerseyVariants: { [SIZE]: VARIANT_ID } },
    })],
    ['invalid surcharge map', JSON.stringify({
      [SHOP]: {
        productId: PRODUCT_ID,
        currency: 'USD',
        jerseyVariants: { [SIZE]: VARIANT_ID },
        surchargeVariants: { 18: null },
      },
    })],
    ['unexpected config field', JSON.stringify({
      [SHOP]: {
        productId: PRODUCT_ID,
        currency: 'USD',
        jerseyVariants: { [SIZE]: VARIANT_ID },
        surchargeVariants: {},
        secret: 'must-not-be-accepted',
      },
    })],
  ])('rejects malformed store config before reading the body: %s', async (_label, serialized) => {
    const current = createRuntime({ env: { SHOPIFY_STORE_CONFIG_JSON: serialized } });
    const body = bodyTrackingRequest();

    const response = await current.handler(body.request);

    expect(response.status).toBe(503);
    expect(body.formData).not.toHaveBeenCalled();
    expect(body.bodyReads()).toBe(0);
  });

  it('keeps checked-in local production mode disabled before reading the body', async () => {
    const current = createRuntime({ env: { LOCAL_PRODUCTION_FILES: true } });
    const body = bodyTrackingRequest();
    const response = await current.handler(body.request);

    expect(response.status).toBe(503);
    expect(body.formData).not.toHaveBeenCalled();
    expect(body.bodyReads()).toBe(0);
  });

  it.each([
    [null, '1024', 415],
    ['multipart/form-data', '1024', 415],
    ['multipart/form-data; boundary=', '1024', 415],
    ['multipart/form-data; boundary="unterminated', '1024', 415],
    ['multipart/form-data; boundary=valid', null, 411],
    ['multipart/form-data; boundary=valid', '0', 400],
    ['multipart/form-data; boundary=valid', '-1', 400],
    ['multipart/form-data; boundary=valid', '01', 400],
    ['multipart/form-data; boundary=valid', 'garbage', 400],
    ['multipart/form-data; boundary=valid', String(MAX_MULTIPART_BYTES + 1), 413],
  ])('rejects content headers before formData (%s, %s)', async (contentType, contentLength, status) => {
    const body = bodyTrackingRequest({ contentLength, contentType });
    const response = await runtime.handler(body.request);

    expect(response.status).toBe(status);
    expect(body.formData).not.toHaveBeenCalled();
    expect(body.bodyReads()).toBe(0);
  });

  it('accepts the exact multipart request limit and calls formData once', async () => {
    const body = bodyTrackingRequest({ contentLength: String(MAX_MULTIPART_BYTES) });
    const response = await runtime.handler(body.request);

    expect(response.status).toBe(201);
    expect(body.formData).toHaveBeenCalledOnce();
    expect(body.bodyReads()).toBe(0);
  });

  it('applies an anonymous IP rate limit before calling native formData', async () => {
    const current = createRuntime({
      env: {
        PRODUCTION_UPLOAD_RATE_LIMIT: {
          limit: vi.fn(async () => ({ success: false })),
        },
      },
    });
    const body = bodyTrackingRequest();

    const response = await current.handler(body.request);

    expect(response.status).toBe(429);
    expect(body.formData).not.toHaveBeenCalled();
    expect(body.bodyReads()).toBe(0);
  });

  it.each([
    ['missing field', (form) => form.delete('shop')],
    ['duplicate string', (form) => form.append('shop', SHOP)],
    ['duplicate file', (form) => form.append('design.json', new Blob(['x'], { type: 'application/json' }), 'design.json')],
    ['extra field', (form) => form.append('extra', 'x')],
    ['file instead of string', (form) => { form.delete('shop'); form.append('shop', new Blob(['x']), 'shop'); }],
    ['string instead of file', (form) => { form.delete('design.json'); form.append('design.json', 'x'); }],
    ['wrong filename', (form) => { const file = form.get('design.json'); form.delete('design.json'); form.append('design.json', file, 'wrong.json'); }],
    ['empty token', (form) => { form.delete('turnstileToken'); form.append('turnstileToken', ''); }],
    ['oversized token', (form) => { form.delete('turnstileToken'); form.append('turnstileToken', 'x'.repeat(4097)); }],
    ['uppercase shop', (form) => { form.delete('shop'); form.append('shop', 'TESTCSJ.myshopify.com'); }],
    ['invalid upload id', (form) => { form.delete('uploadId'); form.append('uploadId', 'upl_short'); }],
  ])('rejects malformed FormData: %s', async (_label, mutate) => {
    const form = validFormData();
    mutate(form);
    const current = createRuntime({ form });

    const response = await current.handler(current.request());

    expect(response.status).toBe(400);
    expect(current.dependencies.fetchImpl).not.toHaveBeenCalled();
    expect(current.env.PRODUCTION_ASSETS.put).not.toHaveBeenCalled();
  });

  it('maps native formData parsing and iteration failures to stable 400 responses', async () => {
    const formData = vi.fn(async () => { throw new Error('parser details'); });
    const response = await runtime.handler(request({ formData }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Production draft request is invalid.' });

    const poisoned = validFormData();
    Object.defineProperty(poisoned, 'entries', { value: () => { throw new Error('iterator details'); } });
    const second = createRuntime({ form: poisoned });
    const secondResponse = await second.handler(second.request());
    expect(secondResponse.status).toBe(400);
  });

  it('rejects empty, per-file oversized and aggregate oversized files before Turnstile', async () => {
    for (const form of [
      formWithBlob('design.json', new Blob([], { type: 'application/json' })),
      formWithBlob('design.json', sizedBlob(8 * 1024 * 1024 + 1, 'application/json')),
      aggregateOversizedForm(),
    ]) {
      const current = createRuntime({ form });
      const response = await current.handler(current.request());
      expect(response.status).toBe(400);
      expect(current.dependencies.fetchImpl).not.toHaveBeenCalled();
    }
  });
});

describe('production draft abuse protection and store scope', () => {
  it('requires a configured exact lowercase shop before Turnstile', async () => {
    const form = validFormData();
    form.delete('shop');
    form.append('shop', 'other.myshopify.com');
    const current = createRuntime({ form });

    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.dependencies.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [{ success: false, action: 'production_draft' }, 403],
    [{ success: true, action: 'wrong_action' }, 403],
    [{ success: 'true', action: 'production_draft' }, 503],
  ])('validates Turnstile success and action (%j)', async (turnstile, status) => {
    const current = createRuntime({ turnstile });
    const response = await current.handler(current.request());

    expect(response.status).toBe(status);
    expect(current.env.PRODUCTION_UPLOAD_RATE_LIMIT.limit).toHaveBeenCalledOnce();
    expect(current.env.PRODUCTION_UPLOAD_RATE_LIMIT.limit.mock.calls[0][0].key)
      .toMatch(/^production-draft-preflight:[A-Za-z0-9_-]{32}$/u);
    const [url, init] = current.dependencies.fetchImpl.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.body.get('secret')).toBe('turnstile-secret');
    expect(init.body.get('response')).toBe('verified-token');
    expect(init.body.get('remoteip')).toBe('203.0.113.5');
  });

  it.each([
    ['network failure', () => { throw new Error('network details'); }],
    ['non-ok response', async () => Response.json({}, { status: 502 })],
    ['malformed json', async () => new Response('{broken', { status: 200 })],
  ])('returns stable 503 for Turnstile service failure: %s', async (_label, fetchImpl) => {
    const current = createRuntime({ fetchImpl: vi.fn(fetchImpl) });
    const response = await current.handler(current.request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Production draft uploads are temporarily unavailable.' });
  });

  it('aborts a stalled Turnstile request and clears the timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const current = createRuntime({ fetchImpl, turnstileTimeoutMs: 100 });
    const pending = current.handler(current.request());
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(100);

    const response = await pending;
    expect(response.status).toBe(503);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a short SHA-256 rate-limit key without the raw IP or shop', async () => {
    await runtime.handler(runtime.request());

    const inputs = runtime.env.PRODUCTION_UPLOAD_RATE_LIMIT.limit.mock.calls.map(([input]) => input);
    expect(inputs).toEqual([
      { key: expect.stringMatching(/^production-draft-preflight:[A-Za-z0-9_-]{32}$/u) },
      { key: expect.stringMatching(/^production-draft:[A-Za-z0-9_-]{32}$/u) },
    ]);
    expect(inputs.every(({ key }) => !key.includes('203.0.113.5') && !key.includes(SHOP))).toBe(true);
  });

  it.each([
    ['binding rejection', () => { throw new Error('rate details'); }, 503],
    ['invalid result', async () => ({}), 503],
    ['denied', async () => ({ success: false }), 429],
  ])('handles native rate-limit %s', async (_label, limit, status) => {
    const current = createRuntime({ env: { PRODUCTION_UPLOAD_RATE_LIMIT: { limit: vi.fn(limit) } } });
    const response = await current.handler(current.request());
    expect(response.status).toBe(status);
    expect(current.dependencies.validateAndRebuildUploadedProductionPackage).not.toHaveBeenCalled();
  });

  it.each([
    ['product mismatch', { productId: 'other-product' }],
    ['variant mismatch', { jerseyVariants: { [SIZE]: '999999999' } }],
    ['missing variant', { jerseyVariants: { [SIZE]: null } }],
  ])('rejects store identity mismatch: %s', async (_label, configOverride) => {
    const current = createRuntime({ storeConfig: configOverride });
    const response = await current.handler(current.request());
    expect(response.status).toBe(400);
    expect(current.dependencies.fetchImpl).toHaveBeenCalledOnce();
    expect(current.env.PRODUCTION_UPLOAD_RATE_LIMIT.limit).toHaveBeenCalledTimes(2);
    expect(current.dependencies.validateAndRebuildUploadedProductionPackage).not.toHaveBeenCalled();
  });
});

describe('production draft idempotency', () => {
  it('returns the same active matching draft before validation or R2 writes', async () => {
    const existing = existingDraft();
    const current = createRuntime({ existing });
    const response = await current.handler(current.request());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(successPayload(existing));
    expect(current.repository.getCartDraftByUpload).toHaveBeenCalledWith(SHOP, UPLOAD_ID);
    expect(current.dependencies.validateAndRebuildUploadedProductionPackage).not.toHaveBeenCalled();
    expect(current.env.PRODUCTION_ASSETS.put).not.toHaveBeenCalled();
  });

  it.each([
    ['different fingerprint', { designFingerprint: 'deadbeef' }],
    ['expired', { expiresAt: NOW }],
    ['non-draft', { status: 'paid_pending_production' }],
    ['different product', { productId: 'other-product' }],
    ['different variant', { variantId: '999999999' }],
    ['different size', { size: 'l' }],
  ])('returns stable 409 for reused upload ID with %s', async (_label, override) => {
    const current = createRuntime({ existing: existingDraft(override) });
    const response = await current.handler(current.request());
    expect(response.status).toBe(409);
    expect(current.env.PRODUCTION_ASSETS.put).not.toHaveBeenCalled();
  });

  it('rejects even a very old upload_pending row before validation or R2 writes', async () => {
    const pending = existingDraft({
      status: 'upload_pending',
      uploadToken: EXISTING_UPLOAD_TOKEN,
      createdAt: 1,
      updatedAt: 1,
    });
    const current = createRuntime({ existing: pending });

    const response = await current.handler(current.request());

    expect(response.status).toBe(409);
    expect(current.dependencies.validateAndRebuildUploadedProductionPackage).not.toHaveBeenCalled();
    expect(current.repository.createUploadPending).not.toHaveBeenCalled();
    expect(current.env.PRODUCTION_ASSETS.put).not.toHaveBeenCalled();
  });

  it('never grants a second same-upload owner that could interleave with a delayed old R2 writer', async () => {
    const row = existingDraft({
      status: 'upload_pending',
      uploadToken: EXISTING_UPLOAD_TOKEN,
      createdAt: 1,
      updatedAt: 1,
    });
    const sharedRepository = {
      getCartDraftByUpload: vi.fn(async () => row),
      createUploadPending: vi.fn(),
      finalizeCartDraft: vi.fn(),
      claimOwnedUploadCleanup: vi.fn(),
      deleteClaimedDraft: vi.fn(),
    };
    const current = createRuntime({
      repository: sharedRepository,
    });

    const response = await current.handler(current.request());

    expect(response.status).toBe(409);
    expect(sharedRepository.getCartDraftByUpload).toHaveBeenCalledOnce();
    expect(sharedRepository.createUploadPending).not.toHaveBeenCalled();
    expect(sharedRepository.finalizeCartDraft).not.toHaveBeenCalled();
    expect(current.dependencies.validateAndRebuildUploadedProductionPackage).not.toHaveBeenCalled();
    expect(current.env.PRODUCTION_ASSETS.put).not.toHaveBeenCalled();
    expect(current.env.PRODUCTION_ASSETS.delete).not.toHaveBeenCalled();
  });

  it('retries the same upload ID only after owned cleanup and uses a new random key prefix', async () => {
    let row = null;
    const sharedRepository = {
      getCartDraftByUpload: vi.fn(async () => row),
      createUploadPending: vi.fn(async (draft) => {
        if (row !== null) return row;
        row = existingDraft({ ...draft, status: 'upload_pending' });
        return row;
      }),
      finalizeCartDraft: vi.fn(async (input) => {
        if (row?.uploadToken !== input.uploadToken) throw new Error('wrong owner');
        row = existingDraft({ ...row, status: 'cart_draft', uploadToken: null });
        return row;
      }),
      claimOwnedUploadCleanup: vi.fn(async (input) => {
        if (row?.uploadToken !== input.uploadToken) throw new Error('lost owner');
        row = existingDraft({
          ...row,
          status: 'cleanup_pending',
          uploadToken: null,
          cleanupToken: input.cleanupToken,
          cleanupStartedAt: input.claimedAt,
        });
        return row;
      }),
      deleteClaimedDraft: vi.fn(async ({ claimToken }) => {
        if (row?.cleanupToken !== claimToken) return false;
        row = null;
        return true;
      }),
    };
    const failed = createRuntime({ putFailureIndex: 0, repository: sharedRepository });
    const retried = createRuntime({
      randomUUID: () => '33333333-3333-4333-8333-333333333333',
      repository: sharedRepository,
    });

    const failedResponse = await failed.handler(failed.request());
    const retriedResponse = await retried.handler(retried.request());

    expect(failedResponse.status).toBe(503);
    expect(retriedResponse.status).toBe(201);
    expect(sharedRepository.claimOwnedUploadCleanup).toHaveBeenCalledOnce();
    expect(sharedRepository.deleteClaimedDraft).toHaveBeenCalledOnce();
    const failedKeys = failed.env.PRODUCTION_ASSETS.put.mock.calls.map(([key]) => key);
    const retriedKeys = retried.env.PRODUCTION_ASSETS.put.mock.calls.map(([key]) => key);
    expect(failedKeys.every((key) => key.includes(`/designs/${DESIGN_ID}/`))).toBe(true);
    expect(retriedKeys.every((key) => (
      key.includes('/designs/dsg_33333333-3333-4333-8333-333333333333/')
    ))).toBe(true);
    expect(retriedKeys.some((key) => failedKeys.includes(key))).toBe(false);
  });

  it('does not delete objects when finalization returns another matching owner row', async () => {
    const concurrent = existingDraft({ designId: 'dsg_22222222-2222-4222-8222-222222222222' });
    const current = createRuntime({
      finalizeResult: concurrent,
      claimFailure: Object.assign(new Error('lost ownership'), {
        code: 'production-repository-conflict',
      }),
    });
    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.repository.claimOwnedUploadCleanup).toHaveBeenCalledOnce();
    expect(current.env.PRODUCTION_ASSETS.delete).not.toHaveBeenCalled();
  });

  it('does not delete objects when finalization returns a conflicting owner row', async () => {
    const current = createRuntime({
      finalizeResult: existingDraft({ designFingerprint: 'deadbeef' }),
      claimFailure: Object.assign(new Error('lost ownership'), {
        code: 'production-repository-conflict',
      }),
    });
    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.repository.claimOwnedUploadCleanup).toHaveBeenCalledOnce();
    expect(current.env.PRODUCTION_ASSETS.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['matching', existingDraft({ designId: 'dsg_22222222-2222-4222-8222-222222222222' })],
    ['conflicting', existingDraft({ designId: 'dsg_22222222-2222-4222-8222-222222222222', designFingerprint: 'deadbeef' })],
  ])('returns stable 503 when %s concurrent cleanup fails', async (_label, finalizeResult) => {
    const current = createRuntime({ deleteFailure: true, finalizeResult });

    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.env.PRODUCTION_ASSETS.delete).toHaveBeenCalledOnce();
  });
});

describe('production draft private storage', () => {
  it('rejects an unsafe shop fingerprint before creating D1 or R2 keys', async () => {
    const current = createRuntime({ shopFingerprint: '../unsafe' });

    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.repository.createUploadPending).not.toHaveBeenCalled();
    expect(current.env.PRODUCTION_ASSETS.put).not.toHaveBeenCalled();
  });

  it('integrates a real browser package with the atomic validator and streamed R2 bundle', async () => {
    installBlobStreamPolyfill();
    const artifact = await createRealProductionPackage();
    const form = productionForm(artifact.files);
    const current = createRuntime({
      form,
      validateAndRebuild: validateAndRebuildUploadedProductionPackage,
    });

    const response = await current.handler(current.request());
    const body = await response.json();

    expect(response.status, JSON.stringify({
      body,
      logs: current.dependencies.logger.error.mock.calls,
    })).toBe(201);
    expect(body.designFingerprint).toBe(artifact.fingerprint);
    expect(body.bundleFilename).toBe(artifact.filename);
    expect(current.env.PRODUCTION_ASSETS.put).toHaveBeenCalledTimes(8);
    const bundlePut = current.env.PRODUCTION_ASSETS.put.mock.calls[7];
    expect(bundlePut[1]).toBeInstanceOf(ReadableStream);
    const storedBundle = new Blob([await new Response(bundlePut[1]).arrayBuffer()]);
    expect(bundlePut[2].sha256).toBe(await sha256Hex(storedBundle));
    expect(bundlePut[2].customMetadata.sha256).toBe(bundlePut[2].sha256);
    expect(current.repository.createUploadPending).toHaveBeenCalledOnce();
    expect(current.repository.finalizeCartDraft).toHaveBeenCalledOnce();
  });

  it('reserves D1, writes seven validated Blobs and a fresh ZIP stream, then finalizes D1', async () => {
    const response = await runtime.handler(runtime.request());

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      designId: DESIGN_ID,
      designFingerprint: FINGERPRINT,
      bundleFilename: BUNDLE_FILENAME,
      expiresAt: EXPIRES_AT,
    });
    expect(runtime.dependencies.validateAndRebuildUploadedProductionPackage).toHaveBeenCalledOnce();
    expect(runtime.dependencies.validateAndRebuildUploadedProductionPackage).toHaveBeenCalledWith({
      expectedShop: SHOP,
      files: PRODUCTION_PACKAGE_FILE_CONTRACT.map(({ filename }) => ({
        filename,
        blob: expect.any(Blob),
      })),
    });

    const puts = runtime.env.PRODUCTION_ASSETS.put.mock.calls;
    expect(puts).toHaveLength(8);
    expect(puts.slice(0, 7).map(([key]) => key.split('/').at(-1)))
      .toEqual(PRODUCTION_PACKAGE_FILE_CONTRACT.map(({ filename }) => filename));
    expect(puts.slice(0, 7).every(([, value]) => value instanceof Blob)).toBe(true);
    expect(puts[7][0].split('/').at(-1)).toBe(BUNDLE_FILENAME);
    expect(puts[7][1]).not.toBe(runtime.bundle.stream);
    expect(puts[7][1]).toBeInstanceOf(ReadableStream);
    expect(runtime.events).toEqual([
      'd1:reserve',
      'put:design.json', 'put:uv-atlas.png', 'put:uv-pattern-pieces.png',
      'put:uv-reference.pdf', 'put:preview-front.png', 'put:preview-back.png',
      'put:manifest.json', `put:${BUNDLE_FILENAME}`, 'd1:finalize',
    ]);
    expect(runtime.repository.createUploadPending).toHaveBeenCalledWith(expect.objectContaining({
      designId: DESIGN_ID,
      shop: SHOP,
      uploadId: UPLOAD_ID,
      productId: PRODUCT_ID,
      variantId: VARIANT_ID,
      size: SIZE,
      manifestKey: expect.stringContaining(`/designs/${DESIGN_ID}/manifest.json`),
      bundleKey: expect.stringContaining(`/designs/${DESIGN_ID}/${BUNDLE_FILENAME}`),
      createdAt: NOW,
      expiresAt: EXPIRES_AT,
      uploadToken: expect.stringMatching(/^upt_/u),
      updatedAt: NOW,
    }));
    expect(runtime.repository.finalizeCartDraft).toHaveBeenCalledWith({
      shop: SHOP,
      designId: DESIGN_ID,
      uploadId: UPLOAD_ID,
      uploadToken: expect.stringMatching(/^upt_/u),
      updatedAt: NOW,
    });
  });

  it('stores safe MIME, artifact SHA-256, manifest SHA-256 and bundle length metadata', async () => {
    await runtime.handler(runtime.request());
    const calls = runtime.env.PRODUCTION_ASSETS.put.mock.calls;
    for (let index = 0; index < 6; index += 1) {
      expect(calls[index][2]).toEqual({
        httpMetadata: { contentType: PRODUCTION_PACKAGE_FILE_CONTRACT[index].mediaType },
        customMetadata: {
          designFingerprint: FINGERPRINT,
          productId: PRODUCT_ID,
          variantId: VARIANT_ID,
          size: SIZE,
          sha256: ARTIFACT_HASHES[index],
        },
      });
    }
    const manifest = runtime.files[6].blob;
    const manifestHash = await sha256Hex(manifest);
    expect(calls[6][2].customMetadata.sha256).toBe(manifestHash);
    expect(runtime.repository.createUploadPending.mock.calls[0][0].manifestSha256).toBe(manifestHash);
    const bundleHash = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81';
    expect(calls[7][2]).toEqual({
      httpMetadata: { contentType: 'application/zip' },
      sha256: bundleHash,
      customMetadata: {
        designFingerprint: FINGERPRINT,
        productId: PRODUCT_ID,
        variantId: VARIANT_ID,
        size: SIZE,
        contentLength: String(runtime.bundle.contentLength),
        sha256: bundleHash,
      },
    });
  });

  it.each(Array.from({ length: 8 }, (_, index) => index))(
    'cleans all eight possible keys when R2 put %i fails',
    async (failureIndex) => {
      const current = createRuntime({ putFailureIndex: failureIndex });
      const response = await current.handler(current.request());

      expect(response.status).toBe(503);
      expect(current.env.PRODUCTION_ASSETS.delete).toHaveBeenCalledOnce();
      expect(current.env.PRODUCTION_ASSETS.delete.mock.calls[0][0]).toHaveLength(8);
      expect(current.repository.claimOwnedUploadCleanup).toHaveBeenCalledOnce();
      expect(current.repository.deleteClaimedDraft).toHaveBeenCalledOnce();
      const claimIndex = current.events.indexOf('d1:claim-cleanup');
      const r2DeleteIndex = current.events.indexOf('r2:delete');
      const rowDeleteIndex = current.events.indexOf('d1:delete-row');
      expect(claimIndex).toBeLessThan(r2DeleteIndex);
      expect(r2DeleteIndex).toBeLessThan(rowDeleteIndex);
      expect(current.repository.createUploadPending).toHaveBeenCalledOnce();
      expect(current.repository.finalizeCartDraft).not.toHaveBeenCalled();
      expect(JSON.stringify(await response.json())).not.toMatch(/shops\/|r2 details|stream details/iu);
    },
  );

  it('never deletes R2 objects when failure cleanup loses the owner-token CAS', async () => {
    const current = createRuntime({
      putFailureIndex: 3,
      claimFailure: Object.assign(new Error('winner owns the row'), {
        code: 'production-repository-conflict',
      }),
    });

    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.repository.claimOwnedUploadCleanup).toHaveBeenCalledOnce();
    expect(current.env.PRODUCTION_ASSETS.delete).not.toHaveBeenCalled();
    expect(current.repository.deleteClaimedDraft).not.toHaveBeenCalled();
  });

  it('leaves cleanup_pending for retry when the claimed D1 row cannot be deleted', async () => {
    const current = createRuntime({
      putFailureIndex: 3,
      deleteClaimedFailure: new Error('D1 delete failed'),
    });

    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.repository.claimOwnedUploadCleanup).toHaveBeenCalledOnce();
    expect(current.env.PRODUCTION_ASSETS.delete).toHaveBeenCalledOnce();
    expect(current.repository.deleteClaimedDraft).toHaveBeenCalledOnce();
    expect(current.events.slice(-3)).toEqual([
      'd1:claim-cleanup', 'r2:delete', 'd1:delete-row',
    ]);
    expect(current.dependencies.logger.error)
      .toHaveBeenCalledWith('PRODUCTION_DRAFT_CLEANUP_ROW_DELETE_FAILED');
  });

  it('claims and removes the pending index when the pre-upload ZIP hash stream fails', async () => {
    const stream = new ReadableStream({ start(controller) { controller.error(new Error('stream details')); } });
    const current = createRuntime({ bundle: { stream } });
    current.env.PRODUCTION_ASSETS.put.mockImplementation(async (key, value) => {
      current.events.push(`put:${key.split('/').at(-1)}`);
      if (value instanceof ReadableStream) await new Response(value).arrayBuffer();
      return { key };
    });

    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.repository.claimOwnedUploadCleanup).toHaveBeenCalledOnce();
    expect(current.env.PRODUCTION_ASSETS.delete).toHaveBeenCalledOnce();
    expect(current.repository.deleteClaimedDraft).toHaveBeenCalledOnce();
    expect(current.repository.createUploadPending).toHaveBeenCalledOnce();
    expect(current.repository.finalizeCartDraft).not.toHaveBeenCalled();
  });

  it('recovers an authoritative own row after an ambiguous D1 failure', async () => {
    const current = createRuntime({
      finalizeFailure: new Error('d1 details'),
      existingSequence: [null, existingDraft()],
    });
    const response = await current.handler(current.request());

    expect(response.status).toBe(201);
    expect(current.env.PRODUCTION_ASSETS.delete).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(successPayload(existingDraft()));
  });

  it('preserves indexed R2 objects when ambiguous finalization recovery read fails', async () => {
    const current = createRuntime({
      finalizeFailure: new Error('d1 details'),
      existingSequence: [null, new Error('read details')],
    });

    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.repository.claimOwnedUploadCleanup).not.toHaveBeenCalled();
    expect(current.env.PRODUCTION_ASSETS.delete).not.toHaveBeenCalled();
  });

  it('directly deletes unique unindexed keys when finalization removes the shared row before failing', async () => {
    let row = null;
    const sharedRepository = {
      getCartDraftByUpload: vi.fn(async () => row),
      createUploadPending: vi.fn(async (draft) => {
        row = existingDraft({ ...draft, status: 'upload_pending' });
        return row;
      }),
      finalizeCartDraft: vi.fn(async (input) => {
        if (row?.uploadToken !== input.uploadToken) throw new Error('wrong owner');
        row = null;
        throw new Error('ambiguous D1 failure after row removal');
      }),
      claimOwnedUploadCleanup: vi.fn(),
      deleteClaimedDraft: vi.fn(),
    };
    const current = createRuntime({ repository: sharedRepository });

    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(row).toBeNull();
    expect(sharedRepository.getCartDraftByUpload).toHaveBeenCalledTimes(2);
    expect(sharedRepository.claimOwnedUploadCleanup).not.toHaveBeenCalled();
    expect(current.env.PRODUCTION_ASSETS.delete).toHaveBeenCalledOnce();
    expect(current.env.PRODUCTION_ASSETS.delete.mock.calls[0][0]).toHaveLength(8);
  });

  it('keeps a stable response when direct cleanup of confirmed-unindexed keys fails', async () => {
    const current = createRuntime({
      finalizeFailure: new Error('d1 details'),
      existingSequence: [null, null],
      deleteFailure: true,
    });
    const response = await current.handler(current.request());

    expect(response.status).toBe(503);
    expect(current.repository.claimOwnedUploadCleanup).not.toHaveBeenCalled();
    expect(current.env.PRODUCTION_ASSETS.delete).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ error: 'Production draft uploads are temporarily unavailable.' });
    expect(current.dependencies.logger.error).toHaveBeenCalledWith('PRODUCTION_DRAFT_CLEANUP_FAILED');
    expect(JSON.stringify(current.dependencies.logger.error.mock.calls)).not.toContain('d1 details');
  });

  it('rejects invalid random UUID, clock, validator metadata and R2 put results as service failures', async () => {
    for (const current of [
      createRuntime({ randomUUID: () => 'unsafe' }),
      createRuntime({ now: () => Number.NaN }),
      createRuntime({ validated: { variantId: null } }),
      createRuntime({ putResult: null }),
    ]) {
      const response = await current.handler(current.request());
      expect(response.status).toBe(503);
    }
  });
});

function createRuntime({
  bundle: bundleOverride,
  claimFailure,
  claimResult,
  deleteFailure = false,
  deleteClaimedFailure,
  deleteClaimedResult,
  env: envOverrides = {},
  existing = null,
  existingSequence,
  fetchImpl,
  finalizeFailure,
  finalizeResult,
  form = validFormData(),
  now = () => NOW,
  putFailureIndex = -1,
  putResult,
  reserveFailure,
  reserveResult,
  repository: repositoryOverride,
  randomUUID = () => UUID,
  shopFingerprint = 'shop_abcdefghijkl',
  storeConfig = {},
  turnstile = { success: true, action: 'production_draft' },
  turnstileTimeoutMs,
  validateAndRebuild,
  validated: validatedOverride,
} = {}) {
  const files = snapshotFormFiles(form);
  const validated = Object.freeze({
    designFingerprint: FINGERPRINT,
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    size: SIZE,
    modelId: 'chelsea-jersey',
    modelVersion: '1',
    uvExportVersion: '2',
    files: Object.freeze(files),
    ...validatedOverride,
  });
  const createStream = () => new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); },
  });
  const bundle = Object.freeze({
    contentLength: 321,
    createStream,
    filename: BUNDLE_FILENAME,
    mediaType: 'application/zip',
    stream: createStream(),
    ...bundleOverride,
  });
  const events = [];
  const assets = {
    put: vi.fn(async (key) => {
      const index = events.filter((event) => event.startsWith('put:')).length;
      events.push(`put:${key.split('/').at(-1)}`);
      if (index === putFailureIndex) throw new Error('r2 details');
      return putResult === undefined ? { key } : putResult;
    }),
    get: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(async () => {
      events.push('r2:delete');
      if (deleteFailure) throw new Error('cleanup details');
    }),
  };
  const defaultExistingSequence = existingSequence ?? [existing];
  let reservedDraft;
  const repository = repositoryOverride ?? {
    getCartDraftByUpload: vi.fn(async () => {
      const next = defaultExistingSequence.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    }),
    createUploadPending: vi.fn(async (draft) => {
      events.push('d1:reserve');
      if (reserveFailure) throw reserveFailure;
      reservedDraft = existingDraft({ ...draft, status: 'upload_pending' });
      return reserveResult ?? reservedDraft;
    }),
    finalizeCartDraft: vi.fn(async (input) => {
      events.push('d1:finalize');
      if (finalizeFailure) throw finalizeFailure;
      return finalizeResult ?? existingDraft({
        ...reservedDraft,
        ...input,
        status: 'cart_draft',
        uploadToken: null,
      });
    }),
    claimOwnedUploadCleanup: vi.fn(async (input) => {
      events.push('d1:claim-cleanup');
      if (claimFailure) throw claimFailure;
      const claimed = existingDraft({
        ...reservedDraft,
        status: 'cleanup_pending',
        uploadToken: null,
        cleanupToken: input.cleanupToken,
        cleanupStartedAt: input.claimedAt,
        updatedAt: input.claimedAt,
      });
      return claimResult ?? claimed;
    }),
    deleteClaimedDraft: vi.fn(async () => {
      events.push('d1:delete-row');
      if (deleteClaimedFailure) throw deleteClaimedFailure;
      return deleteClaimedResult ?? true;
    }),
  };
  const store = {
    productId: PRODUCT_ID,
    currency: 'USD',
    jerseyVariants: { s: '48039101890711', m: '48039101923479', l: '48039101956247', [SIZE]: VARIANT_ID },
    surchargeVariants: {},
    ...storeConfig,
  };
  const env = {
    LOCAL_PRODUCTION_FILES: 'false',
    PRODUCTION_ASSETS: assets,
    PRODUCTION_DB: { prepare: vi.fn(), batch: vi.fn() },
    PRODUCTION_UPLOAD_RATE_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
    TURNSTILE_SITE_KEY: 'public-site-key',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({ [SHOP]: store }),
    ...envOverrides,
  };
  const dependencies = {
    createProductionRepository: vi.fn(() => repository),
    validateAndRebuildUploadedProductionPackage: validateAndRebuild
      ?? vi.fn(async () => ({ validated, bundle })),
    createShopFingerprint: vi.fn(async () => shopFingerprint),
    fetchImpl: fetchImpl ?? vi.fn(async () => Response.json(turnstile)),
    logger: { error: vi.fn() },
    now,
    randomUUID,
    ...(turnstileTimeoutMs === undefined ? {} : { turnstileTimeoutMs }),
  };
  return {
    handler: createProductionDraftsHandler(env, dependencies),
    request: (overrides = {}) => request({
      ...overrides,
      formData: overrides.formData ?? vi.fn(async () => form),
    }),
    env,
    dependencies,
    repository,
    files,
    bundle,
    events,
    form,
  };
}

function validFormData() {
  const form = new FormData();
  form.append('shop', SHOP);
  form.append('uploadId', UPLOAD_ID);
  form.append('turnstileToken', 'verified-token');
  for (const { filename, mediaType } of PRODUCTION_PACKAGE_FILE_CONTRACT) {
    const body = filename === 'manifest.json'
      ? JSON.stringify(manifest())
      : filename === 'design.json' ? '{}' : 'file';
    form.append(filename, new Blob([body], { type: mediaType }), filename);
  }
  return form;
}

function productionForm(files) {
  const form = new FormData();
  form.append('shop', SHOP);
  form.append('uploadId', UPLOAD_ID);
  form.append('turnstileToken', 'verified-token');
  for (const file of files) form.append(file.filename, file.blob, file.filename);
  return form;
}

async function createRealProductionPackage() {
  const state = structuredClone(jerseyProduct.defaultState);
  return createProductionPackage({
    artifactProvider: async () => realRenderedArtifacts(),
    generatedAt: '2026-08-04T00:00:00.000Z',
    product: jerseyProduct,
    selected: selectedOptions(jerseyProduct, state),
    state,
    variantId: '48039101923479',
  }, {
    createReferencePdf: async () => ({
      blob: new Blob(['%PDF-1.7\n%%EOF'], { type: 'application/pdf' }),
      pageCount: 2,
      pageSize: { widthMm: 297, heightMm: 210 },
    }),
  });
}

function realRenderedArtifacts() {
  return {
    atlas: renderedPng('atlas', 4096, 4096),
    legacyBakeMetadata: null,
    pieces: {
      ...renderedPng('pieces', 4096, 4096),
      layoutFingerprint: 'uv-pieces-v1-integration',
      outputTransform: { rotation: 180, mirrorX: true },
      pieces: [pieceMetadata(), pieceMetadata({
        id: 'back',
        label: 'Back',
        meshName: 'Cloth_mesh_4',
        order: 1,
        outputBounds: { x: 2200, y: 192, width: 1600, height: 3600 },
        sourceBounds: { x: 1200, y: 200, width: 1067, height: 2400 },
      })],
    },
    previews: {
      front: renderedPng('front', 1600, 1600),
      back: renderedPng('back', 1600, 1600),
    },
  };
}

function renderedPng(id, width, height) {
  return {
    blob: minimalPng(width, height),
    canvas: { id, width, height },
    colorSpace: 'sRGB',
    height,
    width,
  };
}

function minimalPng(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: 'image/png' });
}

function pieceMetadata({
  id = 'front',
  label = 'Front',
  meshName = 'Cloth_mesh_7',
  order = 0,
  outputBounds = { x: 192, y: 192, width: 1600, height: 3600 },
  sourceBounds = { x: 100, y: 200, width: 1067, height: 2400 },
} = {}) {
  return {
    aliases: [],
    coveragePixels: 840000,
    duplicateGroup: null,
    id,
    islandRefs: [{ meshName }],
    label,
    mappedTriangles: 128,
    mirrorX: false,
    order,
    outputBounds,
    rotation: 0,
    scale: 1.5,
    sourceBounds,
    sourceMeshes: [meshName],
    zone: id,
  };
}

function installBlobStreamPolyfill() {
  Object.defineProperty(Blob.prototype, 'stream', {
    configurable: true,
    value() {
      const blob = this;
      return new ReadableStream({
        start(controller) {
          const reader = new FileReader();
          reader.addEventListener('load', () => {
            controller.enqueue(new Uint8Array(reader.result));
            controller.close();
          });
          reader.addEventListener('error', () => controller.error(reader.error));
          reader.readAsArrayBuffer(blob);
        },
      });
    },
  });
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 2,
    uvExportVersion: '2',
    designFingerprint: FINGERPRINT,
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    size: SIZE,
    model: { id: 'chelsea-jersey', version: '1' },
    files: PRODUCTION_PACKAGE_FILE_CONTRACT.slice(0, 6).map(({ filename, mediaType }, index) => ({
      name: filename,
      mediaType,
      byteLength: 4,
      sha256: ARTIFACT_HASHES[index],
    })),
    ...overrides,
  };
}

function formWithBlob(filename, blob) {
  const form = validFormData();
  form.delete(filename);
  form.append(filename, blob, filename);
  return reorderFiles(form);
}

function aggregateOversizedForm() {
  const form = validFormData();
  const sizes = [8, 16, 16, 8, 8, 8, 1].map((mib) => mib * 1024 * 1024);
  PRODUCTION_PACKAGE_FILE_CONTRACT.forEach(({ filename, mediaType }, index) => {
    form.delete(filename);
    form.append(filename, sizedBlob(sizes[index], mediaType), filename);
  });
  return reorderFiles(form);
}

function reorderFiles(form) {
  const ordered = new FormData();
  for (const name of ['shop', 'uploadId', 'turnstileToken']) ordered.append(name, form.get(name));
  for (const { filename } of PRODUCTION_PACKAGE_FILE_CONTRACT) {
    const value = form.get(filename);
    ordered.append(filename, value, value.name);
  }
  return ordered;
}

function sizedBlob(size, type) {
  return new Blob([new Uint8Array(size)], { type });
}

function snapshotFormFiles(form) {
  return PRODUCTION_PACKAGE_FILE_CONTRACT.map(({ filename }) => ({ filename, blob: form.get(filename) }));
}

function request({
  contentLength = '4096',
  contentType = 'multipart/form-data; boundary=valid-boundary',
  formData,
  method = 'POST',
  pathname = '/api/production-drafts',
} = {}) {
  const headers = new Headers();
  if (contentType !== null) headers.set('content-type', contentType);
  if (contentLength !== null) headers.set('content-length', contentLength);
  headers.set('cf-connecting-ip', '203.0.113.5');
  return {
    method,
    url: `https://example.workers.dev${pathname}`,
    headers,
    formData: formData ?? vi.fn(async () => runtime?.form ?? validFormData()),
  };
}

function bodyTrackingRequest(overrides = {}) {
  let reads = 0;
  const formData = vi.fn(async () => validFormData());
  const value = request({ ...overrides, formData });
  Object.defineProperty(value, 'body', { get() { reads += 1; return null; } });
  return { request: value, formData, bodyReads: () => reads };
}

function existingDraft(overrides = {}) {
  return {
    designId: DESIGN_ID,
    shop: SHOP,
    uploadId: UPLOAD_ID,
    bundleId: null,
    status: 'cart_draft',
    productId: PRODUCT_ID,
    variantId: VARIANT_ID,
    size: SIZE,
    modelId: 'chelsea-jersey',
    modelVersion: '1',
    uvExportVersion: '2',
    designFingerprint: FINGERPRINT,
    manifestSha256: 'a'.repeat(64),
    manifestKey: `private/${DESIGN_ID}/manifest.json`,
    bundleKey: `private/${DESIGN_ID}/${BUNDLE_FILENAME}`,
    bundleFilename: BUNDLE_FILENAME,
    createdAt: NOW,
    expiresAt: EXPIRES_AT,
    uploadToken: null,
    cleanupToken: null,
    cleanupStartedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function successPayload(draft) {
  return {
    designId: draft.designId,
    designFingerprint: draft.designFingerprint,
    bundleFilename: draft.bundleFilename,
    expiresAt: draft.expiresAt,
  };
}
