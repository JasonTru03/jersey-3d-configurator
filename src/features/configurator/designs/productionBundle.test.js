import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createProductionBundle,
  createStreamingProductionBundle,
} from './productionBundle.js';
import { MAX_PRODUCTION_PACKAGE_BYTES } from './productionManifest.js';

const ZIP_NAMES = [
  'design.json',
  'uv-atlas.png',
  'uv-pattern-pieces.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
  'manifest.json',
];
const MEBIBYTE = 1024 * 1024;
let originalBlobStream;

beforeAll(() => {
  originalBlobStream = Object.getOwnPropertyDescriptor(Blob.prototype, 'stream');
  if (!originalBlobStream) installBlobStreamPolyfill();
});

afterAll(() => {
  if (originalBlobStream) Object.defineProperty(Blob.prototype, 'stream', originalBlobStream);
  else delete Blob.prototype.stream;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const createFiles = () => ZIP_NAMES.map((filename) => ({
  blob: new Blob([filename]),
  filename,
}));

describe('createProductionBundle', () => {
  it('keeps the browser Blob API while packaging the ordered seven-file contract', async () => {
    const result = await createProductionBundle({
      files: createFiles(),
      fingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
    });

    expect(result.filename).toBe('fn8788-jersey-design-12ab34cd.zip');
    expect(result.blob.type).toBe('application/zip');
    const entries = readZipEntries(new Uint8Array(await result.blob.arrayBuffer()));
    expect(entries.map(({ name }) => name)).toEqual(ZIP_NAMES);
    expect(entries.map(({ body }) => new TextDecoder().decode(body))).toEqual(ZIP_NAMES);
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

describe('createStreamingProductionBundle', () => {
  it('rejects a Worker input without Blob.stream instead of silently buffering it', () => {
    const files = createFiles();
    Object.defineProperty(files[0].blob, 'stream', { value: undefined });

    expect(() => createStreamingProductionBundle({
      files,
      fingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
    })).toThrow('生产 ZIP 文件不支持流式读取。');
  });

  it('returns an R2-consumable lazy Web Stream with exact content length', async () => {
    const files = createFiles();
    const arrayBufferSpy = vi.spyOn(Blob.prototype, 'arrayBuffer');
    const streamSpy = vi.spyOn(Blob.prototype, 'stream');

    const result = createStreamingProductionBundle({
      files,
      fingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
    });

    expect(result).toMatchObject({
      byteLength: expect.any(Number),
      contentLength: expect.any(Number),
      filename: 'fn8788-jersey-design-12ab34cd.zip',
      mediaType: 'application/zip',
      stream: expect.any(ReadableStream),
    });
    expect(result.byteLength).toBe(result.contentLength);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(streamSpy).not.toHaveBeenCalled();

    const reader = result.stream.getReader();
    const first = await reader.read();
    expect(Array.from(first.value.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(streamSpy).not.toHaveBeenCalled();
    await reader.read();
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    await reader.cancel();
  });

  it('streams a valid STORE ZIP with descriptors, ordered names, and exact contents', async () => {
    const result = createStreamingProductionBundle({
      files: createFiles(),
      fingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
    });
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    const entries = readZipEntries(bytes);

    expect(bytes.byteLength).toBe(result.contentLength);
    expect(entries.map(({ name }) => name)).toEqual(ZIP_NAMES);
    expect(entries.map(({ body }) => new TextDecoder().decode(body))).toEqual(ZIP_NAMES);
    expect(entries.every(({ flags, method }) => (
      flags === 0x0808 && method === 0
    ))).toBe(true);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(entries.every(({ body, checksum, descriptor }) => (
      checksum === crc32(body)
      && descriptor.signature === 0x08074b50
      && descriptor.checksum === checksum
      && descriptor.compressedSize === body.byteLength
      && descriptor.uncompressedSize === body.byteLength
    ))).toBe(true);
  });

  it('creates repeatable independent streams with byte-for-byte identical ZIP data', async () => {
    const result = createStreamingProductionBundle({
      files: createFiles(),
      fingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
    });

    expect(result.createStream).toEqual(expect.any(Function));
    const first = new Uint8Array(await new Response(result.createStream()).arrayBuffer());
    const second = new Uint8Array(await new Response(result.createStream()).arrayBuffer());
    const original = new Uint8Array(await new Response(result.stream).arrayBuffer());

    expect(first).toEqual(second);
    expect(original).toEqual(first);
    expect(first.byteLength).toBe(result.contentLength);
  });

  it('constructs the exact shared package boundary without reading or preallocating a full ZIP', () => {
    const oneMiB = new Blob([new Uint8Array(MEBIBYTE)]);
    const sizes = [4, 8, 8, 4, 4, 3, 1];
    const files = ZIP_NAMES.map((filename, index) => ({
      blob: new Blob(Array(sizes[index]).fill(oneMiB)),
      filename,
    }));
    const arrayBufferSpy = vi.spyOn(Blob.prototype, 'arrayBuffer');
    const streamSpy = vi.spyOn(Blob.prototype, 'stream');

    const result = createStreamingProductionBundle({
      files,
      fingerprint: '12ab34cd',
      productId: 'fn8788-jersey',
    });

    expect(MAX_PRODUCTION_PACKAGE_BYTES).toBe(32 * MEBIBYTE);
    expect(files.reduce((total, file) => total + file.blob.size, 0))
      .toBe(MAX_PRODUCTION_PACKAGE_BYTES);
    expect(result.contentLength).toBeGreaterThan(MAX_PRODUCTION_PACKAGE_BYTES);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(streamSpy).not.toHaveBeenCalled();
  });
});

function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const bodyOffset = localOffset + 30 + localNameLength + localExtraLength;
    const descriptorOffset = bodyOffset + size;
    entries.push({
      body: bytes.slice(bodyOffset, bodyOffset + size),
      checksum,
      descriptor: {
        checksum: view.getUint32(descriptorOffset + 4, true),
        compressedSize: view.getUint32(descriptorOffset + 8, true),
        signature: view.getUint32(descriptorOffset, true),
        uncompressedSize: view.getUint32(descriptorOffset + 12, true),
      },
      flags,
      method,
      name: new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength)),
    });
    offset += 45 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function installBlobStreamPolyfill() {
  Object.defineProperty(Blob.prototype, 'stream', {
    configurable: true,
    value() {
      const blob = this;
      return new ReadableStream({
        start(controller) {
          const reader = new FileReader();
          reader.addEventListener('load', () => {
            controller.enqueue(new Uint8Array(reader.result));
            controller.close();
          });
          reader.addEventListener('error', () => controller.error(reader.error));
          reader.readAsArrayBuffer(blob);
        },
      });
    },
  });
}
