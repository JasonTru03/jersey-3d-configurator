import { describe, expect, it, vi } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { toMinorUnits } from './cartQuotes.js';
import {
  createShopFingerprint,
  signQuoteContract,
} from './quoteContract.js';
import {
  createAppProxyHandler,
  createCartItems,
  isCartAddResponseValid,
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
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .sort()
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
  const limit = vi.fn(async () => ({ success: true }));
  const logger = { error: vi.fn() };
  return {
    env: {
      DESIGN_QUOTES: { get },
      CART_HANDOFF_RATE_LIMIT: { limit },
      CART_QUOTE_SIGNING_SECRET: QUOTE_SECRET,
      SHOPIFY_API_SECRET: API_SECRET,
      ...overrides,
    },
    get,
    limit,
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

function jsonResponse(body, { ok = true } = {}) {
  return { ok, json: vi.fn(async () => body) };
}

async function executeHandoff(items, fetchMock) {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(renderHandoffHtml(items), {
    runScripts: 'outside-only',
    url: `https://${SHOP}/apps/jersey-configurator/cart-handoff`,
    virtualConsole,
  });
  dom.window.fetch = fetchMock;
  dom.window.TextDecoder = TextDecoder;
  const scripts = [...dom.window.document.querySelectorAll('script')];
  dom.window.eval(scripts.at(-1).textContent);
  await settleClient();
  return dom;
}

async function settleClient() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('sorts complete key-value strings and authenticates form-decoded special characters', async () => {
    const rawEntries = [
      ['a', 'z'],
      ['a0', 'first'],
      ['plus_as_space', ' '],
      ['encoded_plus', '+'],
      ['encoded_space', ' '],
      ['percent', '%'],
      ['shop', SHOP],
      ['timestamp', String(Math.floor(NOW / 1000))],
      ['token', 'abc'],
    ];
    const signature = await proxySignature(rawEntries);
    const rawQuery = [
      'a=z',
      'a0=first',
      'plus_as_space=+',
      'encoded_plus=%2B',
      'encoded_space=%20',
      'percent=%25',
      `shop=${SHOP}`,
      `timestamp=${Math.floor(NOW / 1000)}`,
      'token=abc',
      `signature=${signature}`,
    ].join('&');
    await expect(verifyAppProxySignature(
      new URL(`https://worker.example/proxy?${rawQuery}`),
      API_SECRET,
    )).resolves.toBe(true);
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
      summary: { Size: '棣冨汲'.repeat(256) },
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
        Artwork: '</script><svg/onload=alert("x")>\\\u2028\u2029棣冨汲',
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

describe('isCartAddResponseValid', () => {
  it('accepts the single parent line returned after Cart Transform merges the components', async () => {
    const { record, token } = await validFixture({
      components: [
        { role: 'base', variantId: '12345678901234', quantity: 1 },
        { role: 'surcharge', variantId: '42', quantity: 3 },
      ],
    });
    const items = createCartItems(record, token);
    const base = items.find((item) => item.properties._jersey_component === 'base');
    const merged = {
      variant_id: Number(base.id),
      quantity: base.quantity,
      properties: {
        _jersey_bundle_id: base.properties._jersey_bundle_id,
        _jersey_components: JSON.stringify([
          ['b', '12345678901234', 1],
          ['s', '42', 3],
        ]),
      },
    };

    expect(isCartAddResponseValid(items, { items: [merged] })).toBe(true);
  });
  it('requires matching variants, quantities, and every private bundle property', async () => {
    const { record, token } = await validFixture({
      components: [
        { role: 'base', variantId: '12345678901234', quantity: 1 },
        { role: 'surcharge', variantId: '42', quantity: 3 },
      ],
    });
    const items = createCartItems(record, token);
    const response = {
      items: items.map((item) => ({
        variant_id: Number(item.id),
        quantity: item.quantity,
        properties: { ...item.properties },
      })),
    };

    expect(isCartAddResponseValid(items, response)).toBe(true);
    expect(isCartAddResponseValid(items, {
      items: response.items.map(({ variant_id: id, ...item }) => ({ ...item, id })),
    })).toBe(true);
    expect(isCartAddResponseValid(items, {
      items: response.items.map((item, index) => index === 0 ? { ...item, variant_id: 99 } : item),
    })).toBe(false);
    expect(isCartAddResponseValid(items, {
      items: response.items.map((item, index) => index === 1 ? { ...item, quantity: 2 } : item),
    })).toBe(false);
    expect(isCartAddResponseValid(items, {
      items: response.items.map((item, index) => index === 0
        ? { ...item, properties: { ...item.properties, _jersey_quote: undefined } }
        : item),
    })).toBe(false);
  });

  it('requires every non-empty visible summary property while allowing omitted empty values', async () => {
    const { record, token } = await validFixture({
      summary: {
        Size: 'xl',
        Template: 'solid',
        Colors: '{"body":"#FFFFFF"}',
        Print: '',
        'Custom Text': '',
        Extras: '',
        Artwork: 'Crest Badge',
        'Production Files': 'Local ZIP download',
        'Bundle File': 'jersey-production.zip',
        'Design File': 'jersey-design.json',
        'Atlas File': 'jersey-atlas.png',
        'UV Atlas SHA-256': `sha256:${'a'.repeat(64)}`,
      },
    });
    const items = createCartItems(record, token);
    const response = {
      items: items.map((item) => ({
        variant_id: item.id,
        quantity: item.quantity,
        properties: Object.fromEntries(Object.entries(item.properties).filter(([, value]) => value !== '')),
      })),
    };
    expect(isCartAddResponseValid(items, response)).toBe(true);
    for (const key of ['Artwork', 'Production Files', 'Bundle File', 'UV Atlas SHA-256']) {
      const missing = structuredClone(response);
      delete missing.items[0].properties[key];
      expect(isCartAddResponseValid(items, missing)).toBe(false);
      const tampered = structuredClone(response);
      tampered.items[0].properties[key] = 'tampered';
      expect(isCartAddResponseValid(items, tampered)).toBe(false);
    }
  });

  it('rejects unsafe numeric responses for uint64 IDs but accepts exact response strings', async () => {
    const { record, token } = await validFixture();
    const items = createCartItems(record, token);
    const responseItems = items.map((item) => ({
      variant_id: item.id,
      quantity: item.quantity,
      properties: { ...item.properties },
    }));
    expect(isCartAddResponseValid(items, { items: responseItems })).toBe(true);
    expect(isCartAddResponseValid(items, {
      items: responseItems.map((item, index) => index === 0
        ? { ...item, variant_id: Number(item.variant_id) }
        : item),
    })).toBe(false);
  });
});

describe('createAppProxyHandler', () => {
  it('verifies the proxy before decoding the token or reading KV', async () => {
    const { record } = await validFixture();
    const { env, get, limit, logger } = runtime(record);
    const url = await signedUrl({ token: 'not-a-token' });
    url.searchParams.set('signature', '0'.repeat(64));
    const response = await createAppProxyHandler(env, { now: () => NOW, logger })(new Request(url));

    expect(response.status).toBe(400);
    expect(limit).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('not-a-token');
  });

  it('rate limits authenticated handoffs before token decode and KV access', async () => {
    const { record, token } = await validFixture();
    for (const [loggedInCustomerId, expectedKey] of [
      ['', `${SHOP}:anonymous`],
      ['1234567890', `${SHOP}:1234567890`],
    ]) {
      const limit = vi.fn(async () => ({ success: false }));
      const { env, get } = runtime(record, { CART_HANDOFF_RATE_LIMIT: { limit } });
      const response = await createAppProxyHandler(env, { now: () => NOW })(
        await requestFor(token, { logged_in_customer_id: loggedInCustomerId }),
      );
      expect(response.status).toBe(429);
      expect(limit).toHaveBeenCalledWith({ key: expectedKey });
      expect(get).not.toHaveBeenCalled();
    }

    const limit = vi.fn(async () => ({ success: false }));
    const { env, get } = runtime(record, { CART_HANDOFF_RATE_LIMIT: { limit } });
    const response = await createAppProxyHandler(env, { now: () => NOW })(
      await requestFor('not-a-quote-token'),
    );
    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it('fails closed when the handoff limiter is missing, throws, or returns a malformed result', async () => {
    const { record, token } = await validFixture();
    const cases = [
      { CART_HANDOFF_RATE_LIMIT: undefined },
      { CART_HANDOFF_RATE_LIMIT: { limit: vi.fn(async () => { throw new Error('limiter'); }) } },
      { CART_HANDOFF_RATE_LIMIT: { limit: vi.fn(async () => ({})) } },
    ];
    for (const override of cases) {
      const { env, get } = runtime(record, override);
      const response = await createAppProxyHandler(env, { now: () => NOW })(await requestFor(token));
      expect(response.status).toBe(503);
      expect(get).not.toHaveBeenCalled();
    }
  });

  it('rejects duplicates and empty critical parameters before KV access', async () => {
    const { record } = await validFixture();
    const { env, get } = runtime(record);
    for (const mutate of [
      (url) => url.searchParams.append('shop', SHOP),
      (url) => url.searchParams.append('token', 'second-token'),
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

  it('accepts repeated extension parameters with official comma canonicalization', async () => {
    const { record, token } = await validFixture();
    const entries = [
      ['extra', '1'],
      ['extra', '2'],
      ['shop', SHOP],
      ['timestamp', String(Math.floor(NOW / 1000))],
      ['path_prefix', '/apps/jersey-configurator'],
      ['logged_in_customer_id', ''],
      ['token', token],
    ];
    const signature = await proxySignature(entries);
    const url = new URL('https://worker.example/cart-handoff');
    for (const [key, value] of entries) url.searchParams.append(key, value);
    url.searchParams.append('signature', signature);
    const { env, get } = runtime(record);
    const response = await createAppProxyHandler(env, { now: () => NOW })(new Request(url));
    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledOnce();
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

describe('rendered handoff client', () => {
  async function fixtureItems() {
    const { record, token } = await validFixture({
      components: [
        { role: 'base', variantId: '12345678901234', quantity: 1 },
        { role: 'surcharge', variantId: '42', quantity: 3 },
      ],
    });
    return createCartItems(record, token);
  }

  function responseItems(items) {
    return items.map((item) => ({
      variant_id: Number(item.id),
      quantity: item.quantity,
      properties: Object.fromEntries(Object.entries(item.properties).filter(([, value]) => value !== '')),
    }));
  }

  function mergedResponseItem(items) {
    const base = items.find((item) => item.properties._jersey_component === 'base');
    return {
      variant_id: Number(base.id),
      quantity: base.quantity,
      properties: {
        _jersey_bundle_id: base.properties._jersey_bundle_id,
        _jersey_components: JSON.stringify(items.map((item) => [
          item.properties._jersey_component === 'base' ? 'b' : 's',
          item.id,
          item.quantity,
        ])),
      },
    };
  }

  it('navigates after Cart Transform returns one merged parent line', async () => {
    const items = await fixtureItems();
    const fetchMock = vi.fn(async () => jsonResponse({ items: [{ id: 'opaque-transformed-parent' }] }));
    const dom = await executeHandoff(items, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dom.window.document.documentElement.dataset.cartHandoff).toBe('complete');
  });

  it('navigates after a fully validated cart/add response', async () => {
    const items = await fixtureItems();
    const fetchMock = vi.fn(async () => jsonResponse({ items: responseItems(items) }));
    const dom = await executeHandoff(items, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/cart/add.js');
    expect(dom.window.document.documentElement.dataset.cartHandoff).toBe('complete');
  });

  it('reconciles invalid JSON and allows retry only when the bundle is absent', async () => {
    const items = await fixtureItems();
    let postCount = 0;
    const fetchMock = vi.fn(async (path) => {
      if (path === '/cart/add.js') {
        postCount += 1;
        if (postCount === 1) return { ok: true, json: vi.fn(async () => { throw new SyntaxError('bad json'); }) };
        return jsonResponse({ items: responseItems(items) });
      }
      return jsonResponse({ items: [] });
    });
    const dom = await executeHandoff(items, fetchMock);
    const retry = dom.window.document.getElementById('retry');
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/cart/add.js', '/cart.js']);
    expect(retry.hidden).toBe(false);
    retry.click();
    await settleClient();
    expect(postCount).toBe(2);
    expect(dom.window.document.documentElement.dataset.cartHandoff).toBe('complete');
  });

  it('does not retry POST when a network failure reconciles to a complete bundle', async () => {
    const items = await fixtureItems();
    const fetchMock = vi.fn(async (path) => {
      if (path === '/cart/add.js') throw new TypeError('network');
      return jsonResponse({ items: responseItems(items).reverse() });
    });
    const dom = await executeHandoff(items, fetchMock);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/cart/add.js', '/cart.js']);
    expect(dom.window.document.documentElement.dataset.cartHandoff).toBe('complete');
    expect(dom.window.document.getElementById('retry').hidden).toBe(true);
  });

  it('reconciles one merged parent line as a complete bundle', async () => {
    const items = await fixtureItems();
    const fetchMock = vi.fn(async (path) => {
      if (path === '/cart/add.js') throw new TypeError('network');
      return jsonResponse({ items: [mergedResponseItem(items)] });
    });
    const dom = await executeHandoff(items, fetchMock);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/cart/add.js', '/cart.js']);
    expect(dom.window.document.documentElement.dataset.cartHandoff).toBe('complete');
  });

  it('blocks retry and offers cart review when reconciliation finds a partial bundle', async () => {    const items = await fixtureItems();
    const fetchMock = vi.fn(async (path) => {
      if (path === '/cart/add.js') throw new TypeError('network');
      return jsonResponse({ items: responseItems(items).slice(0, 1) });
    });
    const dom = await executeHandoff(items, fetchMock);
    const retry = dom.window.document.getElementById('retry');
    const review = dom.window.document.getElementById('review-cart');
    expect(retry.hidden).toBe(true);
    expect(review.hidden).toBe(false);
    retry.click();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(review.textContent).toMatch(/Open cart and review/iu);
    expect(review.getAttribute('href')).toBe('/cart');
  });

  it('blocks retry when cart reconciliation itself is inconclusive', async () => {
    const items = await fixtureItems();
    const fetchMock = vi.fn(async (path) => {
      if (path === '/cart/add.js') throw new TypeError('network');
      throw new TypeError('cart unavailable');
    });
    const dom = await executeHandoff(items, fetchMock);
    expect(dom.window.document.getElementById('retry').hidden).toBe(true);
    expect(dom.window.document.getElementById('review-cart').hidden).toBe(false);
  });

  it('treats malformed cart item data as inconclusive rather than an empty cart', async () => {
    const items = await fixtureItems();
    const fetchMock = vi.fn(async (path) => {
      if (path === '/cart/add.js') throw new TypeError('network');
      return jsonResponse({ items: [{ properties: 'malformed' }] });
    });
    const dom = await executeHandoff(items, fetchMock);
    expect(dom.window.document.getElementById('retry').hidden).toBe(true);
    expect(dom.window.document.getElementById('review-cart').hidden).toBe(false);
  });
});
