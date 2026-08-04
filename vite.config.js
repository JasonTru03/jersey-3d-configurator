import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';

const nativeCanvasTestFiles = [
  'src/features/configurator/scene/nativeCanvasBrowserTestHelpers.test.js',
  'src/features/configurator/scene/uvPatternPieces.browser.test.js',
  'src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js',
];
const defaultTestExclude = [...configDefaults.exclude, '**/.worktrees/**', 'shopify-app/**'];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    exclude: defaultTestExclude,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...defaultTestExclude, ...nativeCanvasTestFiles],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'native-canvas',
          include: nativeCanvasTestFiles,
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
