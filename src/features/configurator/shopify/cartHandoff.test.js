import { describe, expect, it } from 'vitest';
import { createCartUrl, parseShopifyLaunch } from './cartHandoff.js';

function decodeProperties(url) {
  const encoded = new URL(url).searchParams.get('properties');
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

describe('cart handoff', () => {
  it('uses the selected size variant and concise order properties', () => {
    const context = parseShopifyLaunch('?shop=testcsj.myshopify.com&productHandle=custom-3d-football-jersey&variantMap=%7B%22s%22%3A%2248039101890711%22%2C%22m%22%3A%2248039101923479%22%7D');
    const url = createCartUrl({
      context,
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

    expect(url).toContain('/cart/48039101890711:1');
    expect(url).toContain('storefront=true');
    expect(decodeProperties(url)).toEqual({
      Size: 's',
      Template: 'solid',
      Colors: JSON.stringify({ body: '#fff', sleeves: '#fff', shoulderSide: '#111', collar: '#111', pattern: '#d8c17a', number: '#111' }),
      Print: 'PLAYER #10',
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
    const url = createCartUrl({ context, state: { layout: 's', extras: {}, overrides: { bottomPattern: { enabled: false } } } });

    expect(decodeProperties(url)).toMatchObject({ Size: 's', Template: '', Colors: '{}', Print: '', Extras: '', Artwork: '' });
    expect(decodeProperties(url)).not.toHaveProperty('Production Files');
  });

  it('requires a local design filename and atlas hash for an enabled bottom pattern without uploading assets', () => {
    const context = parseShopifyLaunch('?shop=testcsj.myshopify.com&variantMap=%7B%22s%22%3A%2248039101890711%22%7D');
    const state = { layout: 's', extras: {}, overrides: { bottomPattern: { enabled: true } } };

    expect(() => createCartUrl({ context, state })).toThrow('Local production files are not ready.');
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
    expect(Object.keys(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${variantMap}`)).sort())
      .toEqual(['initialLayout', 'productHandle', 'returnPath', 'shop', 'variantId', 'variantMap']);
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
