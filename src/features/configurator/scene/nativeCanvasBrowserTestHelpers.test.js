import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configDefaults } from 'vitest/config';
import viteConfig from '../../../../vite.config.js';
import {
  findNativeCanvasBrowserPath,
  requireNativeCanvasBrowserPath,
} from './nativeCanvasBrowserTestHelpers.js';

describe('native Canvas browser test helpers', () => {
  it('fails closed with a clear error when no supported browser is installed', () => {
    expect(() => requireNativeCanvasBrowserPath({
      environment: {},
      exists: () => false,
      platform: 'linux',
    })).toThrow('Native Canvas');
  });

  it.each([
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
  ])('detects the Linux browser candidate %s', (availablePath) => {
    expect(findNativeCanvasBrowserPath({
      environment: {},
      exists: (candidate) => candidate === availablePath,
      platform: 'linux',
    })).toBe(availablePath);
  });

  it('keeps native Canvas tests isolated, serialized, and outside nested worktrees', () => {
    const smokeSource = readFileSync(
      resolvePath(process.cwd(), 'src/features/configurator/scene/uvPatternPieces.browser.test.js'),
      'utf8',
    );
    const nativeCanvasTestFiles = [
      'src/features/configurator/scene/nativeCanvasBrowserTestHelpers.test.js',
      'src/features/configurator/scene/uvPatternPieces.browser.test.js',
      'src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js',
    ];
    const [unitProject, nativeProject] = viteConfig.test.projects;

    expect(smokeSource).toContain('const { browserPath, command, result } = runNativeCanvasBrowser');
    expect(unitProject.test.exclude).toEqual(expect.arrayContaining([
      ...configDefaults.exclude,
      '**/.worktrees/**',
      ...nativeCanvasTestFiles,
    ]));
    expect(nativeProject.test.include).toEqual(nativeCanvasTestFiles);
    expect(nativeProject.test).toMatchObject({
      fileParallelism: false,
      maxWorkers: 1,
      sequence: { groupOrder: 1 },
    });
  });
});
