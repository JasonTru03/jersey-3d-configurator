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
  artifact('uv-atlas.png', createMinimalPngBytes(4096, 4096), 'image/png'),
  artifact('uv-pattern-pieces.png', createMinimalPngBytes(4096, 4096), 'image/png'),
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
  uvExportVersion: '2',
  variantId: null,
});

const INVALID_UV_EXPORT_VERSIONS = [
  ['missing', undefined],
  ['version 1', '1'],
  ['numeric version 2', 2],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('production manifest', () => {
  it('records both PNG contracts, piece metadata, and hashes for all six artifacts', async () => {
    const files = createFiles();
    const manifest = await createProductionManifest(manifestInput(files));

    expect(manifest).toMatchObject({
      schemaVersion: 2,
      designFingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
      variantId: null,
      size: 'm',
      model: { id: 'chelsea-jersey', version: '1' },
      uvExportVersion: '2',
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

  it.each([
    ['missing', (manifest) => {
      delete manifest.schemaVersion;
    }],
    ['version 1', (manifest) => {
      manifest.schemaVersion = 1;
    }],
    ['string version 2', (manifest) => {
      manifest.schemaVersion = '2';
    }],
  ])('rejects a %s schema before image verification', async (_label, mutate) => {
    const files = createFiles();
    const manifest = await createProductionManifest(manifestInput(files));
    mutate(manifest);
    files[1] = artifact('uv-atlas.png', new Uint8Array([0]), 'image/png');

    await expect(verifyProductionArtifacts(files, manifest))
      .rejects.toThrow('生产清单 Schema 无效：schemaVersion 必须为 2。');
  });

  it.each(INVALID_UV_EXPORT_VERSIONS)(
    'rejects %s uvExportVersion while creating a manifest',
    async (_label, uvExportVersion) => {
      const files = createFiles();
      const input = manifestInput(files);
      if (uvExportVersion === undefined) delete input.uvExportVersion;
      else input.uvExportVersion = uvExportVersion;
      files[1] = artifact('uv-atlas.png', new Uint8Array([0]), 'image/png');

      await expect(createProductionManifest(input)).rejects.toThrow(
        '生产清单 UV 导出版本无效：uvExportVersion 必须为 "2"。',
      );
    },
  );

  it.each(INVALID_UV_EXPORT_VERSIONS)(
    'rejects %s uvExportVersion before artifact verification',
    async (_label, uvExportVersion) => {
      const files = createFiles();
      const manifest = await createProductionManifest(manifestInput(files));
      if (uvExportVersion === undefined) delete manifest.uvExportVersion;
      else manifest.uvExportVersion = uvExportVersion;
      files[1] = artifact('uv-atlas.png', new Uint8Array([0]), 'image/png');

      await expect(verifyProductionArtifacts(files, manifest)).rejects.toThrow(
        '生产清单 UV 导出版本无效：uvExportVersion 必须为 "2"。',
      );
    },
  );

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
    [
      'non-PNG bytes',
      'uv-atlas.png',
      new TextEncoder().encode('not a png'),
      '生产文件 "uv-atlas.png" 不是有效 PNG。',
    ],
    [
      'a truncated PNG',
      'uv-pattern-pieces.png',
      createMinimalPngBytes(4096, 4096).slice(0, 16),
      '生产文件 "uv-pattern-pieces.png" 的 PNG 数据不完整。',
    ],
    [
      'a PNG whose first chunk is not IHDR',
      'uv-atlas.png',
      createMinimalPngBytes(4096, 4096, [73, 68, 65, 84]),
      '生产文件 "uv-atlas.png" 不是有效 PNG。',
    ],
    [
      'actual dimensions that differ from the manifest',
      'uv-atlas.png',
      createMinimalPngBytes(1, 1),
      '生产文件 "uv-atlas.png" 的实际尺寸 1×1 与声明的 4096×4096 不一致。',
    ],
  ])('rejects %s', async (_label, name, body, message) => {
    const files = createFiles().map((file) => (
      file.name === name ? artifact(name, body, 'image/png') : file
    ));

    await expect(createProductionManifest(manifestInput(files)))
      .rejects.toThrow(message);
  });

  it('reads PNG dimensions again while verifying artifacts', async () => {
    const files = createFiles();
    const manifest = await createProductionManifest(manifestInput(files));
    const replacement = artifact(
      'uv-pattern-pieces.png',
      createMinimalPngBytes(1, 1),
      'image/png',
    );
    files[2] = replacement;
    manifest.files[2] = {
      ...manifest.files[2],
      byteLength: replacement.blob.size,
      sha256: await sha256Hex(replacement.blob),
    };

    await expect(verifyProductionArtifacts(files, manifest)).rejects.toThrow(
      '生产文件 "uv-pattern-pieces.png" 的实际尺寸 1×1 与声明的 4096×4096 不一致。',
    );
  });

  it.each([
    [
      'extra uncloneable fields',
      { rotation: 180, mirrorX: true, extra: () => 'ignored' },
    ],
    [
      'a null prototype',
      Object.assign(Object.create(null), { rotation: 180, mirrorX: true }),
    ],
  ])('normalizes output transforms with %s', async (_label, outputTransform) => {
    const files = createFiles();
    const input = manifestInput(files);
    input.patternPieces.outputTransform = outputTransform;

    const manifest = await createProductionManifest(input);

    expect(manifest.patternPieces.outputTransform).toEqual({
      rotation: 180,
      mirrorX: true,
    });
    expect(Object.getPrototypeOf(manifest.patternPieces.outputTransform))
      .toBe(Object.prototype);
    expect(Object.keys(manifest.patternPieces.outputTransform).sort())
      .toEqual(['mirrorX', 'rotation']);
  });

  it.each([
    ['missing metadata', (input) => ({ ...input, patternPieces: null })],
    ['missing output transform', (input) => ({
      ...input,
      patternPieces: { ...input.patternPieces, outputTransform: undefined },
    })],
    ['an unsupported output rotation', (input) => ({
      ...input,
      patternPieces: {
        ...input.patternPieces,
        outputTransform: { ...input.patternPieces.outputTransform, rotation: 45 },
      },
    })],
    ['a non-boolean output mirror flag', (input) => ({
      ...input,
      patternPieces: {
        ...input.patternPieces,
        outputTransform: { ...input.patternPieces.outputTransform, mirrorX: 'true' },
      },
    })],
    ['inherited output transform fields', (input) => ({
      ...input,
      patternPieces: {
        ...input.patternPieces,
        outputTransform: Object.create({ rotation: 180, mirrorX: true }),
      },
    })],
    ['accessor output transform fields', (input) => ({
      ...input,
      patternPieces: {
        ...input.patternPieces,
        outputTransform: Object.defineProperties({}, {
          rotation: {
            enumerable: true,
            get() {
              throw new Error('rotation getter must not run');
            },
          },
          mirrorX: {
            enumerable: true,
            get() {
              throw new Error('mirrorX getter must not run');
            },
          },
        }),
      },
    })],
    ['empty piece list', (input) => ({
      ...input,
      patternPieces: { ...input.patternPieces, pieces: [] },
    })],
    ['mismatched dimensions', (input) => ({
      ...input,
      patternPieces: { ...input.patternPieces, width: 2048 },
    })],
    ['a blank layout fingerprint', (input) => ({
      ...input,
      patternPieces: { ...input.patternPieces, layoutFingerprint: '   ' },
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
    ['duplicate ids', (input) => ({
      ...input,
      patternPieces: {
        ...input.patternPieces,
        pieces: input.patternPieces.pieces.map((piece, index) => (
          index ? { ...piece, id: input.patternPieces.pieces[0].id } : piece
        )),
      },
    })],
    ['duplicate orders', (input) => ({
      ...input,
      patternPieces: {
        ...input.patternPieces,
        pieces: input.patternPieces.pieces.map((piece, index) => (
          index ? { ...piece, order: input.patternPieces.pieces[0].order } : piece
        )),
      },
    })],
    ['a blank id', (input) => withFirstPiece(input, { id: '   ' })],
    ['a blank label', (input) => withFirstPiece(input, { label: '   ' })],
    ['a blank zone', (input) => withFirstPiece(input, { zone: '   ' })],
    ['a blank source group', (input) => withFirstPiece(input, {
      islandRefs: [{ meshName: '   ' }],
      sourceMeshes: ['   '],
    })],
    ['non-array island refs', (input) => withFirstPiece(input, {
      islandRefs: {},
    })],
    ['a blank duplicate group', (input) => withFirstPiece(input, {
      duplicateGroup: '   ',
    })],
    ['a blank alias', (input) => withFirstPiece(input, {
      aliases: ['   '],
    })],
    ['a missing front/back pair', (input) => ({
      ...input,
      patternPieces: {
        ...input.patternPieces,
        pieces: input.patternPieces.pieces.filter(({ id }) => id !== 'back'),
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
    outputTransform: { rotation: 180, mirrorX: true },
    pieces: [createPieceMetadata(), createPieceMetadata({
      id: 'back',
      label: '背片',
      meshName: 'Cloth_mesh_4',
      order: 1,
      outputBounds: { x: 2200, y: 192, width: 1600, height: 3600 },
      sourceBounds: { x: 1200, y: 200, width: 1067, height: 2400 },
    })],
    width: 4096,
  };
}

function createPieceMetadata({
  id = 'front',
  label = '正片',
  meshName = 'Cloth_mesh_7',
  order = 0,
  outputBounds = { x: 192, y: 192, width: 1600, height: 3600 },
  sourceBounds = { x: 100, y: 200, width: 1067, height: 2400 },
} = {}) {
  return {
      aliases: [],
      coveragePixels: 840000,
      duplicateGroup: null,
      id,
      islandRefs: [{ meshName }],
      label,
      mappedTriangles: 128,
      mirrorX: false,
      order,
      outputBounds,
      rotation: 0,
      scale: 1.5,
      sourceBounds,
      sourceMeshes: [meshName],
      zone: 'front',
  };
}

function withFirstPiece(input, patch) {
  return {
    ...input,
    patternPieces: {
      ...input.patternPieces,
      pieces: input.patternPieces.pieces.map((piece, index) => (
        index ? piece : { ...piece, ...patch }
      )),
    },
  };
}

function createMinimalPngBytes(width, height, chunkType = [73, 72, 68, 82]) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, ...chunkType], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
