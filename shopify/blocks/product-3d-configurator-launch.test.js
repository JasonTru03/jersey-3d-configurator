import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const blockSource = readFileSync(
  'shopify/blocks/product-3d-configurator-launch.liquid',
  'utf8',
);
const sectionSource = readFileSync(
  'shopify/sections/product-3d-configurator-launch.liquid',
  'utf8',
);

function getInlineScript(source) {
  return source.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
}

function renderLauncherFixture(kind) {
  const isSection = kind === 'section';
  const containerAttribute = isSection
    ? 'data-product-3d-configurator-launch'
    : 'data-product-3d-configurator-block';
  const buttonAttribute = isSection
    ? 'data-product-3d-configurator-launch-button'
    : 'data-product-3d-configurator-button';
  document.body.innerHTML = `
    <div
      ${containerAttribute}
      data-initial-variant-id="111"
      data-product-handle="custom-3d-football-jersey"
      data-return-path="/cart"
      data-shop="testcsj.myshopify.com"
      data-surcharge-variant-map='{"Player set":333}'
      data-variant-map='{"m":111,"l":222}'
    >
      <a ${buttonAttribute} href="https://jersey-3d-configurator.jason1064969838.workers.dev/?variantId=111">Start 3D customization</a>
    </div>
    <form action="/cart/add">
      <input name="id" type="hidden" value="111">
      <input name="quantity" type="number" value="1">
      <button name="add" type="submit">Add to cart</button>
    </form>
  `;
  return { buttonAttribute, containerAttribute };
}

afterEach(() => {
  document.body.innerHTML = '';
  delete document.documentElement.dataset.pc3dBlockLauncherReady;
  delete document.documentElement.dataset.pc3dSectionLauncherReady;
});

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
    expect(source).not.toContain("button.addEventListener('click'");
  });

  it.each([
    ['block', blockSource],
    ['section', sectionSource],
  ])('updates the replacement %s launcher link with the live form variant', (kind, source) => {
    const { buttonAttribute, containerAttribute } = renderLauncherFixture(kind);
    Function(getInlineScript(source))();

    const oldLauncher = document.querySelector(`[${containerAttribute}]`);
    const replacementLauncher = oldLauncher.cloneNode(true);
    oldLauncher.replaceWith(replacementLauncher);
    document.querySelector('form').elements.id.value = '222';
    const replacementLink = replacementLauncher.querySelector(`[${buttonAttribute}]`);
    replacementLink.addEventListener('click', (event) => event.preventDefault());
    replacementLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const destination = new URL(replacementLink.href);
    expect(destination.searchParams.get('variantId')).toBe('222');
    expect(JSON.parse(destination.searchParams.get('variantMap'))).toEqual({ l: 222, m: 111 });
  });
});
