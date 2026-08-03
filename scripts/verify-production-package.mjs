import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ZIP_ENTRY_NAMES = Object.freeze([
  'design.json',
  'uv-atlas.png',
  'uv-pattern-pieces.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
  'manifest.json',
]);
const ARTIFACT_NAMES = Object.freeze(ZIP_ENTRY_NAMES.slice(0, -1));
const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;

export function verifyProductionPackageBytes(bytes) {
  const entries = readStoreOnlyZip(bytes);
  assertExactNames([...entries.keys()], ZIP_ENTRY_NAMES, 'ZIP entries');
  const manifest = readJson(entries.get('manifest.json'), 'manifest.json');
  verifyManifest(entries, manifest);
  readJson(entries.get('design.json'), 'design.json');

  const atlas = readPngSize(entries.get('uv-atlas.png'));
  if (atlas.width !== 4096 || atlas.height !== 4096) {
    throw new Error(`uv-atlas.png must be 4096x4096; received ${atlas.width}x${atlas.height}`);
  }
  if (
    manifest.atlas?.width !== atlas.width
    || manifest.atlas?.height !== atlas.height
  ) {
    throw new Error('uv-atlas.png dimensions do not match manifest.json');
  }

  const patternPieces = readPngSize(entries.get('uv-pattern-pieces.png'));
  if (patternPieces.width !== 4096 || patternPieces.height !== 4096) {
    throw new Error(
      `uv-pattern-pieces.png must be 4096x4096; received ${patternPieces.width}x${patternPieces.height}`,
    );
  }
  verifyPatternPieces(manifest.patternPieces, patternPieces);

  const pdfPages = countPdfPages(entries.get('uv-reference.pdf'));
  if (pdfPages !== 2) {
    throw new Error(`uv-reference.pdf must contain exactly 2 pages; received ${pdfPages}`);
  }

  return {
    atlas,
    designFingerprint: manifest.designFingerprint,
    entries: [...entries.keys()],
    pdfPages,
  };
}

export function readStoreOnlyZip(bytes) {
  const source = asUint8Array(bytes);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const entries = new Map();
  let offset = 0;

  while (offset + 4 <= source.length) {
    const signature = view.getUint32(offset, true);
    if (signature === CENTRAL_DIRECTORY_HEADER) break;
    if (signature !== LOCAL_FILE_HEADER) {
      throw new Error(`Unsupported ZIP record at byte ${offset}`);
    }
    if (offset + 30 > source.length) throw new Error('Truncated ZIP local header');

    const flags = view.getUint16(offset + 6, true);
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & 0x0008) !== 0) throw new Error('ZIP data descriptors are not supported');
    if (compressionMethod !== 0 || compressedSize !== uncompressedSize) {
      throw new Error('Only store-only ZIP entries are supported');
    }

    const filenameStart = offset + 30;
    const dataStart = filenameStart + filenameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > source.length) throw new Error('Truncated ZIP entry');
    const filename = new TextDecoder().decode(
      source.subarray(filenameStart, filenameStart + filenameLength),
    );
    if (entries.has(filename)) throw new Error(`Duplicate ZIP entry: ${filename}`);
    entries.set(filename, source.slice(dataStart, dataEnd));
    offset = dataEnd;
  }

  return entries;
}

export function readPngSize(bytes) {
  const source = asUint8Array(bytes);
  if (
    source.length < 8
    || !sameBytes(source.subarray(0, 8), [137, 80, 78, 71, 13, 10, 26, 10])
  ) {
    throw new Error('Invalid PNG header');
  }
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  let offset = 8;
  let width;
  let height;
  let hasImageData = false;
  let hasEnd = false;

  while (offset < source.length) {
    if (offset + 12 > source.length) throw new Error('Invalid PNG structure');
    const length = view.getUint32(offset);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length + 4;
    if (chunkEnd > source.length) throw new Error('Invalid PNG structure');

    const type = source.subarray(offset + 4, offset + 8);
    if (offset === 8) {
      if (length !== 13 || !sameBytes(type, [73, 72, 68, 82])) {
        throw new Error('Invalid PNG structure');
      }
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
        throw new Error('Invalid PNG structure');
      }
    } else if (sameBytes(type, [73, 72, 68, 82])) {
      throw new Error('Invalid PNG structure');
    }

    if (sameBytes(type, [73, 68, 65, 84]) && length > 0) hasImageData = true;
    if (sameBytes(type, [73, 69, 78, 68])) {
      if (length !== 0 || chunkEnd !== source.length) {
        throw new Error('Invalid PNG structure');
      }
      hasEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }

  if (!hasImageData || !hasEnd || offset !== source.length) {
    throw new Error('Invalid PNG structure');
  }
  return { width, height };
}

export function countPdfPages(bytes) {
  const text = new TextDecoder('latin1').decode(asUint8Array(bytes));
  return text.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

function verifyManifest(entries, manifest) {
  const records = manifest?.files;
  if (!Array.isArray(records)) throw new Error('manifest.json files must be an array');
  assertExactNames(records.map((record) => record?.name), ARTIFACT_NAMES, 'manifest files');

  for (const record of records) {
    const bytes = entries.get(record.name);
    if (!bytes) throw new Error(`${record.name} is missing from ZIP`);
    if (record.byteLength !== bytes.byteLength) {
      throw new Error(`${record.name} byte length does not match manifest.json`);
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (record.sha256 !== hash) {
      throw new Error(`${record.name} SHA-256 does not match manifest.json`);
    }
  }
  if (typeof manifest.designFingerprint !== 'string' || manifest.designFingerprint.length === 0) {
    throw new Error('manifest.json designFingerprint is missing');
  }
}

function verifyPatternPieces(declared, png) {
  if (
    !isPositiveInteger(declared?.width)
    || !isPositiveInteger(declared?.height)
    || !isNonEmptyString(declared.layoutFingerprint)
    || !Array.isArray(declared.pieces)
    || declared.pieces.length === 0
  ) {
    throw new Error('manifest.json patternPieces is invalid');
  }
  if (declared.width !== png.width || declared.height !== png.height) {
    throw new Error('uv-pattern-pieces.png dimensions do not match manifest.json');
  }

  const ids = new Set();
  const orders = new Set();
  for (const piece of declared.pieces) {
    const sourceMeshes = piece?.sourceMeshes;
    const islandMeshes = Array.isArray(piece?.islandRefs)
      ? piece.islandRefs.map((island) => island?.meshName)
      : null;
    if (
      !isNonEmptyString(piece?.id)
      || ids.has(piece.id)
      || !isNonEmptyString(piece.label)
      || !isNonEmptyString(piece.zone)
      || (piece.duplicateGroup !== null && !isNonEmptyString(piece.duplicateGroup))
      || !Array.isArray(piece.aliases)
      || piece.aliases.some((alias) => !isNonEmptyString(alias))
      || !Number.isInteger(piece.order)
      || piece.order < 0
      || orders.has(piece.order)
      || !isPositiveInteger(piece.mappedTriangles)
      || !Array.isArray(sourceMeshes)
      || sourceMeshes.length === 0
      || sourceMeshes.some((name) => !isNonEmptyString(name))
      || !Array.isArray(islandMeshes)
      || islandMeshes.some((name) => !isNonEmptyString(name))
      || JSON.stringify(sourceMeshes) !== JSON.stringify(islandMeshes)
      || !isPositiveBounds(piece.sourceBounds, 4096, 4096)
      || !isPositiveBounds(piece.outputBounds, png.width, png.height)
      || ![0, 90, 180, 270].includes(piece.rotation)
      || typeof piece.mirrorX !== 'boolean'
      || !Number.isFinite(piece.scale)
      || piece.scale <= 0
      || !isPositiveInteger(piece.coveragePixels)
    ) {
      throw new Error('manifest.json patternPieces is invalid');
    }
    ids.add(piece.id);
    orders.add(piece.order);
  }
  if (!ids.has('front') || !ids.has('back')) {
    throw new Error('manifest.json patternPieces is invalid');
  }
}

function isPositiveBounds(bounds, maximumWidth, maximumHeight) {
  return Number.isInteger(bounds?.x)
    && bounds.x >= 0
    && Number.isInteger(bounds?.y)
    && bounds.y >= 0
    && isPositiveInteger(bounds?.width)
    && isPositiveInteger(bounds?.height)
    && bounds.x + bounds.width <= maximumWidth
    && bounds.y + bounds.height <= maximumHeight;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function readJson(bytes, filename) {
  try {
    return JSON.parse(new TextDecoder().decode(asUint8Array(bytes)));
  } catch {
    throw new Error(`${filename} is not valid JSON`);
  }
}

function assertExactNames(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must be exactly: ${expected.join(', ')}`);
  }
}

function asUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  throw new Error('Production package bytes are required');
}

function sameBytes(actual, expected) {
  return expected.every((value, index) => actual[index] === value);
}

async function runCli() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    throw new Error('Usage: node scripts/verify-production-package.mjs C:\\Downloads\\package.zip');
  }
  const result = verifyProductionPackageBytes(await readFile(resolve(zipPath)));
  console.log(
    `Production package verification: PASS (${result.designFingerprint}, ${result.atlas.width}x${result.atlas.height}, ${result.pdfPages} PDF pages)`,
  );
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await runCli();
}
