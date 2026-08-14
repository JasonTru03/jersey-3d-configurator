import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import { createDecoration } from '../../src/features/configurator/config/decorations.js';
import { createDesignFingerprint } from '../../src/features/configurator/designs/productionFingerprint.js';
import { verifyQuoteContract } from './quoteContract.js';
import { createTokenVault } from './tokenVault.js';
import {
  CART_QUOTE_TTL_SECONDS,
  DESIGN_RECORD_TTL_SECONDS,
  MAX_CART_QUOTE_BODY_BYTES,
  createCartQuotesHandler,
  toMinorUnits,
} from './cartQuotes.js';

const SHOP = 'fixture-store.myshopify.com';
const OTHER_SHOP = 'other-store.myshopify.com';
const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = Date.UTC(2026, 6, 27, 4, 0, 0);
const DESIGN_ID = 'dsg_12345678-1234-4123-8123-1234567890ab';
const BUNDLE_ID = 'bun_1234567890abcdef';
const MODEL = Object.freeze({ id: 'chelsea-jersey', version: '1', uvExportVersion: '2' });
const jerseyVariants = { s: '1001', m: '1002', l: '1003', xl: '1004' };

function state(overrides = {}) {
  return { ...structuredClone(jerseyProduct.defaultState), ...overrides };
}

function storeConfig(overrides = {}) {
  return {
    productId: jerseyProduct.id,
    currency: 'USD',
    jerseyVariants,
    surchargeVariants: { 60: '2060', 20: '2020', 12: '2012', 8: '2008', 4: '2004' },
    ...overrides,
  };
}

async function fixture(overrides = {}) {
  const designState = overrides.state ?? state();
  const variantId = overrides.variantId ?? jerseyVariants[designState.layout];
  const fingerprint = await createDesignFingerprint({
    model: MODEL,
    productId: jerseyProduct.id,
    size: designState.layout,
    state: designState,
    variantId,
  });
  const atlasSha256 = 'b'.repeat(64);
  const manifest = {
    schemaVersion: 2,
    designFingerprint: fingerprint,
    productId: jerseyProduct.id,
    variantId,
    size: designState.layout,
    model: { id: MODEL.id, version: MODEL.version },
    uvExportVersion: MODEL.uvExportVersion,
    atlas: { colorSpace: 'sRGB', height: 4096, width: 4096 },
    patternPieces: { fixture: true },
    generatedAt: '2026-07-27T04:00:00.000Z',
    files: [
      ['design.json', 'application/json', 111, 'a'],
      ['uv-atlas.png', 'image/png', 222, 'b'],
      ['uv-pattern-pieces.png', 'image/png', 333, 'c'],
      ['uv-reference.pdf', 'application/pdf', 444, 'd'],
      ['preview-front.png', 'image/png', 555, 'e'],
      ['preview-back.png', 'image/png', 666, 'f'],
    ].map(([name, mediaType, byteLength, hash]) => ({
      name, mediaType, byteLength, sha256: hash.repeat(64),
    })),
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestSha256 = await sha256Hex(manifestBytes);
  const bundleSha256 = '9'.repeat(64);
  const bundleFilename = `${jerseyProduct.id}-design-${fingerprint}.zip`;
  const manifestKey = `shops/shop_fixture/designs/${DESIGN_ID}/manifest.json`;
  const bundleKey = `shops/shop_fixture/designs/${DESIGN_ID}/${bundleFilename}`;
  const draft = {
    designId: DESIGN_ID,
    shop: SHOP,
    uploadId: 'upl_1234567890abcdef',
    bundleId: null,
    status: 'cart_draft',
    productId: jerseyProduct.id,
    variantId,
    size: designState.layout,
    modelId: MODEL.id,
    modelVersion: MODEL.version,
    uvExportVersion: MODEL.uvExportVersion,
    designFingerprint: fingerprint,
    manifestSha256,
    manifestKey,
    bundleKey,
    bundleFilename,
    createdAt: NOW - 60_000,
    expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    paidAt: null,
    shopifyOrderGid: null,
    shopifyOrderName: null,
    errorCode: null,
    cleanupToken: null,
    cleanupStartedAt: null,
    uploadToken: null,
    updatedAt: NOW - 60_000,
    ...overrides.draft,
  };
  const common = {
    designFingerprint: fingerprint,
    productId: jerseyProduct.id,
    variantId,
    size: designState.layout,
  };
  const manifestHead = r2Head({
    key: manifestKey,
    size: manifestBytes.byteLength,
    contentType: 'application/json',
    customMetadata: { ...common, sha256: manifestSha256 },
  });
  const bundleHead = r2Head({
    key: bundleKey,
    size: 4096,
    contentType: 'application/zip',
    customMetadata: {
      ...common,
      contentLength: '4096',
      sha256: bundleSha256,
    },
    sha256: bundleSha256,
  });
  const objects = new Map([
    [manifestKey, { head: manifestHead, bytes: manifestBytes }],
    [bundleKey, { head: bundleHead, bytes: new Uint8Array(4096) }],
  ]);
  return { atlasSha256, bundleSha256, designState, draft, manifest, manifestBytes, objects };
}

function r2Head({ key, size, contentType, customMetadata, sha256 }) {
  return {
    key,
    size,
    httpMetadata: { contentType },
    customMetadata,
    checksums: sha256 ? { sha256: hexToArrayBuffer(sha256) } : {},
  };
}

function workerdLazyHead(head, getters) {
  return lazyAccessorObject({
    key: head.key,
    size: head.size,
    httpMetadata: lazyAccessorObject({ contentType: head.httpMetadata.contentType }, getters),
    customMetadata: lazyAccessorObject({ ...head.customMetadata }, getters),
    checksums: lazyAccessorObject({ ...head.checksums }, getters),
  }, getters);
}

function lazyAccessorObject(values, getters) {
  const object = {};
  for (const [key, value] of Object.entries(values)) {
    const getter = vi.fn(() => value);
    getters.push(getter);
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: true,
      get: getter,
    });
  }
  return object;
}

function runtime(current, overrides = {}) {
  const records = new Map();
  const events = [];
  let authoritative = structuredClone(current.draft);
  const repository = {
    getDesign: vi.fn(async (shop, designId) => (
      shop === authoritative.shop && designId === authoritative.designId
        ? structuredClone(authoritative)
        : null
    )),
    bindCartQuote: vi.fn(async ({ shop, designId, bundleId, updatedAt }) => {
      events.push('bind');
      if (shop !== authoritative.shop || designId !== authoritative.designId) throw new Error('conflict');
      if (authoritative.bundleId === null) {
        authoritative = { ...authoritative, bundleId, updatedAt };
      }
      return structuredClone(authoritative);
    }),
  };
  const assets = {
    head: vi.fn(async (key) => current.objects.get(key)?.head ?? null),
    get: vi.fn(async (key) => {
      const object = current.objects.get(key);
      if (!object) return null;
      return {
        ...object.head,
        arrayBuffer: vi.fn(async () => object.bytes.slice().buffer),
      };
    }),
  };
  const env = {
    DESIGN_QUOTES: {
      put: vi.fn(async (key, value, options) => {
        events.push('kv');
        records.set(key, { value, options });
      }),
    },
    PRODUCTION_ASSETS: assets,
    PRODUCTION_DB: { prepare: vi.fn(), batch: vi.fn() },
    CART_QUOTE_RATE_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
    CART_QUOTE_SIGNING_SECRET: SECRET,
    SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({ [SHOP]: storeConfig() }),
    ...overrides.env,
  };
  Object.assign(repository, overrides.repository);
  Object.assign(assets, overrides.assets);
  const dependencies = {
    createProductionRepository: vi.fn(() => repository),
    createStoreConfigRepository: vi.fn(() => ({
      get: vi.fn(async (shop) => ({
        source: 'legacy',
        status: 'active',
        config: JSON.parse(env.SHOPIFY_STORE_CONFIG_JSON)[shop],
      })),
    })),
    now: () => NOW,
    randomBytes: () => new Uint8Array(24).fill(7),
    ...overrides.dependencies,
  };
  return {
    assets,
    dependencies,
    env,
    events,
    getAuthoritative: () => authoritative,
    records,
    repository,
  };
}

function post(body, init = {}) {
  return new Request('https://worker.example/api/cart-quotes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'CF-Connecting-IP': '203.0.113.42',
      ...init.headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function validBody(current, overrides = {}) {
  return { shop: SHOP, designId: DESIGN_ID, state: current.designState, ...overrides };
}

describe('createCartQuotesHandler', () => {
  it('uses the active database config and its shop-bound signing secret', async () => {
    const current = await fixture();
    const app = runtime(current);
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    const signingSecret = 'database-shop-signing-secret-1234567890';
    const encryptedSigningSecret = await createTokenVault(key, {
      purpose: 'shopify-function-signing-secret',
    }).encrypt(SHOP, signingSecret);
    app.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = key;
    app.dependencies.createTokenVault = createTokenVault;
    app.dependencies.createStoreConfigRepository = vi.fn(() => ({
      get: vi.fn(async () => ({
        source: 'database',
        status: 'active',
        config: storeConfig(),
        encryptedSigningSecret,
      })),
    }));

    const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)));
    const payload = await response.json();
    const record = JSON.parse(app.records.get(DESIGN_ID).value);
    const token = new URL(payload.handoffUrl).searchParams.get('token');

    expect(response.status).toBe(201);
    await expect(verifyQuoteContract(token, record.components, signingSecret, {
      expectedShopFingerprint: record.shopFingerprint,
      now: NOW,
    })).resolves.toMatchObject({ designId: DESIGN_ID });
    await expect(verifyQuoteContract(token, record.components, SECRET, {
      expectedShopFingerprint: record.shopFingerprint,
      now: NOW,
    })).rejects.toThrow();
  });

  it('re-prices one authoritative cloud draft, verifies private files, binds D1, then stores a signed quote', async () => {
    const complexState = state({
      layout: 'xl',
      material: 'player',
      lighting: 'name-number',
      extras: { sleeveBadge: true, giftBox: false, matchPatch: true },
      overrides: {
        ...state().overrides,
        customTextItems: [{ text: 'CAPTAIN' }],
        decorations: [createDecoration({
          id: 'crest-1', kind: 'preset', source: 'crest-badge', label: 'Crest Badge', region: 'front',
        })],
      },
    });
    const current = await fixture({ state: complexState });
    const app = runtime(current);
    const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      designId: DESIGN_ID,
      bundleId: expect.stringMatching(/^bun_[A-Za-z0-9_-]{32}$/u),
      expiresAt: NOW + CART_QUOTE_TTL_SECONDS * 1000,
    });
    expect(app.assets.head.mock.calls.map(([key]) => key)).toEqual([
      current.draft.manifestKey,
      current.draft.bundleKey,
    ]);
    expect(app.assets.get).toHaveBeenCalledWith(current.draft.manifestKey);
    expect(app.events).toEqual(['bind', 'kv']);
    const stored = app.records.get(DESIGN_ID);
    expect(stored.options).toEqual({ expirationTtl: DESIGN_RECORD_TTL_SECONDS });
    const record = JSON.parse(stored.value);
    expect(record).toMatchObject({
      designId: DESIGN_ID,
      bundleId: payload.bundleId,
      shop: SHOP,
      issuedAt: NOW,
      expiresAt: NOW + CART_QUOTE_TTL_SECONDS * 1000,
      productionFiles: {
        bundleFilename: current.draft.bundleFilename,
        designFilename: 'design.json',
        atlasFilename: 'uv-atlas.png',
        atlasSha256: `sha256:${current.atlasSha256}`,
      },
      summary: {
        'Production Files': 'Cloud package ready',
        'Bundle File': current.draft.bundleFilename,
        'Design File': 'design.json',
        'Atlas File': 'uv-atlas.png',
        'UV Atlas SHA-256': `sha256:${current.atlasSha256}`,
      },
    });
    expect(stored.value).not.toContain(current.draft.manifestKey);
    expect(stored.value).not.toContain(current.draft.bundleKey);
    const token = new URL(payload.handoffUrl).searchParams.get('token');
    await expect(verifyQuoteContract(token, record.components, SECRET, {
      expectedShopFingerprint: record.shopFingerprint,
      now: NOW,
    })).resolves.toMatchObject({ designId: DESIGN_ID, bundleId: payload.bundleId });
  });

  it('accepts exactly shop, designId and state and rejects caller filenames, hashes, totals or extra fields before D1', async () => {
    const current = await fixture();
    for (const extra of [
      { productionFiles: null },
      { bundleFilename: current.draft.bundleFilename },
      { atlasSha256: `sha256:${current.atlasSha256}` },
      { quote: { total: 1 } },
      { total: 1 },
    ]) {
      const app = runtime(current);
      const response = await createCartQuotesHandler(app.env, app.dependencies)(
        post({ ...validBody(current), ...extra }),
      );
      expect(response.status).toBe(400);
      expect(app.repository.getDesign).not.toHaveBeenCalled();
      expect(app.env.DESIGN_QUOTES.put).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['missing draft', null],
    ['upload pending', { status: 'upload_pending' }],
    ['cleanup pending', { status: 'cleanup_pending' }],
    ['paid', { status: 'paid_pending_production', bundleId: BUNDLE_ID }],
    ['expired', { expiresAt: NOW }],
  ])('rejects an unavailable %s without reading R2 or writing KV', async (_label, draftOverride) => {
    const current = await fixture({ draft: draftOverride ?? {} });
    const app = runtime(current, draftOverride === null ? {
      repository: { getDesign: vi.fn(async () => null) },
    } : {});
    const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)));
    expect(response.status).toBe(400);
    expect(app.assets.head).not.toHaveBeenCalled();
    expect(app.env.DESIGN_QUOTES.put).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the normalized shop and does not expose another shop draft', async () => {
    const current = await fixture();
    const app = runtime(current);
    const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current, {
      shop: OTHER_SHOP,
    })));
    expect(response.status).toBe(503);
    expect(app.repository.getDesign).not.toHaveBeenCalled();
  });

  it('compares the draft against normalized trusted store variant IDs', async () => {
    const current = await fixture();
    const numericVariants = { ...jerseyVariants, m: 1002 };
    const app = runtime(current, {
      env: {
        SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({
          [SHOP]: storeConfig({ jerseyVariants: numericVariants }),
        }),
      },
    });
    expect((await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)))).status)
      .toBe(201);
  });

  it.each([
    ['stored product', { productId: 'other-product' }, {}],
    ['stored size', { size: 'xl' }, {}],
    ['stored variant', { variantId: '1004' }, {}],
    ['changed state', {}, { state: state({ material: 'player' }) }],
  ])('rejects a mismatched %s before binding or KV', async (_label, draft, body) => {
    const current = await fixture({ draft });
    const app = runtime(current);
    const response = await createCartQuotesHandler(app.env, app.dependencies)(
      post(validBody(current, body)),
    );
    expect(response.status).toBe(400);
    expect(app.repository.bindCartQuote).not.toHaveBeenCalled();
    expect(app.env.DESIGN_QUOTES.put).not.toHaveBeenCalled();
  });

  it.each([
    ['missing manifest', (current) => current.objects.delete(current.draft.manifestKey)],
    ['missing bundle', (current) => current.objects.delete(current.draft.bundleKey)],
    ['manifest key', (current) => { current.objects.get(current.draft.manifestKey).head.key = 'private/other'; }],
    ['manifest size', (current) => { current.objects.get(current.draft.manifestKey).head.size += 1; }],
    ['manifest media type', (current) => { current.objects.get(current.draft.manifestKey).head.httpMetadata.contentType = 'text/plain'; }],
    ['manifest metadata hash', (current) => { current.objects.get(current.draft.manifestKey).head.customMetadata.sha256 = '0'.repeat(64); }],
    ['bundle media type', (current) => { current.objects.get(current.draft.bundleKey).head.httpMetadata.contentType = 'text/plain'; }],
    ['bundle length metadata', (current) => { current.objects.get(current.draft.bundleKey).head.customMetadata.contentLength = '1'; }],
    ['bundle fingerprint', (current) => { current.objects.get(current.draft.bundleKey).head.customMetadata.designFingerprint = 'deadbeef'; }],
    ['bundle hash', (current) => { current.objects.get(current.draft.bundleKey).head.customMetadata.sha256 = 'bad'; }],
  ])('fails closed for invalid private R2 %s', async (_label, mutate) => {
    const current = await fixture();
    mutate(current);
    const app = runtime(current);
    const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)));
    expect(response.status).toBe(503);
    expect(app.repository.bindCartQuote).not.toHaveBeenCalled();
    expect(app.env.DESIGN_QUOTES.put).not.toHaveBeenCalled();
  });

  it.each([
    ['actual manifest hash', async (current) => { current.objects.get(current.draft.manifestKey).bytes[0] ^= 1; }],
    ['manifest identity', async (current) => {
      current.manifest.productId = 'other-product';
      await replaceManifest(current);
    }],
    ['atlas hash', async (current) => {
      current.manifest.files[1].sha256 = 'short';
      await replaceManifest(current);
    }],
  ])('fails closed for invalid %s without leaking an R2 key', async (_label, mutate) => {
    const current = await fixture();
    await mutate(current);
    const logger = { error: vi.fn() };
    const app = runtime(current, { dependencies: { logger } });
    const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('shops/');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('shops/');
  });

  it('accepts workerd-shaped lazy accessors for required R2 metadata', async () => {
    const current = await fixture();
    const getters = [];
    for (const object of current.objects.values()) {
      object.head = workerdLazyHead(object.head, getters);
    }
    const app = runtime(current);
    const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)));
    expect(response.status).toBe(201);
    expect(getters.length).toBeGreaterThan(0);
    expect(getters.every((getter) => getter.mock.calls.length > 0)).toBe(true);
  });

  it('maps a throwing R2 lazy accessor to a stable 503 without leaking details', async () => {
    const current = await fixture();
    const getter = vi.fn(() => {
      throw new Error(`R2 secret at ${current.draft.manifestKey}`);
    });
    Object.defineProperty(current.objects.get(current.draft.manifestKey).head, 'key', {
      configurable: true,
      enumerable: true,
      get: getter,
    });
    const logger = { error: vi.fn() };
    const app = runtime(current, { dependencies: { logger } });
    const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Secure cart service is temporarily unavailable.' });
    expect(getter).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/secret|shops\//u);
  });

  it('accepts the native R2ObjectBody prototype arrayBuffer method without trusting accessors', async () => {
    const current = await fixture();
    const object = current.objects.get(current.draft.manifestKey);
    const prototype = {
      arrayBuffer: async function arrayBuffer() {
        return object.bytes.slice().buffer;
      },
    };
    const app = runtime(current, {
      assets: {
        get: vi.fn(async () => Object.assign(Object.create(prototype), object.head)),
      },
    });
    expect((await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)))).status)
      .toBe(201);
  });

  it('binds D1 before KV and a KV failure retry reuses the first bundle and issued timestamp', async () => {
    const current = await fixture();
    let putCount = 0;
    const app = runtime(current, {
      env: { DESIGN_QUOTES: { put: vi.fn(async () => {
        app.events.push('kv');
        putCount += 1;
        if (putCount === 1) throw new Error('KV unavailable');
      }) } },
      dependencies: {
        now: (() => {
          const times = [NOW, NOW + 5_000];
          return () => times.shift();
        })(),
        randomBytes: (() => {
          let byte = 0;
          return () => new Uint8Array(24).fill(byte += 1);
        })(),
      },
    });
    const handler = createCartQuotesHandler(app.env, app.dependencies);
    const first = await handler(post(validBody(current)));
    const second = await handler(post(validBody(current)));
    const payload = await second.json();
    expect(first.status).toBe(503);
    expect(second.status).toBe(201);
    expect(payload.bundleId).toBe(app.getAuthoritative().bundleId);
    expect(payload.expiresAt).toBe(NOW + CART_QUOTE_TTL_SECONDS * 1000);
    expect(app.events).toEqual(['bind', 'kv', 'bind', 'kv']);
  });

  it('recovers an authoritative racing bundle after a bind conflict', async () => {
    const current = await fixture();
    const bound = { ...current.draft, bundleId: BUNDLE_ID, updatedAt: NOW - 1_000 };
    const getDesign = vi.fn()
      .mockResolvedValueOnce(structuredClone(current.draft))
      .mockResolvedValueOnce(structuredClone(bound));
    const app = runtime(current, {
      repository: {
        getDesign,
        bindCartQuote: vi.fn(async () => { throw new Error('race'); }),
      },
    });
    const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      bundleId: BUNDLE_ID,
      expiresAt: bound.updatedAt + CART_QUOTE_TTL_SECONDS * 1000,
    });
  });

  it('makes concurrent different random candidates converge on one bundle, token and KV record', async () => {
    const current = await fixture();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const proposals = [];
    const app = runtime(current, {
      repository: {
        bindCartQuote: vi.fn(async ({ bundleId }) => {
          proposals.push(bundleId);
          if (proposals.length === 2) release();
          await gate;
          return { ...current.draft, bundleId: proposals[0], updatedAt: NOW };
        }),
      },
      dependencies: {
        randomBytes: (() => {
          let byte = 0;
          return () => new Uint8Array(24).fill(byte += 1);
        })(),
      },
    });
    const stored = [];
    app.env.DESIGN_QUOTES.put = vi.fn(async (_key, value) => stored.push(value));
    const handler = createCartQuotesHandler(app.env, app.dependencies);
    const responses = await Promise.all([
      handler(post(validBody(current))),
      handler(post(validBody(current))),
    ]);
    const payloads = await Promise.all(responses.map((response) => response.json()));
    expect(responses.map(({ status }) => status)).toEqual([201, 201]);
    expect(new Set(payloads.map(({ bundleId }) => bundleId))).toHaveProperty('size', 1);
    expect(new Set(payloads.map(({ handoffUrl }) => handoffUrl))).toHaveProperty('size', 1);
    expect(new Set(stored)).toHaveProperty('size', 1);
  });

  it('maps malformed requests to 400 and D1, R2, signing, KV or binding failures to one stable 503', async () => {
    const current = await fixture();
    const malformed = runtime(current);
    expect((await createCartQuotesHandler(malformed.env, malformed.dependencies)(post('[]'))).status).toBe(400);
    expect((await createCartQuotesHandler(malformed.env, malformed.dependencies)(
      post(validBody(current), { headers: { 'content-length': String(MAX_CART_QUOTE_BODY_BYTES + 1) } }),
    )).status).toBe(400);

    const cases = [
      { repository: { getDesign: vi.fn(async () => { throw new Error('D1 secret'); }) } },
      { assets: { head: vi.fn(async () => { throw new Error('R2 secret'); }) } },
      { repository: { bindCartQuote: vi.fn(async () => { throw new Error('D1 bind secret'); }), getDesign: vi.fn(async () => current.draft) } },
      { env: { DESIGN_QUOTES: { put: vi.fn(async () => { throw new Error('KV secret'); }) } } },
      { dependencies: { randomBytes: () => { throw new Error('random secret'); } } },
    ];
    for (const override of cases) {
      const logger = { error: vi.fn() };
      const app = runtime(current, { ...override, dependencies: { ...override.dependencies, logger } });
      const response = await createCartQuotesHandler(app.env, app.dependencies)(post(validBody(current)));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Secure cart service is temporarily unavailable.' });
      expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/secret|shops\//u);
    }
  });

  it('enforces method and rate limits before body, D1 and R2 access', async () => {
    const current = await fixture();
    const app = runtime(current, {
      env: { CART_QUOTE_RATE_LIMIT: { limit: vi.fn(async () => ({ success: false })) } },
    });
    const handler = createCartQuotesHandler(app.env, app.dependencies);
    const get = await handler(new Request('https://worker.example/api/cart-quotes'));
    expect(get.status).toBe(405);
    const response = await handler(post(validBody(current)));
    expect(response.status).toBe(429);
    expect(app.repository.getDesign).not.toHaveBeenCalled();
    expect(app.assets.head).not.toHaveBeenCalled();
  });
});

describe('toMinorUnits', () => {
  it('converts exact USD decimal values and rejects unsafe or over-precise amounts', () => {
    expect(toMinorUnits(0, 'USD')).toBe(0);
    expect(toMinorUnits(89.25, 'USD')).toBe(8925);
    expect(() => toMinorUnits(1.001, 'USD')).toThrow();
    expect(() => toMinorUnits(0.1 + 0.2, 'USD')).toThrow();
    expect(() => toMinorUnits(Number.MAX_SAFE_INTEGER, 'USD')).toThrow();
    expect(() => toMinorUnits(-1, 'USD')).toThrow();
    expect(() => toMinorUnits(1, 'EUR')).toThrow();
  });
});

describe('wrangler public gateway configuration', () => {
  it('keeps workers.dev as a stateless HTTPS gateway to Tencent', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(config.name).toBe('jersey-3d-configurator');
    expect(config.main).toBe('workers/tencentTunnelGateway.js');
    expect(config.workers_dev).toBe(true);
    expect(config.vars).toEqual({ TENCENT_ORIGIN: 'http://139.199.202.173:8080' });
    expect(config).not.toHaveProperty('kv_namespaces');
    expect(config).not.toHaveProperty('r2_buckets');
    expect(config).not.toHaveProperty('d1_databases');
    expect(config.vars).not.toHaveProperty('CART_QUOTE_SIGNING_SECRET');
    expect(config.vars).not.toHaveProperty('TURNSTILE_SITE_KEY');
    expect(config.vars).not.toHaveProperty('TURNSTILE_SECRET_KEY');
    expect(config.vars).not.toHaveProperty('SHOPIFY_API_SECRET');
  });
});

async function replaceManifest(current) {
  const bytes = new TextEncoder().encode(JSON.stringify(current.manifest));
  const sha256 = await sha256Hex(bytes);
  current.objects.get(current.draft.manifestKey).bytes = bytes;
  const head = current.objects.get(current.draft.manifestKey).head;
  head.size = bytes.byteLength;
  head.customMetadata.sha256 = sha256;
  current.draft.manifestSha256 = sha256;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToArrayBuffer(value) {
  return Uint8Array.from(value.match(/../gu), (byte) => Number.parseInt(byte, 16)).buffer;
}
