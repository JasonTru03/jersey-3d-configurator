import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSectionSettings } from './shopifyMount.js';

describe('parseSectionSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads Shopify section settings from data attributes', () => {
    const node = document.createElement('div');
    node.dataset.productConfiguratorRoot = '';
    node.dataset.productId = 'gid://shopify/Product/1';
    node.dataset.productHandle = 'balance-explorer';
    node.dataset.variantId = '123';
    node.dataset.heading = 'Custom builder';
    node.dataset.subheading = 'Preview your configuration';
    node.dataset.modelUrl = '//cdn.shopify.com/s/files/fn8788-jersey.glb';
    node.dataset.defaultLayout = 'xl';
    node.dataset.defaultColorway = 'away';
    node.dataset.defaultMaterial = 'player';
    node.dataset.defaultLighting = 'raised-print';

    expect(parseSectionSettings(node)).toEqual({
      productId: 'gid://shopify/Product/1',
      productHandle: 'balance-explorer',
      variantId: '123',
      modelUrl: '//cdn.shopify.com/s/files/fn8788-jersey.glb',
      heading: 'Custom builder',
      subheading: 'Preview your configuration',
      defaultLayout: 'xl',
      defaultColorway: 'away',
      defaultMaterial: 'player',
      defaultLighting: 'raised-print',
    });
  });
});
