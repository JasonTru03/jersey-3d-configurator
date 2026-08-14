import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProductionDraftsHandler } from './productionDrafts.js';

const NOW = 1_788_470_400_000;
const SHOP = 'testcsj.myshopify.com';
const UPLOAD_ID = 'upl_1234567890abcdef';
const DESIGN_ID = 'dsg_11111111-1111-4111-8111-111111111111';
const UPLOAD_TOKEN = 'upt_22222222-2222-4222-8222-222222222222';
const SHOP_FINGERPRINT = 'shop_abcdefghijkl';
const FINGERPRINT = '6ac2cd02';
const BUNDLE_FILENAME = `fn8788-jersey-design-${FINGERPRINT}.zip`;

beforeEach(() => vi.restoreAllMocks());

describe('production draft free-tier streaming protocol', () => {
  it('creates a bounded session, streams manifest and ZIP to R2, then finalizes D1', async () => {
    const fixture = await createFixture();
    const runtime = createRuntime();

    const created = await runtime.handler(sessionRequest(fixture.declaration));
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session).toEqual({
      designId: DESIGN_ID,
      designFingerprint: FINGERPRINT,
      bundleFilename: BUNDLE_FILENAME,
      expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
      uploadToken: UPLOAD_TOKEN,
    });
    expect(runtime.repository.createUploadPending).toHaveBeenCalledWith(expect.objectContaining({
      manifestBytes: fixture.manifest.size,
      manifestSha256: fixture.declaration.manifest.sha256,
      bundleBytes: fixture.bundle.size,
      bundleSha256: fixture.declaration.bundle.sha256,
    }));

    const manifest = await runtime.handler(uploadRequest('manifest', fixture.manifest));
    expect(manifest.status).toBe(204);
    expect(runtime.assets.put).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/manifest\.json$/u),
      expect.any(ReadableStream),
      expect.objectContaining({ sha256: fixture.declaration.manifest.sha256 }),
    );

    const bundle = await runtime.handler(uploadRequest('bundle', fixture.bundle));
    expect(bundle.status).toBe(201);
    await expect(bundle.json()).resolves.toEqual({
      designId: DESIGN_ID,
      designFingerprint: FINGERPRINT,
      bundleFilename: BUNDLE_FILENAME,
      expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    });
    expect(runtime.repository.finalizeCartDraft).toHaveBeenCalledOnce();
    expect(runtime.assets.put).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\.zip$/u),
      expect.any(ReadableStream),
      expect.objectContaining({ sha256: fixture.declaration.bundle.sha256 }),
    );
  });

  it.each([
    [null, '100', 415],
    ['multipart/form-data; boundary=x', '100', 415],
    ['application/json', null, 411],
    ['application/json', '0', 400],
    ['application/json', '20000', 413],
  ])('rejects unsafe session headers before parsing (%s, %s)', async (contentType, length, status) => {
    const runtime = createRuntime();
    const json = vi.fn();
    const headers = new Headers();
    if (contentType !== null) headers.set('content-type', contentType);
    if (length !== null) headers.set('content-length', length);
    const response = await runtime.handler({
      method: 'POST', url: 'https://example.test/api/production-drafts', headers, json,
    });
    expect(response.status).toBe(status);
    expect(json).not.toHaveBeenCalled();
  });

  it('rejects malformed declarations before Turnstile and storage', async () => {
    const fixture = await createFixture();
    delete fixture.declaration.bundle.sha256;
    const runtime = createRuntime();
    const response = await runtime.handler(sessionRequest(fixture.declaration));
    expect(response.status).toBe(400);
    expect(runtime.fetchImpl).not.toHaveBeenCalled();
    expect(runtime.assets.put).not.toHaveBeenCalled();
  });

  it('verifies Turnstile and the configured store identity before D1 reservation', async () => {
    const fixture = await createFixture();
    fixture.declaration.design.variantId = '999';
    const runtime = createRuntime();
    const response = await runtime.handler(sessionRequest(fixture.declaration));
    expect(response.status).toBe(400);
    expect(runtime.fetchImpl).toHaveBeenCalledOnce();
    expect(runtime.repository.createUploadPending).not.toHaveBeenCalled();
  });

  it('returns 403 when Turnstile does not verify', async () => {
    const fixture = await createFixture();
    const runtime = createRuntime({ turnstile: { success: false, action: 'production_draft' } });
    const response = await runtime.handler(sessionRequest(fixture.declaration));
    expect(response.status).toBe(403);
    expect(runtime.repository.createUploadPending).not.toHaveBeenCalled();
  });

  it('reuses only an unexpired pending session with the exact declaration', async () => {
    const fixture = await createFixture();
    const runtime = createRuntime();
    await runtime.handler(sessionRequest(fixture.declaration));
    const duplicate = await runtime.handler(sessionRequest(fixture.declaration));
    expect(duplicate.status).toBe(201);
    expect((await duplicate.json()).uploadToken).toBe(UPLOAD_TOKEN);
    expect(runtime.repository.createUploadPending).toHaveBeenCalledOnce();

    const changed = structuredClone(fixture.declaration);
    changed.bundle.sha256 = 'f'.repeat(64);
    const conflict = await runtime.handler(sessionRequest(changed));
    expect(conflict.status).toBe(409);
  });

  it('returns the final response for an already completed matching upload', async () => {
    const fixture = await createFixture();
    const runtime = createRuntime();
    await runtime.handler(sessionRequest(fixture.declaration));
    await runtime.handler(uploadRequest('manifest', fixture.manifest));
    await runtime.handler(uploadRequest('bundle', fixture.bundle));

    const duplicate = await runtime.handler(sessionRequest(fixture.declaration));
    expect(duplicate.status).toBe(201);
    expect(await duplicate.json()).not.toHaveProperty('uploadToken');
  });

  it('requires all four upload ownership values before reading R2', async () => {
    const fixture = await createFixture();
    const runtime = createRuntime();
    await runtime.handler(sessionRequest(fixture.declaration));
    const request = uploadRequest('manifest', fixture.manifest);
    request.headers.set('x-production-upload-token', 'upt_33333333-3333-4333-8333-333333333333');
    const response = await runtime.handler(request);
    expect(response.status).toBe(401);
    expect(runtime.assets.put).not.toHaveBeenCalled();
  });

  it('rejects a body whose Content-Length differs from the D1 declaration', async () => {
    const fixture = await createFixture();
    const runtime = createRuntime();
    await runtime.handler(sessionRequest(fixture.declaration));
    const request = uploadRequest('manifest', fixture.manifest);
    request.headers.set('content-length', String(fixture.manifest.size + 1));
    const response = await runtime.handler(request);
    expect(response.status).toBe(400);
    expect(runtime.assets.put).not.toHaveBeenCalled();
    expect(runtime.logger.error).toHaveBeenCalledWith(JSON.stringify({
      code: 'PRODUCTION_DRAFT_UPLOAD_LENGTH_MISMATCH',
      kind: 'manifest',
      expectedBytes: fixture.manifest.size,
      receivedBytes: fixture.manifest.size + 1,
    }));
  });

  it('requires the verified manifest object before accepting a ZIP', async () => {
    const fixture = await createFixture();
    const runtime = createRuntime();
    await runtime.handler(sessionRequest(fixture.declaration));
    const response = await runtime.handler(uploadRequest('bundle', fixture.bundle));
    expect(response.status).toBe(409);
    expect(runtime.assets.put).not.toHaveBeenCalled();
    expect(runtime.repository.finalizeCartDraft).not.toHaveBeenCalled();
  });

  it('does not finalize when R2 rejects the declared checksum', async () => {
    const fixture = await createFixture();
    const runtime = createRuntime();
    await runtime.handler(sessionRequest(fixture.declaration));
    const corrupted = new Blob(['corrupt'], { type: 'application/json' });
    const request = uploadRequest('manifest', corrupted);
    request.headers.set('content-length', String(fixture.manifest.size));
    Object.defineProperty(request.body, 'expectedLengthForTest', { value: fixture.manifest.size });
    const response = await runtime.handler(request);
    expect(response.status).toBe(503);
    expect(runtime.repository.finalizeCartDraft).not.toHaveBeenCalled();
  });

  it('exposes config only when cloud uploads and a site key are enabled', async () => {
    const runtime = createRuntime();
    const response = await runtime.handler(basicRequest('GET', '/api/production-drafts/config'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ turnstileSiteKey: 'site-key' });

    runtime.env.LOCAL_PRODUCTION_FILES = 'true';
    expect((await runtime.handler(basicRequest('GET', '/api/production-drafts/config'))).status).toBe(503);
  });

  it('uses exact paths and methods', async () => {
    const runtime = createRuntime();
    expect((await runtime.handler(basicRequest('GET', '/api/production-drafts'))).status).toBe(405);
    expect((await runtime.handler(basicRequest('POST', `/api/production-drafts/${DESIGN_ID}/manifest`))).status).toBe(405);
    expect((await runtime.handler(basicRequest('PUT', `/api/production-drafts/${DESIGN_ID}/manifest/extra`))).status).toBe(404);
  });
});

async function createFixture() {
  const manifest = new Blob([JSON.stringify({ designFingerprint: FINGERPRINT })], {
    type: 'application/json',
  });
  const bundle = new Blob(['PK production zip'], { type: 'application/zip' });
  return {
    manifest,
    bundle,
    declaration: {
      shop: SHOP,
      uploadId: UPLOAD_ID,
      turnstileToken: 'verified-token',
      design: {
        designFingerprint: FINGERPRINT,
        productId: 'fn8788-jersey',
        variantId: '48039101989015',
        size: 'xl',
        modelId: 'chelsea-jersey',
        modelVersion: '1',
        uvExportVersion: '2',
      },
      manifest: { byteLength: manifest.size, sha256: await sha256(manifest) },
      bundle: { filename: BUNDLE_FILENAME, byteLength: bundle.size, sha256: await sha256(bundle) },
    },
  };
}

function createRuntime({ turnstile = { success: true, action: 'production_draft' } } = {}) {
  let row = null;
  const stored = new Map();
  const assets = {
    put: vi.fn(async (key, stream, options) => {
      const bytes = await readStream(stream);
      if (await sha256Bytes(bytes) !== options.sha256) throw new Error('BadDigest');
      const object = {
        key,
        size: bytes.byteLength,
        customMetadata: options.customMetadata,
        httpMetadata: options.httpMetadata,
      };
      stored.set(key, object);
      return object;
    }),
    head: vi.fn(async (key) => stored.get(key) ?? null),
    get: vi.fn(),
    delete: vi.fn(),
  };
  const repository = {
    getCartDraftByUpload: vi.fn(async () => row),
    getOwnedUploadPending: vi.fn(async ({ shop, designId, uploadId, uploadToken }) => (
      row?.status === 'upload_pending'
      && row.shop === shop
      && row.designId === designId
      && row.uploadId === uploadId
      && row.uploadToken === uploadToken
        ? row
        : null
    )),
    createUploadPending: vi.fn(async (draft) => {
      row ??= { ...draft, status: 'upload_pending' };
      return row;
    }),
    finalizeCartDraft: vi.fn(async () => {
      row = { ...row, status: 'cart_draft', uploadToken: null };
      return row;
    }),
    claimOwnedUploadCleanup: vi.fn(),
    deleteClaimedDraft: vi.fn(),
  };
  const fetchImpl = vi.fn(async () => Response.json(turnstile));
  const env = {
    LOCAL_PRODUCTION_FILES: 'false',
    PRODUCTION_ASSETS: assets,
    PRODUCTION_DB: { prepare() {}, batch() {} },
    PRODUCTION_UPLOAD_RATE_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
    SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({
      [SHOP]: {
        productId: 'fn8788-jersey',
        currency: 'USD',
        jerseyVariants: { xl: '48039101989015' },
        surchargeVariants: { 18: '48046656127127' },
      },
    }),
  };
  const logger = { error: vi.fn() };
  const handler = createProductionDraftsHandler(env, {
    createProductionRepository: () => repository,
    createStoreConfigRepository: () => ({
      get: async (shop) => ({
        source: 'legacy',
        status: 'active',
        config: JSON.parse(env.SHOPIFY_STORE_CONFIG_JSON)[shop],
      }),
    }),
    createShopFingerprint: vi.fn(async () => SHOP_FINGERPRINT),
    fetchImpl,
    now: () => NOW,
    randomUUID: sequenceUuid(),
    logger,
  });
  return { assets, env, fetchImpl, handler, logger, repository };
}

function sessionRequest(declaration) {
  const serialized = JSON.stringify(declaration);
  return {
    method: 'POST',
    url: 'https://example.test/api/production-drafts',
    headers: new Headers({
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(serialized).byteLength),
      'cf-connecting-ip': '203.0.113.10',
    }),
    json: vi.fn(async () => JSON.parse(serialized)),
  };
}

function uploadRequest(kind, blob) {
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(new Uint8Array(await blob.arrayBuffer()));
      controller.close();
    },
  });
  return {
    method: 'PUT',
    url: `https://example.test/api/production-drafts/${DESIGN_ID}/${kind}`,
    headers: new Headers({
      'content-type': kind === 'manifest' ? 'application/json' : 'application/zip',
      'content-length': String(blob.size),
      'x-production-shop': SHOP,
      'x-production-upload-id': UPLOAD_ID,
      'x-production-upload-token': UPLOAD_TOKEN,
    }),
    body,
  };
}

function basicRequest(method, pathname) {
  return { method, url: `https://example.test${pathname}`, headers: new Headers() };
}

function sequenceUuid() {
  const values = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  return vi.fn(() => values.shift() ?? '33333333-3333-4333-8333-333333333333');
}

async function readStream(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(bytes);
    length += bytes.byteLength;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function sha256(blob) {
  return sha256Bytes(new Uint8Array(await blob.arrayBuffer()));
}

async function sha256Bytes(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
