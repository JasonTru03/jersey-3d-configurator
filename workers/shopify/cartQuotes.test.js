import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import { createDecoration } from '../../src/features/configurator/config/decorations.js';
import { verifyQuoteContract } from './quoteContract.js';
import {
  CART_QUOTE_TTL_SECONDS,
  DESIGN_RECORD_TTL_SECONDS,
  createCartQuotesHandler,
  toMinorUnits,
} from './cartQuotes.js';

const SHOP = 'fixture-store.myshopify.com';
const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = Date.UTC(2026, 6, 27, 4, 0, 0);
const jerseyVariants = { s: '1001', m: '1002', l: '1003', xl: '1004' };

function state(overrides = {}) {
  return {
    ...structuredClone(jerseyProduct.defaultState),
    ...overrides,
  };
}

function storeConfig(overrides = {}) {
  return {
    currency: 'USD',
    jerseyVariants,
    surchargeVariants: { 60: '2060', 20: '2020', 12: '2012', 8: '2008', 4: '2004' },
    ...overrides,
  };
}

function runtime(overrides = {}) {
  const records = new Map();
  const limits = new Map();
  const env = {
    DESIGN_QUOTES: {
      put: vi.fn(async (key, value, options) => records.set(key, { value, options })),
    },
    CART_QUOTE_RATE_LIMIT: {
      limit: vi.fn(async ({ key }) => {
        const count = limits.get(key) ?? 0;
        if (count >= 10) return { success: false };
        limits.set(key, count + 1);
        return { success: true };
      }),
    },
    CART_QUOTE_SIGNING_SECRET: SECRET,
    SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({ [SHOP]: storeConfig() }),
    ...overrides,
  };
  return { env, records, limits };
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

function validBody(overrides = {}) {
  return { shop: SHOP, state: state(), productionFiles: null, ...overrides };
}

async function json(response) {
  return response.json();
}

describe('createCartQuotesHandler', () => {
  it('re-prices a complex design, persists it, then returns a signed same-shop handoff URL', async () => {
    const { env, records } = runtime();
    const complexState = state({
      layout: 'xl',
      material: 'player',
      lighting: 'name-number',
      extras: { sleeveBadge: true, giftBox: false, matchPatch: true },
      overrides: {
        ...state().overrides,
        customTextItems: [{ text: 'CAPTAIN' }, { text: '  ' }],
        bottomPattern: { enabled: true },
        decorations: [
          createDecoration({
            id: 'crest-1', kind: 'preset', source: 'crest-badge', label: 'Crest Badge', region: 'front',
          }),
          createDecoration({
            id: 'upload-1', kind: 'upload', source: 'data:image/png;base64,SECRET', label: 'custom-logo.png', region: 'front',
          }),
        ],
      },
    });
    const bytes = [new Uint8Array(24).fill(1), new Uint8Array(24).fill(2)];
    const handler = createCartQuotesHandler(env, {
      now: () => NOW,
      randomBytes: () => bytes.shift(),
    });

    const response = await handler(post(validBody({
      shop: SHOP.toUpperCase(),
      state: complexState,
      productionFiles: {
        bundleFilename: 'fn8788-jersey-production.zip',
        designFilename: 'fn8788-jersey-design.json',
        atlasFilename: 'fn8788-jersey-uv-atlas.png',
        atlasSha256: `sha256:${'a'.repeat(64)}`,
      },
    })));
    const payload = await json(response);

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      bundleId: expect.stringMatching(/^bun_[A-Za-z0-9_-]{32}$/),
      designId: expect.stringMatching(/^dsg_[A-Za-z0-9_-]{32}$/),
      expiresAt: NOW + CART_QUOTE_TTL_SECONDS * 1000,
    });
    expect(Object.keys(payload).sort()).toEqual(['bundleId', 'designId', 'expiresAt', 'handoffUrl']);
    const url = new URL(payload.handoffUrl);
    expect(url.origin).toBe(`https://${SHOP}`);
    expect(url.pathname).toBe('/apps/jersey-configurator/cart-handoff');

    const stored = records.get(payload.designId);
    expect(stored.options).toEqual({ expirationTtl: DESIGN_RECORD_TTL_SECONDS });
    const record = JSON.parse(stored.value);
    expect(record).toMatchObject({
      version: 1,
      designId: payload.designId,
      bundleId: payload.bundleId,
      shop: SHOP,
      issuedAt: NOW,
      expiresAt: NOW + CART_QUOTE_TTL_SECONDS * 1000,
      components: [
        { role: 'base', variantId: '1004', quantity: 1 },
        { role: 'surcharge', variantId: '2060', quantity: 1 },
        { role: 'surcharge', variantId: '2012', quantity: 1 },
      ],
      quote: { total: 165, currency: 'USD' },
      normalizedState: { layout: 'xl', material: 'player' },
      productionFiles: {
        bundleFilename: 'fn8788-jersey-production.zip',
        designFilename: 'fn8788-jersey-design.json',
        atlasFilename: 'fn8788-jersey-uv-atlas.png',
      },
    });
    expect(record.summary).toMatchObject({
      Size: 'xl',
      Template: 'solid',
      Colors: expect.any(String),
      Print: 'PLAYER #16',
      'Custom Text': 'CAPTAIN',
      Extras: 'sleeveBadge, matchPatch',
      Artwork: 'Crest Badge, custom-logo.png',
      'Production Files': 'Local ZIP download',
      'Bundle File': 'fn8788-jersey-production.zip',
      'Design File': 'fn8788-jersey-design.json',
      'Atlas File': 'fn8788-jersey-uv-atlas.png',
      'UV Atlas SHA-256': `sha256:${'a'.repeat(64)}`,
    });
    expect(stored.value).not.toContain('data:image');
    expect(record.shopFingerprint).toMatch(/^shop_[A-Za-z0-9_-]{12}$/);
    await expect(verifyQuoteContract(url.searchParams.get('token'), record.components, SECRET, {
      expectedShopFingerprint: record.shopFingerprint,
      now: NOW,
    })).resolves.toMatchObject({ totalMinor: 16500, currency: 'USD' });
  });

  it('does not resolve a successful response before durable storage completes', async () => {
    let release;
    const pendingPut = new Promise((resolve) => { release = resolve; });
    const { env } = runtime({ DESIGN_QUOTES: { put: vi.fn(() => pendingPut) } });
    const handler = createCartQuotesHandler(env, {
      now: () => NOW,
      randomBytes: () => new Uint8Array(24).fill(3),
    });
    let settled = false;
    const responsePromise = handler(post(validBody())).then((response) => {
      settled = true;
      return response;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await responsePromise).status).toBe(201);
  });

  it('rejects browser quote/total fields and never stores raw request or secrets', async () => {
    for (const extra of [{ quote: { total: 1 } }, { total: 1 }]) {
      const { env } = runtime();
      const response = await createCartQuotesHandler(env)(post({ ...validBody(), ...extra }));
      expect(response.status).toBe(400);
      expect(env.DESIGN_QUOTES.put).not.toHaveBeenCalled();
    }

    const { env, records } = runtime();
    const response = await createCartQuotesHandler(env, {
      now: () => NOW,
      randomBytes: () => new Uint8Array(24).fill(4),
    })(post(validBody()));
    const payload = await json(response);
    const serialized = records.get(payload.designId).value;
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('CF-Connecting-IP');
    expect(JSON.parse(serialized)).not.toHaveProperty('rawRequest');
  });

  it('maps malformed input to 400 and store configuration gaps to 503', async () => {
    const cases = [
      [validBody({ shop: 'https://fixture-store.myshopify.com' }), 400],
      [validBody({ shop: 'unknown.myshopify.com' }), 503],
      [validBody({ state: state({ material: 'unknown-billable-option' }) }), 400],
    ];
    for (const [body, status] of cases) {
      const { env } = runtime();
      expect((await createCartQuotesHandler(env)(post(body))).status).toBe(status);
    }

    const { env } = runtime({
      SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({
        [SHOP]: storeConfig({ surchargeVariants: { 10: '2010' } }),
      }),
    });
    const response = await createCartQuotesHandler(env)(post(validBody({
      state: state({ lighting: 'name-number' }),
    })));
    expect(response.status).toBe(503);
  });

  it('rate-limits before reading the body and before parsing store configuration', async () => {
    let pulls = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(validBody())));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const { env } = runtime({
      CART_QUOTE_RATE_LIMIT: { limit: vi.fn(async () => ({ success: false })) },
      SHOPIFY_STORE_CONFIG_JSON: '{broken',
    });
    const request = {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        'CF-Connecting-IP': '203.0.113.42',
      }),
      body: stream,
    };

    expect((await createCartQuotesHandler(env)(request)).status).toBe(429);
    expect(pulls).toBe(0);
  });

  it('applies the atomic binding decision to repeated unknown-shop requests', async () => {
    const { env } = runtime();
    const handler = createCartQuotesHandler(env, { now: () => NOW });
    const statuses = [];
    for (let index = 0; index < 11; index += 1) {
      statuses.push((await handler(post(validBody({ shop: 'unknown.myshopify.com' })))).status);
    }
    expect(statuses).toEqual([...Array(10).fill(503), 429]);
    expect(env.CART_QUOTE_RATE_LIMIT.limit).toHaveBeenCalledTimes(11);
  });

  it('maps malformed fulfillment summary fields to 400 without storing a record', async () => {
    const { env } = runtime();
    const invalid = state({
      overrides: {
        ...state().overrides,
        appearance: { template: 'forged-template', colors: {} },
      },
    });
    const response = await createCartQuotesHandler(env)(post(validBody({ state: invalid })));
    expect(response.status).toBe(400);
    expect(env.DESIGN_QUOTES.put).not.toHaveBeenCalled();
  });

  it('enforces method, media type, JSON syntax, object shape, and body byte limits', async () => {
    const { env } = runtime();
    const handler = createCartQuotesHandler(env);
    const getResponse = await handler(new Request('https://worker.example/api/cart-quotes'));
    expect(getResponse.status).toBe(405);
    expect(getResponse.headers.get('allow')).toBe('POST');
    expect(env.CART_QUOTE_RATE_LIMIT.limit).not.toHaveBeenCalled();
    expect((await handler(post(validBody(), { headers: { 'content-type': 'text/plain' } }))).status).toBe(400);
    expect((await handler(post('{broken'))).status).toBe(400);
    expect((await handler(post('[]'))).status).toBe(400);
    expect((await handler(post(validBody(), { headers: { 'content-length': '256001' } }))).status).toBe(400);
    expect((await handler(post(validBody(), { headers: { 'content-length': 'garbage' } }))).status).toBe(400);
    expect((await handler(post(' '.repeat(256001), { headers: { 'content-length': '1' } }))).status).toBe(400);
  });

  it('accepts an absent Content-Length and exactly 256000 UTF-8 bytes', async () => {
    const { env } = runtime();
    const base = JSON.stringify(validBody());
    const paddingLength = 256000 - new TextEncoder().encode(base).length;
    const paddedState = validBody();
    paddedState.state.padding = 'x'.repeat(paddingLength - 13);
    const serialized = JSON.stringify(paddedState);
    expect(new TextEncoder().encode(serialized)).toHaveLength(256000);
    const request = post(serialized);
    request.headers.delete('content-length');
    expect((await createCartQuotesHandler(env)(request)).status).toBe(201);
  });

  it('validates nullable production file references exactly', async () => {
    const valid = {
      bundleFilename: 'fn8788-jersey-production.zip',
      designFilename: 'fn8788-jersey-design.json',
      atlasFilename: 'fn8788-jersey-uv-atlas.png',
      atlasSha256: `sha256:${'F'.repeat(64)}`,
    };
    for (const productionFiles of [null, valid]) {
      const { env } = runtime();
      expect((await createCartQuotesHandler(env)(post(validBody({ productionFiles })))).status).toBe(201);
    }
    for (const productionFiles of [
      { ...valid, bundleFilename: '../bundle.zip' },
      { ...valid, designFilename: 'dir/design.json' },
      { ...valid, atlasFilename: '..\\atlas.png' },
      { ...valid, extra: 'field' },
      { ...valid, bundleFilename: 'wrong-production.zip' },
      { ...valid, designFilename: 'fn8788-jersey-design.txt' },
      { ...valid, atlasFilename: 'fn8788-jersey-atlas.png' },
      { ...valid, atlasSha256: 'sha256:abc123' },
    ]) {
      const { env } = runtime();
      expect((await createCartQuotesHandler(env)(post(validBody({ productionFiles })))).status).toBe(400);
    }

    const { env, records } = runtime();
    const response = await createCartQuotesHandler(env, {
      now: () => NOW,
      randomBytes: () => new Uint8Array(24).fill(7),
    })(post(validBody({ productionFiles: valid })));
    const payload = await json(response);
    expect(JSON.parse(records.get(payload.designId).value).productionFiles.atlasSha256)
      .toBe(`sha256:${'f'.repeat(64)}`);
  });

  it('uses one external 503 message and logs only stable internal error codes', async () => {
    const logger = { error: vi.fn() };
    for (const missing of [
      'DESIGN_QUOTES',
      'CART_QUOTE_RATE_LIMIT',
      'CART_QUOTE_SIGNING_SECRET',
      'SHOPIFY_STORE_CONFIG_JSON',
    ]) {
      const { env } = runtime();
      delete env[missing];
      const response = await createCartQuotesHandler(env, { logger })(post(validBody()));
      expect(response.status).toBe(503);
      expect(await json(response)).toEqual({
        error: 'Secure cart service is temporarily unavailable.',
      });
    }
    for (const config of ['{broken', '[]', JSON.stringify({ [SHOP.toUpperCase()]: storeConfig() })]) {
      const { env } = runtime({ SHOPIFY_STORE_CONFIG_JSON: config });
      expect((await createCartQuotesHandler(env, { logger })(post(validBody()))).status).toBe(503);
    }
    const { env } = runtime({ CART_QUOTE_SIGNING_SECRET: 'too-short' });
    expect((await createCartQuotesHandler(env, { logger })(post(validBody()))).status).toBe(503);
    expect(logger.error).toHaveBeenCalled();
    for (const [code] of logger.error.mock.calls) {
      expect(code).toMatch(/^CART_QUOTE_[A-Z0-9_]+$/);
      expect(code).not.toMatch(/fixture-store|203\.0\.113|012345|\{|\}/u);
    }
  });

  it('returns 503 for rate-limit and design storage failures', async () => {
    for (const override of [
      { CART_QUOTE_RATE_LIMIT: { limit: vi.fn(async () => { throw new Error('limit failed'); }) } },
      { DESIGN_QUOTES: { put: vi.fn(async () => { throw new Error('storage failed'); }) } },
    ]) {
      const { env } = runtime(override);
      const response = await createCartQuotesHandler(env)(post(validBody()));
      expect(response.status).toBe(503);
      const payload = await json(response);
      expect(JSON.stringify(payload)).not.toMatch(/limit failed|storage failed/);
    }
  });

  it('allows ten requests per UTC minute, rejects the eleventh, and hashes the client IP in rate keys', async () => {
    const { env } = runtime();
    const handler = createCartQuotesHandler(env, {
      now: () => NOW,
      randomBytes: () => crypto.getRandomValues(new Uint8Array(24)),
    });
    for (let index = 0; index < 10; index += 1) {
      expect((await handler(post(validBody()))).status).toBe(201);
    }
    expect((await handler(post(validBody()))).status).toBe(429);
    const keys = env.CART_QUOTE_RATE_LIMIT.limit.mock.calls.map(([{ key }]) => key);
    expect(keys).toHaveLength(11);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).not.toContain('203.0.113.42');
    expect(keys[0]).toContain(String(Math.floor(NOW / 60000)));
  });

  it('concurrent requests honor atomic binding decisions', async () => {
    const decisions = [...Array(10).fill(true), ...Array(10).fill(false)];
    const { env } = runtime({
      CART_QUOTE_RATE_LIMIT: {
        limit: vi.fn(async () => ({ success: decisions.shift() })),
      },
    });
    const handler = createCartQuotesHandler(env, {
      now: () => NOW,
      randomBytes: () => crypto.getRandomValues(new Uint8Array(24)),
    });
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => handler(post(validBody()))),
    );
    expect(responses.filter(({ status }) => status === 201)).toHaveLength(10);
    expect(responses.filter(({ status }) => status === 429)).toHaveLength(10);
    expect(env.DESIGN_QUOTES.put).toHaveBeenCalledTimes(10);
  });

  it('uses a distinct anonymous rate-limit bucket and creates distinct URL-safe IDs', async () => {
    const { env } = runtime();
    const handler = createCartQuotesHandler(env, {
      now: () => NOW,
      randomBytes: (() => {
        let value = 0;
        return () => new Uint8Array(24).fill(value += 1);
      })(),
    });
    const request = post(validBody());
    request.headers.delete('CF-Connecting-IP');
    const first = await json(await handler(request));
    const secondRequest = post(validBody());
    secondRequest.headers.delete('CF-Connecting-IP');
    const second = await json(await handler(secondRequest));
    expect(first.bundleId).not.toBe(first.designId.replace(/^dsg_/, 'bun_'));
    expect(first.bundleId).not.toBe(second.bundleId);
    expect(first.designId).not.toBe(second.designId);
  });
});

describe('toMinorUnits', () => {
  it('converts exact USD decimal values and rejects unsafe or over-precise amounts', () => {
    expect(toMinorUnits(0, 'USD')).toBe(0);
    expect(toMinorUnits(89, 'USD')).toBe(8900);
    expect(toMinorUnits(89.25, 'USD')).toBe(8925);
    expect(() => toMinorUnits(1.001, 'USD')).toThrow();
    expect(() => toMinorUnits(0.1 + 0.2, 'USD')).toThrow();
    expect(() => toMinorUnits(Number.MAX_SAFE_INTEGER, 'USD')).toThrow();
    expect(() => toMinorUnits(-1, 'USD')).toThrow();
    expect(() => toMinorUnits(1, 'EUR')).toThrow();
  });
});

describe('wrangler cart quote configuration', () => {
  it('keeps local production behavior and contains no signing secret value or fake KV ID', () => {
    const config = readFileSync('wrangler.jsonc', 'utf8');
    expect(config).toContain('"LOCAL_PRODUCTION_FILES": "true"');
    expect(config).toContain('"SHOPIFY_STORE_CONFIG_JSON": "{}"');
    expect(config).not.toMatch(/"CART_QUOTE_SIGNING_SECRET"\s*:/u);
    expect(config).not.toMatch(/"(?:DESIGN_QUOTES|CART_QUOTE_RATE_LIMIT)"\s*,\s*"id"/u);
  });
});
