import { describe, expect, it } from 'vitest';
import {
  createCartUrl,
  findSurchargeCombination,
  parseShopifyLaunch,
} from './cartHandoff.js';

function decodeProperties(url) {
  const encoded = new URL(url).searchParams.get('properties');
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

describe('cart handoff', () => {
  it('uses the selected size variant and concise order properties', () => {
    const context = parseShopifyLaunch('?shop=testcsj.myshopify.com&productHandle=custom-3d-football-jersey&variantMap=%7B%22s%22%3A%2248039101890711%22%2C%22m%22%3A%2248039101923479%22%7D&surchargeVariantMap=%7B%2268%22%3A%2249000000000068%22%7D');
    const url = createCartUrl({
      context,
      quote: { customizationTotal: 68, merchandisePrice: 89, total: 157 },
      state: {
        layout: 's',
        extras: {},
        overrides: {
          appearance: {
            template: 'solid',
            colors: {
              body: '#fff',
              sleeves: '#fff',
              shoulderSide: '#111',
              collar: '#111',
              pattern: '#d8c17a',
              number: '#111',
            },
          },
          printName: 'PLAYER',
          printNumber: '10',
          customTextItems: [
            { id: 'text-1', text: '  CHELSEA FC  ' },
            { id: 'text-2', text: '   ' },
            { id: 'text-3', text: 'LONDON' },
          ],
          decorations: [],
          bottomPattern: { enabled: true },
        },
      },
      productionFiles: {
        bundleFilename: 'fn8788-jersey-production.zip',
        designFilename: 'fn8788-jersey-design.json',
        atlasSha256: 'sha256:abc123',
      },
    });

    expect(url).toContain('/cart/48039101890711:1,49000000000068:1');
    expect(url).toContain('storefront=true');
    expect(decodeProperties(url)).toEqual({
      Size: 's',
      Template: 'solid',
      Colors: JSON.stringify({ body: '#fff', sleeves: '#fff', shoulderSide: '#111', collar: '#111', pattern: '#d8c17a', number: '#111' }),
      Print: 'PLAYER #10',
      'Custom Text': 'CHELSEA FC | LONDON',
      Extras: '',
      Artwork: '',
      'Production Files': 'Local ZIP download',
      'Bundle File': 'fn8788-jersey-production.zip',
      'Design File': 'fn8788-jersey-design.json',
      'UV Atlas SHA-256': 'sha256:abc123',
    });
  });

  it('keeps the normal cart properties without requiring an asset when the bottom pattern is disabled', () => {
    const context = parseShopifyLaunch('?shop=testcsj.myshopify.com&variantMap=%7B%22s%22%3A%2248039101890711%22%7D');
    const url = createCartUrl({
      context,
      quote: { customizationTotal: 0, merchandisePrice: 89, total: 89 },
      state: { layout: 's', extras: {}, overrides: { bottomPattern: { enabled: false } } },
    });

    expect(url).toContain('/cart/48039101890711:1?');
    expect(decodeProperties(url)).toMatchObject({ Size: 's', Template: '', Colors: '{}', Print: '', Extras: '', Artwork: '' });
    expect(decodeProperties(url)).not.toHaveProperty('Production Files');
  });

  it('requires a local design filename and atlas hash for an enabled bottom pattern without uploading assets', () => {
    const context = parseShopifyLaunch('?shop=testcsj.myshopify.com&variantMap=%7B%22s%22%3A%2248039101890711%22%7D');
    const state = { layout: 's', extras: {}, overrides: { bottomPattern: { enabled: true } } };

    expect(() => createCartUrl({ context, quote: { customizationTotal: 0, total: 89 }, state })).toThrow('Local production files are not ready.');
  });

  it('keeps one exact surcharge line when the amount is mapped', () => {
    const context = parseShopifyLaunch('?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&surchargeVariantMap=%7B%2218%22%3A%2249000000000018%22%2C%2212%22%3A%2249000000000012%22%7D');

    const url = createCartUrl({
      context,
      quote: { customizationTotal: 18, merchandisePrice: 89, total: 107 },
      state: { layout: 'm', extras: {}, overrides: { bottomPattern: { enabled: false } } },
    });

    expect(url).toContain('/cart/48039101923479:1,49000000000018:1');
  });

  it('composes 62 dollars from 50 and 12 when the exact amount is absent', () => {
    const context = parseShopifyLaunch(
      '?shop=testcsj.myshopify.com'
      + '&variantMap=%7B%22m%22%3A%2248039101923479%22%7D'
      + '&surchargeVariantMap=%7B%2250%22%3A%2249000000000050%22%2C%2212%22%3A%2249000000000012%22%2C%228%22%3A%2249000000000008%22%7D',
    );

    const url = createCartUrl({
      context,
      quote: { customizationTotal: 62, merchandisePrice: 89, total: 151 },
      state: { layout: 'm', extras: {}, overrides: { bottomPattern: { enabled: false } } },
    });

    expect(url).toContain('/cart/48039101923479:1,49000000000050:1,49000000000012:1');
  });

  it('uses quantity when repeating one surcharge variant is optimal', () => {
    const context = parseShopifyLaunch(
      '?shop=testcsj.myshopify.com'
      + '&variantMap=%7B%22m%22%3A%2248039101923479%22%7D'
      + '&surchargeVariantMap=%7B%228%22%3A%2249000000000008%22%7D',
    );

    const url = createCartUrl({
      context,
      quote: { customizationTotal: 24, merchandisePrice: 89, total: 113 },
      state: { layout: 'm', extras: {}, overrides: { bottomPattern: { enabled: false } } },
    });

    expect(url).toContain('/cart/48039101923479:1,49000000000008:3');
  });

  it('chooses the fewest units, then kinds, then larger amounts deterministically', () => {
    expect(findSurchargeCombination({
      8: '4900000000000008',
      7: '4900000000000007',
      6: '4900000000000006',
      5: '4900000000000005',
      4: '4900000000000004',
    }, 12)).toEqual([
      { amount: 6, quantity: 2, variantId: '4900000000000006' },
    ]);

    expect(findSurchargeCombination({
      7: '4900000000000007',
      6: '4900000000000006',
      4: '4900000000000004',
      3: '4900000000000003',
    }, 10)).toEqual([
      { amount: 7, quantity: 1, variantId: '4900000000000007' },
      { amount: 3, quantity: 1, variantId: '4900000000000003' },
    ]);
  });

  it('handles zero, invalid targets, and invalid map entries', () => {
    expect(findSurchargeCombination({ invalid: 'bad' }, 0)).toEqual([]);
    expect(findSurchargeCombination({ 8: '4900000000000008' }, -1)).toBeNull();
    expect(findSurchargeCombination({ 8: '4900000000000008' }, 1.5)).toBeNull();
    expect(findSurchargeCombination({ 8: '4900000000000008' }, Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(findSurchargeCombination({
      0: '4900000000000000',
      '-4': '4900000000000004',
      8: 'bad',
      12: '4900000000000012',
      13: '4900000000000013',
      99: '4900000000000099',
    }, 12)).toEqual([
      { amount: 12, quantity: 1, variantId: '4900000000000012' },
    ]);
  });

  it('reports expired pricing before cart navigation when no exact sum exists', () => {
    const context = parseShopifyLaunch(
      '?shop=testcsj.myshopify.com'
      + '&variantMap=%7B%22m%22%3A%2248039101923479%22%7D'
      + '&surchargeVariantMap=%7B%2210%22%3A%2249000000000010%22%7D',
    );

    expect(() => createCartUrl({
      context,
      quote: { customizationTotal: 23, merchandisePrice: 89, total: 112 },
      state: { layout: 'm', extras: {}, overrides: { bottomPattern: { enabled: false } } },
    })).toThrow(
      'Pricing for this configurator launch has expired. Reopen it from the Shopify product page.',
    );
  });

  it('rejects an invalid shop host, malformed maps, and missing selected-size variants', () => {
    expect(parseShopifyLaunch('?shop=example.com')).toBeNull();
    expect(parseShopifyLaunch('?shop=testcsj.myshopify.com&variantMap=%7B%22s%22%3A%22abc%22%7D')).toBeNull();
    expect(() => createCartUrl({
      context: { shop: 'testcsj.myshopify.com@TARGET', variantMap: { s: '48039101890711' } },
      state: { layout: 's' },
      designAsset: { designId: 'dsg_1', url: 'https://TARGET/atlas.png', sha256: 'x', version: 1 },
    })).toThrow('Invalid Shopify shop host.');
    expect(() => createCartUrl({
      context: { shop: 'testcsj.myshopify.com', variantMap: {} },
      state: { layout: 'xl' },
      designAsset: { designId: 'dsg_1', url: 'https://TARGET/atlas.png', sha256: 'x', version: 1 },
    })).toThrow('selected size');
  });

  it('accepts an internal return path and rejects external return paths', () => {
    const variantMap = '%7B%22s%22%3A%2248039101890711%22%7D';

    expect(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}&returnPath=%2Fcart`))
      .toMatchObject({ returnPath: '/cart' });
    expect(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}&returnPath=https%3A%2F%2FTARGET%2F`))
      .toBeNull();
    expect(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}&returnPath=%2F%2FTARGET%2F`))
      .toBeNull();
    expect(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}&returnPath=%2F%5CTARGET%2F`))
      .toBeNull();
  });

  it('does not expose a design upload credential from launch parameters', () => {
    const variantMap = '%7B%22s%22%3A%2248039101890711%22%7D';
    const surchargeVariantMap = '%7B%2218%22%3A%2249000000000018%22%7D';
    expect(Object.keys(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}&surchargeVariantMap=${surchargeVariantMap}`)).sort())
      .toEqual(['initialLayout', 'productHandle', 'returnPath', 'shop', 'surchargeVariantMap', 'variantId', 'variantMap']);
  });

  it('rejects malformed surcharge variant maps without discarding the Shopify launch', () => {
    const context = parseShopifyLaunch('?shop=testcsj.myshopify.com&variantMap=%7B%22s%22%3A%2248039101890711%22%7D&surchargeVariantMap=%7B%2218%22%3A%22bad%22%7D');

    expect(context).toMatchObject({ shop: 'testcsj.myshopify.com', surchargeVariantMap: null });
  });

  it('rejects control-character return paths while preserving internal queries', () => {
    const variantMap = '%7B%22s%22%3A%2248039101890711%22%7D';

    expect(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}&returnPath=%2F%0A%2F%2FTARGET%2F`))
      .toBeNull();
    expect(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}&returnPath=%2F%0D%2F%2FTARGET%2F`))
      .toBeNull();
    expect(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}&returnPath=%2F%09%2F%2FTARGET%2F`))
      .toBeNull();
    expect(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}&returnPath=%2Fcart%3Fx%3D1`))
      .toMatchObject({ returnPath: '/cart?x=1' });
  });
});
