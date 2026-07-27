import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSecureCartHandoff } from './cartQuoteClient.js';
import { parseShopifyLaunch } from './cartHandoff.js';

const NOW = 1_800_000_000_000;
const SHOP = 'testcsj.myshopify.com';
const HANDOFF_URL = `https://${SHOP}/apps/jersey-configurator/cart-handoff?token=abc_DEF-123`;
const SUCCESS = {
  handoffUrl: HANDOFF_URL,
  designId: 'dsg_1234567890abcdef',
  bundleId: 'bun_1234567890abcdef',
  expiresAt: NOW + 60_000,
};

function context() {
  return parseShopifyLaunch(
    `?shop=${SHOP}&variantMap=%7B%22m%22%3A%221004%22%7D&surchargeVariantMap=%7B%2218%22%3A%222018%22%7D`,
  );
}

function ok(body = SUCCESS, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSecureCartHandoff', () => {
  it('posts only the trusted request fields with a null production receipt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const state = { layout: 'm', overrides: {} };

    const result = await createSecureCartHandoff({
      context: context(),
      state,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith('/api/cart-quotes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ shop: SHOP, state, productionFiles: null }),
    });
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(Object.keys(sent).sort()).toEqual(['productionFiles', 'shop', 'state']);
    expect(JSON.stringify(sent)).not.toMatch(/quote|customizationTotal|variantMap|surchargeVariantMap|token/i);
    expect(result).toEqual(SUCCESS);
    expect(result).not.toBe(SUCCESS);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it('sends the exact four-field local production receipt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const productionFiles = {
      atlasFilename: 'fn8788-uv-atlas.png',
      atlasSha256: `sha256:${'a'.repeat(64)}`,
      bundleFilename: 'fn8788-jersey-production.zip',
      designFilename: 'fn8788-jersey-design.json',
    };

    await createSecureCartHandoff({
      context: context(),
      state: { layout: 'm' },
      productionFiles,
      fetchImpl,
    });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).productionFiles).toEqual(productionFiles);
  });

  it('normalizes an explicit null production receipt to body null', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const fetchImpl = vi.fn().mockResolvedValue(ok());

    await createSecureCartHandoff({
      context: context(),
      state: { layout: 'm' },
      productionFiles: null,
      fetchImpl,
    });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).productionFiles).toBeNull();
  });

  it.each([
    ['missing context', { context: null, state: {} }],
    ['forged shop casing', { context: { shop: 'TESTCSJ.myshopify.com' }, state: {} }],
    ['invalid shop', { context: { shop: 'testcsj.myshopify.com.target' }, state: {} }],
    ['incomplete forged context', { context: { shop: SHOP, variantMap: { m: '1004' } }, state: {} }],
    ['missing state', { context: context(), state: undefined }],
  ])('rejects %s before making a request', async (_label, input) => {
    const fetchImpl = vi.fn();
    await expect(createSecureCartHandoff({ ...input, fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'https://TARGET/api/cart-quotes',
    '//TARGET/api/cart-quotes',
    'http://testcsj.myshopify.com/api/cart-quotes',
  ])('rejects a non-same-origin endpoint: %s', async (endpoint) => {
    const fetchImpl = vi.fn();
    await expect(createSecureCartHandoff({ endpoint, context: context(), state: {}, fetchImpl }))
      .rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses a finite server error message for a non-success response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Pricing changed. Reopen the product page.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ));
    await expect(createSecureCartHandoff({ context: context(), state: {}, fetchImpl }))
      .rejects.toThrow('Pricing changed. Reopen the product page.');
  });

  it.each([
    ['non-JSON', new Response('<html>bad</html>', { status: 503 })],
    ['missing error', new Response(JSON.stringify({ message: 'leak' }), { status: 400 })],
    ['long error', new Response(JSON.stringify({ error: 'x'.repeat(201) }), { status: 400 })],
    ['control error', new Response(JSON.stringify({ error: 'bad\nmessage' }), { status: 400 })],
  ])('uses the generic failure for a %s error response', async (_label, response) => {
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await expect(createSecureCartHandoff({ context: context(), state: {}, fetchImpl }))
      .rejects.toThrow('Secure cart preparation failed.');
  });

  it('uses the generic failure for a network error and invalid success JSON', async () => {
    await expect(createSecureCartHandoff({
      context: context(),
      state: {},
      fetchImpl: vi.fn().mockRejectedValue(new Error('private network detail')),
    })).rejects.toThrow('Secure cart preparation failed.');

    await expect(createSecureCartHandoff({
      context: context(),
      state: {},
      fetchImpl: vi.fn().mockResolvedValue(new Response('not-json', { status: 201 })),
    })).rejects.toThrow('Secure cart preparation failed.');
  });

  it.each([
    ['missing key', { ...SUCCESS, bundleId: undefined }],
    ['extra key', { ...SUCCESS, extra: true }],
    ['wrong handoff type', { ...SUCCESS, handoffUrl: 1 }],
    ['bad design id', { ...SUCCESS, designId: 'dsg_short' }],
    ['bad bundle id', { ...SUCCESS, bundleId: 'dsg_1234567890abcdef' }],
    ['unsafe expiry', { ...SUCCESS, expiresAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['expired response', { ...SUCCESS, expiresAt: NOW }],
  ])('rejects a success response with %s', async (_label, body) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const normalized = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
    await expect(createSecureCartHandoff({
      context: context(), state: {}, fetchImpl: vi.fn().mockResolvedValue(ok(normalized)),
    })).rejects.toThrow('Secure cart preparation failed.');
  });

  it.each([
    'https://TARGET/apps/jersey-configurator/cart-handoff?token=abc',
    `http://${SHOP}/apps/jersey-configurator/cart-handoff?token=abc`,
    `//${SHOP}/apps/jersey-configurator/cart-handoff?token=abc`,
    `https://${SHOP}:443/apps/jersey-configurator/cart-handoff?token=abc`,
    `https://user:pass@${SHOP}/apps/jersey-configurator/cart-handoff?token=abc`,
    `https://${SHOP}/apps/jersey-configurator/cart-handoff/extra?token=abc`,
    `https://${SHOP}/apps/jersey-configurator/cart-handoff?token=abc&extra=1`,
    `https://${SHOP}/apps/jersey-configurator/cart-handoff?token=abc&token=def`,
    `https://${SHOP}/apps/jersey-configurator/cart-handoff?token=`,
    `https://${SHOP}/apps/jersey-configurator/cart-handoff?token=${'x'.repeat(256)}`,
    `https://${SHOP}/apps/jersey-configurator/cart-handoff?token=abc#fragment`,
  ])('rejects an unsafe handoff URL: %s', async (handoffUrl) => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    await expect(createSecureCartHandoff({
      context: context(),
      state: {},
      fetchImpl: vi.fn().mockResolvedValue(ok({ ...SUCCESS, handoffUrl })),
    })).rejects.toThrow('Secure cart preparation failed.');
  });
});
