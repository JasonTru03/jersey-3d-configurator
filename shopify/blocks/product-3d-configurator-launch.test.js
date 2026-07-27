import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const blockSource = readFileSync(
  'shopify/blocks/product-3d-configurator-launch.liquid',
  'utf8',
);
const sectionSource = readFileSync(
  'shopify/sections/product-3d-configurator-launch.liquid',
  'utf8',
);

describe('native Horizon 3D launcher block', () => {
  it('owns a scoped launcher without moving itself in the DOM', () => {
    expect(blockSource).toContain('assign product_resource = closest.product');
    expect(blockSource).toContain('product_resource.variants');
    expect(blockSource).toContain('block.shopify_attributes');
    expect(blockSource).toContain('data-product-3d-configurator-block');
    expect(blockSource).toContain('form[action*="/cart/add"]');
    expect(blockSource).toContain('variantMap');
    expect(blockSource).not.toMatch(/\.before\(|insertBefore|appendChild/);
  });

  it('is available as a theme-editor product block', () => {
    expect(blockSource).toContain('"name": "3D configurator launcher"');
    expect(blockSource).toContain('"category": "Product"');
    expect(blockSource).toContain('"default": "Start 3D customization"');
  });

  it.each([
    ['block', blockSource, 'data-product-3d-configurator-button'],
    ['section', sectionSource, 'data-product-3d-configurator-launch-button'],
  ])('keeps the %s launcher navigable after Horizon replaces its button node', (_kind, source, buttonAttribute) => {
    expect(source).toContain('<a');
    expect(source).toContain('href="{{ configurator_url | strip | escape }}"');
    expect(source).toContain('data-initial-variant-id=');
    expect(source).toContain("document.addEventListener('click'");
    expect(source).toContain(`closest('[${buttonAttribute}]')`);
    expect(source).toContain('productForm?.elements?.id?.value');
    expect(source).toContain("searchParams.get('variant')");
    expect(source).toContain('.dataset.initialVariantId');
    expect(source).toContain('event.preventDefault()');
    expect(source).not.toContain("button.addEventListener('click'");
  });
});
