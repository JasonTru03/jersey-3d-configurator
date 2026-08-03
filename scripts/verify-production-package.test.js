import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createProductionBundle } from '../src/features/configurator/designs/productionBundle.js';
import {
  readPngSize,
  readStoreOnlyZip,
  verifyProductionPackageBytes,
} from './verify-production-package.mjs';

const ARTIFACT_NAMES = [
  'design.json',
  'uv-atlas.png',
  'uv-pattern-pieces.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
];
const COMPRESSED_SCANLINE_CACHE = new Map();

describe('verifyProductionPackageBytes', () => {
  it('accepts the exact seven-file package with matching hashes and dimensions', async () => {
    const packageBytes = await createPackageBytes();

    expect(verifyProductionPackageBytes(packageBytes)).toEqual({
      atlas: { width: 4096, height: 4096 },
      designFingerprint: '12ab34cd',
      entries: [
        ...ARTIFACT_NAMES,
        'manifest.json',
      ],
      pdfPages: 2,
    });
  });

  it('rejects a production artifact whose bytes do not match the manifest', async () => {
    const packageBytes = await createPackageBytes({ corruptAtlasHash: true });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'uv-atlas.png SHA-256 does not match manifest.json',
    );
  });

  it('rejects a package missing uv-pattern-pieces.png', async () => {
    const packageBytes = await createPackageBytes({ omitArtifact: 'uv-pattern-pieces.png' });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'ZIP entries must be exactly: design.json, uv-atlas.png, uv-pattern-pieces.png, uv-reference.pdf, preview-front.png, preview-back.png, manifest.json',
    );
  });

  it('rejects an empty uv-pattern-pieces.png', async () => {
    const packageBytes = await createPackageBytes({ emptyPatternPieces: true });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'uv-pattern-pieces.png byte length does not match manifest.json',
    );
  });

  it('rejects an invalid uv-pattern-pieces.png PNG header', async () => {
    const packageBytes = await createPackageBytes({ patternPiecesPng: new Uint8Array([0]) });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow('Invalid PNG header');
  });

  it.each([
    ['a truncated IHDR chunk', () => createTruncatedPngHeader(2, 2)],
    ['an IHDR length other than 13', () => createMinimalPng(2, 2, {
      ihdrLength: 12,
    })],
    ['a missing IDAT chunk', () => createMinimalPng(2, 2, {
      includeIdat: false,
    })],
    ['an empty IDAT chunk', () => createMinimalPng(2, 2, {
      idatData: new Uint8Array(),
    })],
    ['a missing IEND chunk', () => createMinimalPng(2, 2, {
      includeIend: false,
    })],
    ['a truncated later chunk', () => createPngWithTruncatedIdat(2, 2)],
    ['bytes after IEND', () => concatenateBytes(createMinimalPng(2, 2), [1])],
  ])('rejects uv-pattern-pieces.png with %s', async (_label, createPng) => {
    expect(() => readPngSize(createPng())).toThrow('Invalid PNG structure');
  });

  it.each([
    ['an invalid IHDR CRC', () => createMinimalPng(2, 2, {
      corruptIhdrCrc: true,
    })],
    ['an invalid IEND CRC', () => createMinimalPng(2, 2, {
      corruptIendCrc: true,
    })],
    ['bit depth zero', () => createMinimalPng(2, 2, { bitDepth: 0 })],
    ['a nonstandard compression method', () => createMinimalPng(2, 2, {
      compression: 1,
    })],
    ['non-zlib IDAT data', () => createMinimalPng(2, 2, {
      idatData: new Uint8Array([1, 2, 3]),
    })],
    ['a decompressed scanline length mismatch', () => createMinimalPng(2, 2, {
      rawScanlines: new Uint8Array([0]),
    })],
    ['an invalid scanline filter byte', () => createMinimalPng(2, 2, {
      scanlineFilter: 5,
    })],
  ])('rejects uv-pattern-pieces.png with %s', async (_label, createPng) => {
    expect(() => readPngSize(createPng())).toThrow('Invalid PNG structure');
  });

  it('rejects uv-pattern-pieces.png whose bytes do not match the manifest', async () => {
    const packageBytes = await createPackageBytes({ corruptPatternPiecesHash: true });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'uv-pattern-pieces.png SHA-256 does not match manifest.json',
    );
  });

  it('rejects a non-4096 uv-pattern-pieces.png', async () => {
    const packageBytes = await createPackageBytes({
      patternPiecesPng: createMinimalPng(2048, 4096),
    });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'uv-pattern-pieces.png must be 4096x4096; received 2048x4096',
    );
  });

  it('rejects pattern piece dimensions that do not match the atlas declaration', async () => {
    const packageBytes = await createPackageBytes({
      mutateManifest: (manifest) => ({
        ...manifest,
        patternPieces: { ...manifest.patternPieces, width: 2048 },
      }),
    });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'manifest.json patternPieces is invalid',
    );
  });

  it.each([
    ['missing metadata', (manifest) => ({ ...manifest, patternPieces: null })],
    ['an empty piece list', (manifest) => ({
      ...manifest,
      patternPieces: { ...manifest.patternPieces, pieces: [] },
    })],
    ['an incomplete front/back pair', (manifest) => ({
      ...manifest,
      patternPieces: {
        ...manifest.patternPieces,
        pieces: manifest.patternPieces.pieces.filter(({ id }) => id !== 'back'),
      },
    })],
    ['duplicate piece ids', (manifest) => ({
      ...manifest,
      patternPieces: {
        ...manifest.patternPieces,
        pieces: manifest.patternPieces.pieces.map((piece) => ({ ...piece, id: 'front' })),
      },
    })],
    ['zero mapped triangles', (manifest) => withFirstPiece(manifest, { mappedTriangles: 0 })],
    ['missing source meshes', (manifest) => withFirstPiece(manifest, { sourceMeshes: [] })],
    ['an empty source bound', (manifest) => withFirstPiece(manifest, {
      sourceBounds: { x: 100, y: 200, width: 0, height: 2400 },
    })],
    ['an out-of-bounds output declaration', (manifest) => withFirstPiece(manifest, {
      outputBounds: { x: 4000, y: 192, width: 1600, height: 3600 },
    })],
    ['a missing label', (manifest) => withFirstPiece(manifest, { label: undefined })],
    ['a missing zone', (manifest) => withFirstPiece(manifest, { zone: undefined })],
    ['a missing order', (manifest) => withFirstPiece(manifest, { order: undefined })],
    ['missing island refs', (manifest) => withFirstPiece(manifest, { islandRefs: undefined })],
    ['a missing scale', (manifest) => withFirstPiece(manifest, { scale: undefined })],
    ['missing coverage pixels', (manifest) => withFirstPiece(manifest, {
      coveragePixels: undefined,
    })],
    ['missing aliases', (manifest) => withFirstPiece(manifest, { aliases: undefined })],
    ['a missing duplicate group', (manifest) => withFirstPiece(manifest, {
      duplicateGroup: undefined,
    })],
    ['source meshes that do not match island refs', (manifest) => withFirstPiece(manifest, {
      sourceMeshes: ['Other_mesh'],
    })],
    ['duplicate piece orders', (manifest) => withFirstPiece(manifest, { order: 1 })],
  ])('rejects %s for UV pattern pieces', async (_label, mutateManifest) => {
    const packageBytes = await createPackageBytes({ mutateManifest });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'manifest.json patternPieces is invalid',
    );
  });

  it('rejects invalid piece declarations before decoding PNG payloads', async () => {
    const packageBytes = await createPackageBytes({
      atlasPng: new Uint8Array([0]),
      mutateManifest: (manifest) => withFirstPiece(manifest, { label: undefined }),
    });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'manifest.json patternPieces is invalid',
    );
  });
});

async function createPackageBytes({
  atlasPng = createMinimalPng(4096, 4096),
  corruptAtlasHash = false,
  corruptPatternPiecesHash = false,
  emptyPatternPieces = false,
  mutateManifest = (manifest) => manifest,
  omitArtifact = null,
  patternPiecesPng = createMinimalPng(4096, 4096),
} = {}) {
  const artifacts = [
    file('design.json', '{"schemaVersion":1}', 'application/json'),
    {
      blob: new Blob([atlasPng], { type: 'image/png' }),
      filename: 'uv-atlas.png',
    },
    {
      blob: new Blob([patternPiecesPng], { type: 'image/png' }),
      filename: 'uv-pattern-pieces.png',
    },
    file(
      'uv-reference.pdf',
      '%PDF-1.7\n1 0 obj <</Type /Page>> endobj\n2 0 obj <</Type /Page>> endobj\n',
      'application/pdf',
    ),
    {
      blob: new Blob([createMinimalPng(1600, 1600)], { type: 'image/png' }),
      filename: 'preview-front.png',
    },
    {
      blob: new Blob([createMinimalPng(1600, 1600)], { type: 'image/png' }),
      filename: 'preview-back.png',
    },
  ];
  const records = [];
  for (const artifact of artifacts) {
    records.push({
      name: artifact.filename,
      mediaType: artifact.blob.type,
      byteLength: artifact.blob.size,
      sha256: sha256(await artifact.blob.arrayBuffer()),
    });
  }
  if (corruptAtlasHash) {
    records.find(({ name }) => name === 'uv-atlas.png').sha256 = '0'.repeat(64);
  }
  if (corruptPatternPiecesHash) {
    records.find(({ name }) => name === 'uv-pattern-pieces.png').sha256 = '0'.repeat(64);
  }
  const manifest = mutateManifest({
    designFingerprint: '12ab34cd',
    atlas: { width: 4096, height: 4096 },
    patternPieces: createPatternPieces(),
    files: records,
  });
  const bundle = await createProductionBundle({
    files: [
      ...artifacts,
      file('manifest.json', JSON.stringify(manifest), 'application/json'),
    ],
    fingerprint: manifest.designFingerprint,
    productId: 'fn8788-jersey',
  });
  const packageBytes = new Uint8Array(await bundle.blob.arrayBuffer());
  if (!omitArtifact && !emptyPatternPieces) return packageBytes;

  const entries = readStoreOnlyZip(packageBytes);
  if (omitArtifact) entries.delete(omitArtifact);
  if (emptyPatternPieces) entries.set('uv-pattern-pieces.png', new Uint8Array());
  return createStoreOnlyZip(entries);
}

function createPatternPieces() {
  return {
    height: 4096,
    layoutFingerprint: 'uv-pieces-v1-12ab34cd',
    pieces: [
      createPiece(),
      createPiece({
        id: 'back',
        label: '背片',
        meshName: 'Cloth_mesh_4',
        order: 1,
        outputBounds: { x: 2200, y: 192, width: 1600, height: 3600 },
        sourceBounds: { x: 2200, y: 200, width: 1067, height: 2400 },
      }),
    ],
    width: 4096,
  };
}

function createPiece({
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
    zone: 'body',
  };
}

function withFirstPiece(manifest, patch) {
  return {
    ...manifest,
    patternPieces: {
      ...manifest.patternPieces,
      pieces: manifest.patternPieces.pieces.map((piece, index) => (
        index ? piece : { ...piece, ...patch }
      )),
    },
  };
}

function createStoreOnlyZip(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  let byteLength = 4;
  for (const [name, bytes] of entries) {
    const filename = encoder.encode(name);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint32(18, bytes.byteLength, true);
    view.setUint32(22, bytes.byteLength, true);
    view.setUint16(26, filename.byteLength, true);
    parts.push(header, filename, bytes);
    byteLength += header.byteLength + filename.byteLength + bytes.byteLength;
  }
  parts.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02]));

  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function file(filename, contents, type) {
  return {
    blob: new Blob([contents], { type }),
    filename,
  };
}

function createMinimalPng(width, height, {
  bitDepth = 8,
  colorType = 6,
  compression = 0,
  corruptIendCrc = false,
  corruptIhdrCrc = false,
  filter = 0,
  idatData,
  ihdrLength = 13,
  includeIdat = true,
  includeIend = true,
  interlace = 0,
  rawScanlines,
  scanlineFilter = 0,
} = {}) {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([bitDepth, colorType, compression, filter, interlace], 8);
  const chunks = [createPngChunk('IHDR', ihdr, ihdrLength, true, corruptIhdrCrc)];
  if (includeIdat) {
    const compressed = idatData === undefined
      ? rawScanlines === undefined
        ? createCompressedRgbaScanlines(width, height, scanlineFilter)
        : deflateSync(rawScanlines)
      : idatData;
    chunks.push(createPngChunk('IDAT', compressed));
  }
  if (includeIend) {
    chunks.push(createPngChunk('IEND', new Uint8Array(), 0, true, corruptIendCrc));
  }
  return concatenateBytes([137, 80, 78, 71, 13, 10, 26, 10], ...chunks);
}

function createTruncatedPngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function createPngWithTruncatedIdat(width, height) {
  const validPrefix = createMinimalPng(width, height, {
    includeIdat: false,
    includeIend: false,
  });
  return concatenateBytes(validPrefix, createPngChunk('IDAT', [1], 5, false));
}

function createPngChunk(
  type,
  data,
  declaredLength = data.length,
  includeCrc = true,
  corruptCrc = false,
) {
  const bytes = new Uint8Array(8 + data.length + (includeCrc ? 4 : 0));
  const view = new DataView(bytes.buffer);
  const typeBytes = new TextEncoder().encode(type);
  view.setUint32(0, declaredLength);
  bytes.set(typeBytes, 4);
  bytes.set(data, 8);
  if (includeCrc) {
    const checksum = crc32(concatenateBytes(typeBytes, data));
    view.setUint32(8 + data.length, corruptCrc ? checksum ^ 1 : checksum);
  }
  return bytes;
}

function createRgbaScanlines(width, height, filterByte) {
  const rowLength = width * 4 + 1;
  const bytes = new Uint8Array(rowLength * height);
  for (let row = 0; row < height; row += 1) {
    bytes[row * rowLength] = filterByte;
  }
  return bytes;
}

function createCompressedRgbaScanlines(width, height, filterByte) {
  const key = `${width}x${height}:${filterByte}`;
  if (!COMPRESSED_SCANLINE_CACHE.has(key)) {
    COMPRESSED_SCANLINE_CACHE.set(
      key,
      deflateSync(createRgbaScanlines(width, height, filterByte)),
    );
  }
  return COMPRESSED_SCANLINE_CACHE.get(key);
}

function concatenateBytes(...parts) {
  const arrays = parts.map((part) => (
    part instanceof Uint8Array ? part : new Uint8Array(part)
  ));
  const output = new Uint8Array(arrays.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of arrays) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}
