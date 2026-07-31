import { describe, expect, it } from 'vitest';
import { createProductionBundle } from './productionBundle.js';

const ZIP_NAMES = [
  'design.json',
  'uv-atlas.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
  'manifest.json',
];

const createFiles = () => ZIP_NAMES.map((filename) => ({
  blob: new Blob([filename]),
  filename,
}));

describe('createProductionBundle', () => {
  it('packages exactly the ordered six-file production contract', async () => {
    const result = await createProductionBundle({
      files: createFiles(),
      fingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
    });

    expect(result.filename).toBe('fn8788-jersey-design-12ab34cd.zip');
    expect(result.blob.type).toBe('application/zip');

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(readCentralNames(bytes)).toEqual(ZIP_NAMES);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(bytes.slice(-22, -18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it.each([
    ['missing', (files) => files.slice(0, -1)],
    ['renamed', (files) => files.map((file, index) => (
      index === 1 ? { ...file, filename: 'renamed.png' } : file
    ))],
    ['duplicate', (files) => files.map((file, index) => (
      index === 1 ? { ...file, filename: 'design.json' } : file
    ))],
  ])('rejects a %s entry list', async (_label, mutate) => {
    await expect(createProductionBundle({
      files: mutate(createFiles()),
      fingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
    })).rejects.toThrow('生产 ZIP 文件列表不完整或顺序不正确。');
  });

  it('rejects an empty entry', async () => {
    const files = createFiles();
    files[2] = { ...files[2], blob: new Blob([]) };

    await expect(createProductionBundle({
      files,
      fingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
    })).rejects.toThrow('生产 ZIP 中存在缺失或空文件。');
  });
});

function readCentralNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names = [];
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    names.push(new TextDecoder().decode(bytes.slice(
      offset + 46,
      offset + 46 + nameLength,
    )));
    offset += 45 + nameLength;
  }
  return names;
}
