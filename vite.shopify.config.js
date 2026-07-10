import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    outDir: 'dist/shopify',
    cssCodeSplit: true,
    sourcemap: false,
    lib: {
      entry: 'src/shopify-entry.jsx',
      name: 'ProductConfigurator',
      formats: ['iife'],
      fileName: () => 'product-configurator.js',
      cssFileName: 'product-configurator',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.includes('product-configurator.css')) {
            return 'product-configurator.css';
          }
          return '[name][extname]';
        },
      },
    },
  },
});
