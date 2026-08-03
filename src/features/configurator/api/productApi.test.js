import { describe, expect, it } from 'vitest';
import { productApi } from './productApi.js';

describe('productApi', () => {
  it('returns product definitions with a renderer and default state', async () => {
    const products = await productApi.getProducts();
    const product = await productApi.getProductDefinition(products[0].id);

    expect(product).toMatchObject({
      id: 'fn8788-jersey',
      name: 'Chelsea Match Jersey',
      renderer: 'garmentRenderer',
      model: {
        id: 'chelsea-jersey',
        version: '1',
        uvExportVersion: '2',
        uvAtlasSize: 4096,
        glbUrl: '/models/chelsea-jersey.glb',
        assetName: 'chelsea-jersey.glb',
      },
    });
    expect(product.defaultState.productId).toBe(product.id);
    expect(product.options.layout.length).toBeGreaterThan(1);
  });

  it('quotes a configuration through the API shape reserved for a backend', async () => {
    const quote = await productApi.quoteConfiguration('fn8788-jersey', {
      productId: 'fn8788-jersey',
      layout: 'xl',
      colorway: 'third',
      material: 'player',
      lighting: 'raised-print',
      extras: { sleeveBadge: false, giftBox: true, matchPatch: false },
      overrides: {},
    });

    expect(quote).toMatchObject({
      currency: 'USD',
      basePrice: 89,
      total: 151,
    });
  });
});
