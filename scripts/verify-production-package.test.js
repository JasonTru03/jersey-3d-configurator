import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProductionBundle } from '../src/features/configurator/designs/productionBundle.js';
import {
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

  it('rejects uv-pattern-pieces.png whose bytes do not match the manifest', async () => {
    const packageBytes = await createPackageBytes({ corruptPatternPiecesHash: true });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'uv-pattern-pieces.png SHA-256 does not match manifest.json',
    );
  });

  it('rejects a non-4096 uv-pattern-pieces.png', async () => {
    const packageBytes = await createPackageBytes({
      patternPiecesPng: createPngHeader(2048, 4096),
    });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'uv-pattern-pieces.png must be 4096x4096; received 2048x4096',
    );
  });

  it('rejects pattern piece dimensions that do not match uv-pattern-pieces.png', async () => {
    const packageBytes = await createPackageBytes({
      mutateManifest: (manifest) => ({
        ...manifest,
        patternPieces: { ...manifest.patternPieces, width: 2048 },
      }),
    });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'uv-pattern-pieces.png dimensions do not match manifest.json',
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
  ])('rejects %s for UV pattern pieces', async (_label, mutateManifest) => {
    const packageBytes = await createPackageBytes({ mutateManifest });

    expect(() => verifyProductionPackageBytes(packageBytes)).toThrow(
      'manifest.json patternPieces is invalid',
    );
  });
});

async function createPackageBytes({
  corruptAtlasHash = false,
  corruptPatternPiecesHash = false,
  emptyPatternPieces = false,
  mutateManifest = (manifest) => manifest,
  omitArtifact = null,
  patternPiecesPng = createPngHeader(4096, 4096),
} = {}) {
  const artifacts = [
    file('design.json', '{"schemaVersion":1}', 'application/json'),
    {
      blob: new Blob([createPngHeader(4096, 4096)], { type: 'image/png' }),
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
      blob: new Blob([createPngHeader(1600, 1600)], { type: 'image/png' }),
      filename: 'preview-front.png',
    },
    {
      blob: new Blob([createPngHeader(1600, 1600)], { type: 'image/png' }),
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
        meshName: 'Cloth_mesh_4',
        outputBounds: { x: 2200, y: 192, width: 1600, height: 3600 },
        sourceBounds: { x: 2200, y: 200, width: 1067, height: 2400 },
      }),
    ],
    width: 4096,
  };
}

function createPiece({
  id = 'front',
  meshName = 'Cloth_mesh_7',
  outputBounds = { x: 192, y: 192, width: 1600, height: 3600 },
  sourceBounds = { x: 100, y: 200, width: 1067, height: 2400 },
} = {}) {
  return {
    id,
    mappedTriangles: 128,
    mirrorX: false,
    outputBounds,
    rotation: 0,
    sourceBounds,
    sourceMeshes: [meshName],
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

function createPngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}
