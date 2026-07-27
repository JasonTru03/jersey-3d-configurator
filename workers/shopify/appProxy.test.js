import { describe, expect, it, vi } from 'vitest';
import { toMinorUnits } from './cartQuotes.js';
import {
  createShopFingerprint,
  signQuoteContract,
} from './quoteContract.js';
import {
  createAppProxyHandler,
  createCartItems,
  renderHandoffHtml,
  verifyAppProxySignature,
} from './appProxy.js';

const NOW = 1_750_000_000_000;
const SHOP = 'fixture-store.myshopify.com';
const API_SECRET = 'proxy-secret-that-is-at-least-32-bytes';
const QUOTE_SECRET = 'quote-secret-that-is-at-least-32-bytes';

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

async function proxySignature(parameters, secret = API_SECRET) {
  const grouped = new Map();
  for (const [key, value] of parameters) {
    if (key === 'signature') continue;
    const values = grouped.get(key) ?? [];
    values.push(value);
    grouped.set(key, values);
  }
  const message = [...grouped]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .join('');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  ));
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signedUrl(overrides = {}, secret = API_SECRET) {
  const values = {
    shop: SHOP,
    timestamp: String(Math.floor(NOW / 1000)),
    path_prefix: '/apps/jersey-configurator',
    logged_in_customer_id: '',
    token: 'TOKEN',
    ...overrides,
  };
  const parameters = Object.entries(values).filter(([, value]) => value !== undefined);
  const signature = await proxySignature(parameters, secret);
  const url = new URL('https://worker.example/cart-handoff');
  for (const [key, value] of parameters) url.searchParams.append(key, value);
  url.searchParams.set('signature', signature);
  return url;
}

async function validFixture(overrides = {}) {
  const shopFingerprint = await createShopFingerprint(SHOP);
  const record = {
    version: 1,
    designId: 'dsg_abcdefghijklmnop',
    bundleId: 'bun_abcdefghijklmnop',
    shop: SHOP,
    shopFingerprint,
    issuedAt: NOW - 60_000,
    expiresAt: NOW + 60_000,
    components: [
      { role: 'base', variantId: '18446744073709551615', quantity: 1 },
      { role: 'surcharge', variantId: '9007199254740992', quantity: 2 },
      { role: 'surcharge', variantId: '42', quantity: 3 },
    ],
    quote: { total: 123.45, currency: 'USD' },
    normalizedState: { layout: 'xl' },
    productionFiles: null,
    summary: {
      Size: 'xl',
      Template: 'solid',
      Colors: '{"body":"#FFFFFF"}',
      Print: '',
      'Custom Text': '',
      Extras: '',
      Artwork: 'Crest Badge',
    },
    ...overrides,
  };
  const token = await signQuoteContract({
    version: record.version,
    shopFingerprint: record.shopFingerprint,
    bundleId: record.bundleId,
    designId: record.designId,
    totalMinor: toMinorUnits(record.quote.total, record.quote.currency),
    currency: record.quote.currency,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    components: record.components,
  }, QUOTE_SECRET);
  return { record, token };
}

function runtime(record, overrides = {}) {
  const get = vi.fn(async () => record === null ? null : JSON.stringify(record));
  const logger = { error: vi.fn() };
  return {
    env: {
      DESIGN_QUOTES: { get },
      CART_QUOTE_SIGNING_SECRET: QUOTE_SECRET,
      SHOPIFY_API_SECRET: API_SECRET,
      ...overrides,
    },
    get,
    logger,
  };
}

async function requestFor(token, overrides = {}, secret = API_SECRET) {
  const url = await signedUrl({ token, ...overrides }, secret);
  return new Request(url, { method: 'GET' });
}

function decodePayload(html) {
  const encoded = /<script type="application\/json" id="cart-payload">([A-Za-z0-9_-]+)<\/script>/u.exec(html)?.[1];
  if (!encoded) throw new Error('Missing encoded payload.');
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe('verifyAppProxySignature', () => {
  it('accepts Shopify-style signatures independent of query order', async () => {
    const parameters = [
      ['timestamp', String(Math.floor(NOW / 1000))],
      ['shop', SHOP],
      ['token', 'abc'],
      ['extra', '1'],
    ];
    const signature = await proxySignature(parameters);
    const first = new URL('https://worker.example/proxy');
    for (const [key, value] of parameters) first.searchParams.append(key, value);
    first.searchParams.set('signature', signature);
    const second = new URL(first);
    second.search = `signature=${signature}&extra=1&token=abc&shop=${SHOP}&timestamp=${Math.floor(NOW / 1000)}`;

    await expect(verifyAppProxySignature(first, API_SECRET)).resolves.toBe(true);
    await expect(verifyAppProxySignature(second, API_SECRET)).resolves.toBe(true);
  });

  it('covers extra parameters and rejects bad signatures and short secrets', async () => {
    const url = await signedUrl({ token: 'abc', extra: 'signed-value' });
    const tampered = new URL(url);
    tampered.searchParams.set('extra', 'tampered');

    await expect(verifyAppProxySignature(tampered, API_SECRET)).resolves.toBe(false);
    await expect(verifyAppProxySignature(url, 'short')).rejects.toThrow('32 UTF-8 bytes');
  });
});

describe('createCartItems', () => {
  it('preserves uint64 IDs, quantities, roles, and adds visible summary only to base', async () => {
    const { record, token } = await validFixture();
    const items = createCartItems(record, token);

    expect(items).toEqual([
      {
        id: '18446744073709551615',
        quantity: 1,
        properties: {
          _jersey_bundle_id: record.bundleId,
          _jersey_quote: token,
          _jersey_design_id: record.designId,
          _jersey_schema: '1',
          _jersey_component: 'base',
          Size: 'xl',
          Template: 'solid',
          Colors: '{"body":"#FFFFFF"}',
          Print: '',
          'Custom Text': '',
          Extras: '',
          Artwork: 'Crest Badge',
        },
      },
      {
        id: '42',
        quantity: 3,
        properties: expect.objectContaining({ _jersey_component: 'surcharge' }),
      },
      {
        id: '9007199254740992',
        quantity: 2,
        properties: expect.objectContaining({ _jersey_component: 'surcharge' }),
      },
    ]);
    expect(Object.keys(items[1].properties)).toHaveLength(5);
    expect(items[1].properties._jersey_bundle_id).toBe(record.bundleId);
    expect(items[2].properties._jersey_quote).toBe(token);
  });

  it('rejects excessive property counts and values instead of truncating', async () => {
    const { record, token } = await validFixture();
    expect(() => createCartItems({
      ...record,
      summary: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`Key ${index}`, 'ok'])),
    }, token)).toThrow('property count');
    expect(() => createCartItems({
      ...record,
      summary: { Size: '馃弳'.repeat(256) },
    }, token)).toThrow('property value');
  });

  it('rejects summary attempts to replace private bundle properties', async () => {
    const { record, token } = await validFixture();
    expect(() => createCartItems({
      ...record,
      summary: { ...record.summary, _jersey_quote: 'forged' },
    }, token)).toThrow('private property');
  });
});

describe('renderHandoffHtml', () => {
  it('keeps payload text base64url-only while preserving hostile Unicode values after decoding', async () => {
    const { record, token } = await validFixture({
      summary: {
        Size: 'xl',
        Template: 'solid',
        Colors: '{"body":"#FFFFFF"}',
        Print: '',
        'Custom Text': '',
        Extras: '',
        Artwork: '</script><svg/onload=alert("x")>\\\u2028\u2029馃弳',
      },
    });
    const items = createCartItems(record, token);
    const html = renderHandoffHtml(items);

    expect(html).not.toContain(record.summary.Artwork);
    expect(html).not.toContain(token);
    expect(html).not.toContain('<svg/onload');
    expect(decodePayload(html).items[0].properties.Artwork).toBe(record.summary.Artwork);
  });

  it('contains one same-origin atomic cart request, guarded success redirect, and generic retry handling', async () => {
    const { record, token } = await validFixture();
    const html = renderHandoffHtml(createCartItems(record, token));

    expect(html).toContain("fetch('/cart/add.js'");
    expect(html).toContain("credentials: 'same-origin'");
    expect(html).toContain("window.location.assign('/cart')");
    expect(html).toContain('response.ok');
    expect(html).toContain('Array.isArray(result.items)');
    expect(html).toContain('retry');
    expect(html).not.toMatch(/https?:\/\//u);
  });
});

describe('createAppProxyHandler', () => {
  it('verifies the proxy before decoding the token or reading KV', async () => {
    const { record } = await validFixture();
    const { env, get, logger } = runtime(record);
    const url = await signedUrl({ token: 'not-a-token' });
    url.searchParams.set('signature', '0'.repeat(64));
    const response = await createAppProxyHandler(env, { now: () => NOW, logger })(new Request(url));

    expect(response.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('not-a-token');
  });

  it('rejects duplicates and empty critical parameters before KV access', async () => {
    const { record } = await validFixture();
    const { env, get } = runtime(record);
    for (const mutate of [
      (url) => url.searchParams.append('shop', SHOP),
      (url) => url.searchParams.set('token', ''),
      (url) => url.searchParams.delete('timestamp'),
    ]) {
      const url = await signedUrl();
      mutate(url);
      const response = await createAppProxyHandler(env, { now: () => NOW })(new Request(url));
      expect(response.status).toBe(400);
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('validates authenticated shop, timestamp, and path prefix', async () => {
    const { record, token } = await validFixture();
    const cases = [
      [{ shop: 'not-shop.example' }, 400],
      [{ timestamp: String(Math.floor(NOW / 1000) - 301) }, 400],
      [{ timestamp: '1.5' }, 400],
      [{ path_prefix: '/apps/wrong' }, 400],
    ];
    for (const [query, status] of cases) {
      const { env, get } = runtime(record);
      const response = await createAppProxyHandler(env, { now: () => NOW })(
        await requestFor(token, query),
      );
      expect(response.status).toBe(status);
      expect(get).not.toHaveBeenCalled();
    }
  });

  it('normalizes an authenticated Shopify domain before record binding checks', async () => {
    const { record, token } = await validFixture();
    const { env } = runtime(record);
    const response = await createAppProxyHandler(env, { now: () => NOW })(
      await requestFor(token, { shop: 'FIXTURE-STORE.MYSHOPIFY.COM' }),
    );
    expect(response.status).toBe(200);
  });

  it('loads and verifies a record then returns exact cart items in secure no-store HTML', async () => {
    const { record, token } = await validFixture();
    const { env, get, logger } = runtime(record);
    const response = await createAppProxyHandler(env, { now: () => NOW, logger })(
      await requestFor(token),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledWith(record.designId, 'text');
    expect(decodePayload(html).items).toEqual(createCartItems(record, token));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'self'");
    expect(html).not.toContain(token);
    expect(html).not.toContain(JSON.stringify(record.summary));
  });

  it('returns limited invalid or expired responses for missing and unauthenticated handoffs', async () => {
    const { record, token } = await validFixture();
    const missingRuntime = runtime(null);
    const missing = await createAppProxyHandler(missingRuntime.env, { now: () => NOW })(
      await requestFor(token),
    );
    expect(missing.status).toBe(410);
    expect(await missing.text()).toMatch(/secure cart handoff expired/iu);

    const corruptToken = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    const invalidRuntime = runtime(record);
    const invalid = await createAppProxyHandler(invalidRuntime.env, { now: () => NOW })(
      await requestFor(corruptToken),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toMatch(/secure cart handoff invalid/iu);
  });

  it('rejects record/token/shop/header/total inconsistencies without detailed error disclosure', async () => {
    const fixture = await validFixture();
    const mismatches = [
      { ...fixture.record, shop: 'another-store.myshopify.com' },
      { ...fixture.record, bundleId: 'bun_ponmlkjihgfedcba' },
      { ...fixture.record, quote: { ...fixture.record.quote, total: 999 } },
      { ...fixture.record, designId: 'dsg_ponmlkjihgfedcba' },
    ];
    for (const record of mismatches) {
      const { env } = runtime(record);
      const response = await createAppProxyHandler(env, { now: () => NOW })(
        await requestFor(fixture.token),
      );
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toMatch(/secure cart handoff invalid/iu);
      expect(body).not.toContain(fixture.token);
      expect(body).not.toContain(record.bundleId);
    }
  });

  it('maps malformed stored data, KV failures, invalid bindings, and property overflow to one 503 response and stable log codes', async () => {
    const { record, token } = await validFixture();
    const cases = [
      [{ ...runtime(record).env, DESIGN_QUOTES: { get: vi.fn(async () => '{bad json') } }, 'APP_PROXY_RECORD_JSON_INVALID'],
      [{ ...runtime(record).env, DESIGN_QUOTES: { get: vi.fn(async () => { throw new Error('KV secret'); }) } }, 'APP_PROXY_DESIGN_STORAGE_FAILED'],
      [{ ...runtime(record).env, SHOPIFY_API_SECRET: 'short' }, 'APP_PROXY_API_SECRET_INVALID'],
      [{ ...runtime(record).env, CART_QUOTE_SIGNING_SECRET: 'short' }, 'APP_PROXY_SIGNING_SECRET_INVALID'],
      [{ ...runtime({ ...record, summary: { ...record.summary, Artwork: 'x'.repeat(256) } }).env }, 'APP_PROXY_CART_PROPERTIES_INVALID'],
    ];
    for (const [env, code] of cases) {
      const logger = { error: vi.fn() };
      const response = await createAppProxyHandler(env, { now: () => NOW, logger })(
        await requestFor(token),
      );
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('Secure cart service is temporarily unavailable.');
      expect(logger.error).toHaveBeenCalledWith(code);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(API_SECRET);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(token);
    }
  });

  it('supports KV JSON values and rejects non-record JSON shapes as service corruption', async () => {
    const { record, token } = await validFixture();
    const jsonRuntime = runtime(record, {
      DESIGN_QUOTES: { get: vi.fn(async () => structuredClone(record)) },
    });
    expect((await createAppProxyHandler(jsonRuntime.env, { now: () => NOW })(
      await requestFor(token),
    )).status).toBe(200);

    const badRuntime = runtime(record, {
      DESIGN_QUOTES: { get: vi.fn(async () => []) },
    });
    expect((await createAppProxyHandler(badRuntime.env, { now: () => NOW })(
      await requestFor(token),
    )).status).toBe(503);
  });

  it('rejects accessor-backed or hidden record fields without reading them', async () => {
    const { record, token } = await validFixture();
    const structuredRecord = structuredClone(record);
    const getter = vi.fn(() => 'secret');
    Object.defineProperty(structuredRecord, 'hidden', { get: getter });
    const { env } = runtime(record, {
      DESIGN_QUOTES: { get: vi.fn(async () => structuredRecord) },
    });
    const response = await createAppProxyHandler(env, { now: () => NOW })(await requestFor(token));
    expect(response.status).toBe(503);
    expect(getter).not.toHaveBeenCalled();
  });

  it('treats malformed record identifiers and unknown summary fields as service corruption', async () => {
    const { record, token } = await validFixture();
    for (const damaged of [
      { ...record, bundleId: 'bad' },
      { ...record, shopFingerprint: 'bad' },
      { ...record, summary: { ...record.summary, Source: 'https://evil.example' } },
    ]) {
      const { env } = runtime(damaged);
      const response = await createAppProxyHandler(env, { now: () => NOW })(await requestFor(token));
      expect(response.status).toBe(503);
    }
  });

  it('never serializes unused record state, sources, or secrets into the handoff HTML', async () => {
    const marker = 'UNUSED-SENSITIVE-MARKER';
    const { record, token } = await validFixture({
      normalizedState: { source: `data:image/png;base64,${marker}`, secret: marker },
      productionFiles: { raw: marker },
    });
    const { env } = runtime(record);
    const response = await createAppProxyHandler(env, { now: () => NOW })(await requestFor(token));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).not.toContain(marker);
    expect(JSON.stringify(decodePayload(html))).not.toContain(marker);
  });

  it('returns 405 with Allow GET for other methods', async () => {
    const { record } = await validFixture();
    const { env, get } = runtime(record);
    const response = await createAppProxyHandler(env)(new Request('https://worker.example/proxy', {
      method: 'POST',
    }));
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(get).not.toHaveBeenCalled();
  });
});
