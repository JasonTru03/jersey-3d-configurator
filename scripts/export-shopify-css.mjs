import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist/shopify', { recursive: true });
copyFileSync(
  'src/features/configurator/shopify/shopify-configurator.css',
  'dist/shopify/product-configurator.css',
);
copyFileSync(
  'public/models/fn8788-jersey.glb',
  'dist/shopify/fn8788-jersey.glb',
);
