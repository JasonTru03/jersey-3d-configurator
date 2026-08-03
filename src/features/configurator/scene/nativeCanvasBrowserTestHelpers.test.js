import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('keeps the shared command available to the smoke-test diagnostics', () => {
    const smokeSource = readFileSync(
      resolvePath(process.cwd(), 'src/features/configurator/scene/uvPatternPieces.browser.test.js'),
      'utf8',
    );

    expect(smokeSource).toContain('const { browserPath, command, result } = runNativeCanvasBrowser');
  });
});
