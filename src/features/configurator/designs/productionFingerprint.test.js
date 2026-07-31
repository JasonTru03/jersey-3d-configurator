import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalizeProductionValue,
  createDesignFingerprint,
  createProductionFilename,
} from './productionFingerprint.js';

const input = {
  productId: 'fn8788-jersey',
  variantId: '48039101923479',
  size: 'm',
  model: { id: 'chelsea-jersey', version: '1', uvExportVersion: '1' },
  state: {
    productId: 'fn8788-jersey',
    overrides: {
      customTextItems: [],
      printItems: [{
        id: 'p1',
        name: 'PLAYER',
        number: '16',
        placement: { x: 0, y: 0.36, z: 0.5 },
      }],
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('production fingerprint', () => {
  it('sorts object keys recursively without reordering arrays', () => {
    expect(canonicalizeProductionValue({
      z: 1,
      a: { y: 2, b: 3 },
      rows: [{ z: 4, a: 5 }],
    })).toBe('{"a":{"b":3,"y":2},"rows":[{"a":5,"z":4}],"z":1}');
  });

  it('stays stable for equivalent input and changes with immutable model data', async () => {
    const first = await createDesignFingerprint(input);
    const reordered = await createDesignFingerprint({
      state: structuredClone(input.state),
      model: { uvExportVersion: '1', version: '1', id: 'chelsea-jersey' },
      size: 'm',
      variantId: '48039101923479',
      productId: 'fn8788-jersey',
    });

    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(reordered).toBe(first);
    await expect(createDesignFingerprint({
      ...input,
      model: { ...input.model, version: '2' },
    })).resolves.not.toBe(first);
  });

  it('excludes volatile save timestamps from normalized state input', async () => {
    const first = await createDesignFingerprint({
      ...input,
      state: { ...input.state, savedAt: '2026-07-31T01:00:00.000Z' },
    });
    const second = await createDesignFingerprint({
      ...input,
      state: { ...input.state, savedAt: '2026-07-31T02:00:00.000Z' },
    });

    expect(second).toBe(first);
  });

  it('uses only the eight-character fingerprint in the package filename', () => {
    expect(createProductionFilename('fn8788-jersey', '12ab34cd'))
      .toBe('fn8788-jersey-design-12ab34cd.zip');
    expect(() => createProductionFilename('fn8788-jersey', 'bad'))
      .toThrow('生产文件指纹格式无效。');
  });

  it('fails instead of inventing a hash when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);

    await expect(createDesignFingerprint(input))
      .rejects.toThrow('此浏览器不支持 SHA-256，无法生成生产文件。');
  });
});
