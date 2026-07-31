import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProductionManifest,
  sha256Hex,
  verifyProductionArtifacts,
} from './productionManifest.js';

const artifact = (name, body, mediaType) => ({
  blob: new Blob([body], { type: mediaType }),
  name,
  mediaType,
});

const createFiles = () => [
  artifact('design.json', '{}', 'application/json'),
  artifact('uv-atlas.png', 'atlas', 'image/png'),
  artifact('uv-reference.pdf', 'pdf', 'application/pdf'),
  artifact('preview-front.png', 'front', 'image/png'),
  artifact('preview-back.png', 'back', 'image/png'),
];

const manifestInput = (files) => ({
  atlas: { colorSpace: 'sRGB', height: 4096, width: 4096 },
  designFingerprint: '12ab34cd',
  files,
  generatedAt: '2026-07-31T00:00:00.000Z',
  model: { id: 'chelsea-jersey', version: '1' },
  productId: 'fn8788-jersey',
  size: 'm',
  uvExportVersion: '1',
  variantId: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('production manifest', () => {
  it('records lowercase SHA-256 and byte length for all five artifacts', async () => {
    const files = createFiles();
    const manifest = await createProductionManifest(manifestInput(files));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      designFingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
      variantId: null,
      size: 'm',
      model: { id: 'chelsea-jersey', version: '1' },
      uvExportVersion: '1',
      atlas: { colorSpace: 'sRGB', height: 4096, width: 4096 },
      generatedAt: '2026-07-31T00:00:00.000Z',
    });
    expect(manifest.files).toHaveLength(5);
    expect(manifest.files[0]).toEqual({
      byteLength: 2,
      mediaType: 'application/json',
      name: 'design.json',
      sha256: await sha256Hex(files[0].blob),
    });
    expect(manifest.files.every((file) => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true);
    await expect(verifyProductionArtifacts(files, manifest)).resolves.toBe(true);
  });

  it.each([
    ['missing', (files) => files.slice(1)],
    ['renamed', (files) => files.map((file, index) => (
      index ? file : { ...file, name: 'other.json' }
    ))],
    ['altered', (files) => files.map((file, index) => (
      index ? file : artifact('design.json', '{"x":1}', 'application/json')
    ))],
    ['empty', (files) => files.map((file, index) => (
      index ? file : artifact('design.json', '', 'application/json')
    ))],
  ])('rejects a %s artifact set', async (_label, mutate) => {
    const files = createFiles();
    const manifest = await createProductionManifest(manifestInput(files));

    await expect(verifyProductionArtifacts(mutate(files), manifest))
      .rejects.toThrow('生产文件校验失败');
  });

  it('rejects a manifest that changes media type or byte length', async () => {
    const files = createFiles();
    const manifest = await createProductionManifest(manifestInput(files));
    manifest.files[1] = {
      ...manifest.files[1],
      byteLength: manifest.files[1].byteLength + 1,
      mediaType: 'application/octet-stream',
    };

    await expect(verifyProductionArtifacts(files, manifest))
      .rejects.toThrow('生产文件校验失败：uv-atlas.png 与清单不一致。');
  });

  it('fails clearly when SHA-256 is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);

    await expect(sha256Hex(new Blob(['data'])))
      .rejects.toThrow('此浏览器不支持 SHA-256，无法校验生产文件。');
  });

  it('rejects an empty blob before hashing', async () => {
    await expect(sha256Hex(new Blob([])))
      .rejects.toThrow('生产文件不能为空。');
  });
});
