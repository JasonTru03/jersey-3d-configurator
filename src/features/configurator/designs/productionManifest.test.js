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
  artifact('uv-pattern-pieces.png', 'pieces', 'image/png'),
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
  patternPieces: createPatternPieces(),
  productId: 'fn8788-jersey',
  size: 'm',
  uvExportVersion: '1',
  variantId: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('production manifest', () => {
  it('records both PNG contracts, piece metadata, and hashes for all six artifacts', async () => {
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
      patternPieces: createPatternPieces(),
      generatedAt: '2026-07-31T00:00:00.000Z',
    });
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files[0]).toEqual({
      byteLength: 2,
      mediaType: 'application/json',
      name: 'design.json',
      sha256: await sha256Hex(files[0].blob),
    });
    expect(manifest.files[1]).toMatchObject({
      name: 'uv-atlas.png',
      sha256: await sha256Hex(files[1].blob),
    });
    expect(manifest.files[2]).toMatchObject({
      name: 'uv-pattern-pieces.png',
      sha256: await sha256Hex(files[2].blob),
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

  it.each([
    ['missing metadata', (input) => ({ ...input, patternPieces: null })],
    ['empty piece list', (input) => ({
      ...input,
      patternPieces: { ...input.patternPieces, pieces: [] },
    })],
    ['mismatched dimensions', (input) => ({
      ...input,
      patternPieces: { ...input.patternPieces, width: 2048 },
    })],
    ['zero coverage', (input) => ({
      ...input,
      patternPieces: {
        ...input.patternPieces,
        pieces: input.patternPieces.pieces.map((piece) => ({
          ...piece,
          coveragePixels: 0,
        })),
      },
    })],
    ['mismatched source group', (input) => ({
      ...input,
      patternPieces: {
        ...input.patternPieces,
        pieces: input.patternPieces.pieces.map((piece) => ({
          ...piece,
          sourceMeshes: ['Other_mesh'],
        })),
      },
    })],
  ])('rejects %s for UV pattern pieces', async (_label, mutate) => {
    const input = manifestInput(createFiles());

    await expect(createProductionManifest(mutate(input)))
      .rejects.toThrow('生产清单中的 UV 裁片数据无效');
  });

  it('rejects invalid piece metadata during artifact verification', async () => {
    const files = createFiles();
    const manifest = await createProductionManifest(manifestInput(files));
    manifest.patternPieces.pieces[0].coveragePixels = 0;

    await expect(verifyProductionArtifacts(files, manifest))
      .rejects.toThrow('生产清单中的 UV 裁片数据无效');
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

function createPatternPieces() {
  return {
    height: 4096,
    layoutFingerprint: 'uv-pieces-v1-12ab34cd',
    pieces: [{
      aliases: [],
      coveragePixels: 840000,
      duplicateGroup: null,
      id: 'front',
      islandRefs: [{ meshName: 'Cloth_mesh_7' }],
      label: '正片',
      mappedTriangles: 128,
      mirrorX: false,
      order: 0,
      outputBounds: { x: 192, y: 192, width: 1600, height: 3600 },
      rotation: 0,
      scale: 1.5,
      sourceBounds: { x: 100, y: 200, width: 1067, height: 2400 },
      sourceMeshes: ['Cloth_mesh_7'],
      zone: 'front',
    }],
    width: 4096,
  };
}
