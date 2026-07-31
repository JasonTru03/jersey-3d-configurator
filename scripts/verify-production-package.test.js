import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProductionBundle } from '../src/features/configurator/designs/productionBundle.js';
import { verifyProductionPackageBytes } from './verify-production-package.mjs';

const ARTIFACT_NAMES = [
  'design.json',
  'uv-atlas.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
];

describe('verifyProductionPackageBytes', () => {
  it('accepts the exact six-file package with matching hashes and dimensions', async () => {
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
});

async function createPackageBytes({ corruptAtlasHash = false } = {}) {
  const artifacts = [
    file('design.json', '{"schemaVersion":1}', 'application/json'),
    {
      blob: new Blob([createPngHeader(4096, 4096)], { type: 'image/png' }),
      filename: 'uv-atlas.png',
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
  if (corruptAtlasHash) records[1].sha256 = '0'.repeat(64);
  const manifest = {
    designFingerprint: '12ab34cd',
    atlas: { width: 4096, height: 4096 },
    files: records,
  };
  const bundle = await createProductionBundle({
    files: [
      ...artifacts,
      file('manifest.json', JSON.stringify(manifest), 'application/json'),
    ],
    fingerprint: manifest.designFingerprint,
    productId: 'fn8788-jersey',
  });
  return new Uint8Array(await bundle.blob.arrayBuffer());
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
