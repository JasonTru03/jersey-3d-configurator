import { createProductionFilename } from './productionFingerprint.js';

const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const ZIP_NAMES = Object.freeze([
  'design.json',
  'uv-atlas.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
  'manifest.json',
]);

export async function createProductionBundle({ files, fingerprint, productId }) {
  if (
    !Array.isArray(files)
    || JSON.stringify(files.map((file) => file?.filename)) !== JSON.stringify(ZIP_NAMES)
  ) {
    throw new Error('生产 ZIP 文件列表不完整或顺序不正确。');
  }
  const filename = createProductionFilename(productId, fingerprint);
  const entries = [];
  for (const file of files) entries.push(await readEntry(file));
  const zip = createStoreOnlyZip(entries);
  return {
    blob: new Blob([zip], { type: 'application/zip' }),
    filename,
  };
}

async function readEntry(file) {
  if (
    !(file?.blob instanceof Blob)
    || file.blob.size === 0
    || typeof file.filename !== 'string'
    || file.filename.length === 0
  ) {
    throw new Error('生产 ZIP 中存在缺失或空文件。');
  }
  return {
    bytes: new Uint8Array(await file.blob.arrayBuffer()),
    name: new TextEncoder().encode(file.filename),
  };
}

function createStoreOnlyZip(entries) {
  const now = toDosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const checksum = crc32(entry.bytes);
    const localHeader = new Uint8Array(30 + entry.name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, UTF8_FLAG, true);
    localView.setUint16(8, STORE_METHOD, true);
    localView.setUint16(10, now.time, true);
    localView.setUint16(12, now.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.bytes.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, entry.name.length, true);
    localHeader.set(entry.name, 30);

    const centralHeader = new Uint8Array(46 + entry.name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, UTF8_FLAG, true);
    centralView.setUint16(10, STORE_METHOD, true);
    centralView.setUint16(12, now.time, true);
    centralView.setUint16(14, now.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.bytes.length, true);
    centralView.setUint32(24, entry.bytes.length, true);
    centralView.setUint16(28, entry.name.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(entry.name, 46);

    localParts.push(localHeader, entry.bytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.bytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return concatenate([...localParts, ...centralParts, end]);
}

function concatenate(parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    result.set(part, cursor);
    cursor += part.length;
  }
  return result;
}

function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
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
