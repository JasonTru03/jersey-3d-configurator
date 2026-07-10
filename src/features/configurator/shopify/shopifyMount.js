import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { ShopifyConfiguratorSection } from './ShopifyConfiguratorSection.jsx';

const mounted = new WeakMap();

export function parseSectionSettings(node) {
  return {
    productId: node.dataset.productId ?? '',
    productHandle: node.dataset.productHandle ?? '',
    variantId: node.dataset.variantId ?? '',
    modelUrl: node.dataset.modelUrl ?? '',
    heading: node.dataset.heading ?? '',
    subheading: node.dataset.subheading ?? '',
    defaultLayout: node.dataset.defaultLayout ?? 'm',
    defaultColorway: node.dataset.defaultColorway ?? 'home',
    defaultMaterial: node.dataset.defaultMaterial ?? 'stadium',
    defaultLighting: node.dataset.defaultLighting ?? 'none',
  };
}

export function mountShopifyConfigurators(root = document) {
  const nodes = root.querySelectorAll('[data-product-configurator-root]');
  nodes.forEach((node) => {
    if (mounted.has(node)) return;
    const reactRoot = createRoot(node);
    reactRoot.render(createElement(ShopifyConfiguratorSection, { settings: parseSectionSettings(node) }));
    mounted.set(node, reactRoot);
  });
}
