import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function exportShopifyCss({
  output = 'dist/shopify/product-configurator.css',
} = {}) {
  mkdirSync('dist/shopify', { recursive: true });
  const shopifyCss = readFileSync(
    'src/features/configurator/shopify/shopify-configurator.css',
    'utf8',
  );
  const personalizationCss = readFileSync(
    'src/features/configurator/scene/personalization-controls.css',
    'utf8',
  );
  writeFileSync(output, `${shopifyCss.trimEnd()}\n\n${personalizationCss}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  exportShopifyCss();
  copyFileSync(
    'public/models/fn8788-jersey.glb',
    'dist/shopify/fn8788-jersey.glb',
  );
}
