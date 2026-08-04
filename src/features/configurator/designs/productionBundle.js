import { createProductionFilename } from './productionFingerprint.js';
import { PRODUCTION_PACKAGE_FILE_CONTRACT } from './productionManifest.js';

const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
const ZIP_FLAGS = DATA_DESCRIPTOR_FLAG | UTF8_FLAG;
const STORE_METHOD = 0;
const ZIP_MEDIA_TYPE = 'application/zip';
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const ZIP_NAMES = Object.freeze(
  PRODUCTION_PACKAGE_FILE_CONTRACT.map(({ filename }) => filename),
);
const CRC32_TABLE = createCrc32Table();

export async function createProductionBundle({ files, fingerprint, productId }) {
  const entries = snapshotEntries(files, { requireStreaming: false });
  if (!PRODUCT_ID_PATTERN.test(productId)) throw new Error('产品 ID 无效。');
  const filename = createProductionFilename(productId, fingerprint);
  const bufferedEntries = [];
  for (const entry of entries) {
    bufferedEntries.push({
      bytes: new Uint8Array(await entry.blob.arrayBuffer()),
      name: entry.name,
    });
  }
  return {
    blob: new Blob(
      [createBufferedStoreOnlyZip(bufferedEntries, toDosDateTime(new Date()))],
      { type: ZIP_MEDIA_TYPE },
    ),
    filename,
  };
}

export function createStreamingProductionBundle({ files, fingerprint, productId }) {
  const entries = snapshotEntries(files, { requireStreaming: true });
  if (!PRODUCT_ID_PATTERN.test(productId)) throw new Error('产品 ID 无效。');
  const filename = createProductionFilename(productId, fingerprint);
  const timestamp = toDosDateTime(new Date());
  const contentLength = calculateZipLength(entries);
  const iterator = streamStoreOnlyZip(entries, timestamp);
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await iterator.return(reason);
    },
  });

  return Object.freeze({
    byteLength: contentLength,
    contentLength,
    filename,
    mediaType: ZIP_MEDIA_TYPE,
    stream,
  });
}

function snapshotEntries(files, { requireStreaming }) {
  if (
    !Array.isArray(files)
    || JSON.stringify(files.map((file) => file?.filename)) !== JSON.stringify(ZIP_NAMES)
  ) {
    throw new Error('生产 ZIP 文件列表不完整或顺序不正确。');
  }
  return files.map((file) => {
    if (!(file.blob instanceof Blob) || file.blob.size === 0) {
      throw new Error('生产 ZIP 中存在缺失或空文件。');
    }
    if (requireStreaming && typeof file.blob.stream !== 'function') {
      throw new Error('生产 ZIP 文件不支持流式读取。');
    }
    return Object.freeze({
      blob: file.blob,
      name: new TextEncoder().encode(file.filename),
      size: file.blob.size,
    });
  });
}

async function* streamStoreOnlyZip(entries, timestamp) {
  const centralEntries = [];
  let offset = 0;

  for (const entry of entries) {
    const localHeader = createLocalHeader(entry.name, timestamp);
    yield localHeader;
    const localOffset = offset;
    offset += localHeader.length;

    let crc = 0xffffffff;
    let streamedBytes = 0;
    const reader = entry.blob.stream().getReader();
    let completed = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          completed = true;
          break;
        }
        const chunk = toUint8Array(value);
        streamedBytes += chunk.byteLength;
        if (streamedBytes > entry.size) throw new Error('生产 ZIP 文件流长度无效。');
        crc = updateCrc32(crc, chunk);
        yield chunk;
      }
    } finally {
      if (!completed) await reader.cancel();
      reader.releaseLock();
    }
    if (streamedBytes !== entry.size) throw new Error('生产 ZIP 文件流长度无效。');

    const checksum = (crc ^ 0xffffffff) >>> 0;
    const descriptor = createDataDescriptor(checksum, entry.size);
    yield descriptor;
    centralEntries.push({
      checksum,
      localOffset,
      name: entry.name,
      size: entry.size,
    });
    offset += entry.size + descriptor.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const entry of centralEntries) {
    const centralHeader = createCentralHeader(entry, timestamp);
    centralSize += centralHeader.length;
    yield centralHeader;
  }
  yield createEndRecord(centralEntries.length, centralSize, centralOffset);
}

function createLocalHeader(name, timestamp) {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, ZIP_FLAGS, true);
  view.setUint16(8, STORE_METHOD, true);
  view.setUint16(10, timestamp.time, true);
  view.setUint16(12, timestamp.date, true);
  view.setUint16(26, name.length, true);
  header.set(name, 30);
  return header;
}

function createBufferedStoreOnlyZip(entries, timestamp) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const checksum = (updateCrc32(0xffffffff, entry.bytes) ^ 0xffffffff) >>> 0;
    const localHeader = createBufferedLocalHeader(
      entry.name,
      timestamp,
      checksum,
      entry.bytes.byteLength,
    );
    localParts.push(localHeader, entry.bytes);
    centralParts.push(createCentralHeader({
      checksum,
      localOffset: offset,
      name: entry.name,
      size: entry.bytes.byteLength,
    }, timestamp, UTF8_FLAG));
    offset += localHeader.byteLength + entry.bytes.byteLength;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  return concatenate([
    ...localParts,
    ...centralParts,
    createEndRecord(entries.length, centralSize, offset),
  ]);
}

function createBufferedLocalHeader(name, timestamp, checksum, size) {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, STORE_METHOD, true);
  view.setUint16(10, timestamp.time, true);
  view.setUint16(12, timestamp.date, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  header.set(name, 30);
  return header;
}

function createDataDescriptor(checksum, size) {
  const descriptor = new Uint8Array(16);
  const view = new DataView(descriptor.buffer);
  view.setUint32(0, 0x08074b50, true);
  view.setUint32(4, checksum, true);
  view.setUint32(8, size, true);
  view.setUint32(12, size, true);
  return descriptor;
}

function createCentralHeader(entry, timestamp, flags = ZIP_FLAGS) {
  const header = new Uint8Array(46 + entry.name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, flags, true);
  view.setUint16(10, STORE_METHOD, true);
  view.setUint16(12, timestamp.time, true);
  view.setUint16(14, timestamp.date, true);
  view.setUint32(16, entry.checksum, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint32(42, entry.localOffset, true);
  header.set(entry.name, 46);
  return header;
}

function concatenate(parts) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function createEndRecord(entryCount, centralSize, centralOffset) {
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return end;
}

function calculateZipLength(entries) {
  const payloadBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const nameBytes = entries.reduce((sum, entry) => sum + entry.name.length, 0);
  return payloadBytes
    + entries.length * (30 + 16 + 46)
    + nameBytes * 2
    + 22;
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    table[index] = value >>> 0;
  }
  return table;
}

function updateCrc32(crc, bytes) {
  let next = crc;
  for (const byte of bytes) next = (next >>> 8) ^ CRC32_TABLE[(next ^ byte) & 0xff];
  return next >>> 0;
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('生产 ZIP 文件流返回了无效数据。');
}
