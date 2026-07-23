import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'shopify/blocks/product-3d-configurator-launch.liquid',
  'utf8',
);

describe('native Horizon 3D launcher block', () => {
  it('owns a scoped launcher without moving itself in the DOM', () => {
    expect(source).toContain('assign product_resource = closest.product');
    expect(source).toContain('product_resource.variants');
    expect(source).toContain('block.shopify_attributes');
    expect(source).toContain('data-product-3d-configurator-block');
    expect(source).toContain('form[action*="/cart/add"]');
    expect(source).toContain('variantMap');
    expect(source).not.toMatch(/\.before\(|insertBefore|appendChild/);
  });

  it('is available as a theme-editor product block', () => {
    expect(source).toContain('"name": "3D configurator launcher"');
    expect(source).toContain('"category": "Product"');
    expect(source).toContain('"default": "Start 3D customization"');
  });
});
