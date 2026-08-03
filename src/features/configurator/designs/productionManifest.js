import { PRODUCTION_PACKAGE_SCHEMA_VERSION } from './productionFingerprint.js';

const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IHDR = Object.freeze([73, 72, 68, 82]);

export const PRODUCTION_ARTIFACT_NAMES = Object.freeze([
  'design.json',
  'uv-atlas.png',
  'uv-pattern-pieces.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
]);

export async function sha256Hex(blob) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('生产文件不能为空。');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error('此浏览器不支持 SHA-256，无法校验生产文件。');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    await blob.arrayBuffer(),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function createProductionManifest(input) {
  assertExactNames(input?.files);
  await validateImageMetadata(input, input.files);
  const files = [];
  for (const file of input.files) {
    files.push({
      name: file.name,
      mediaType: file.mediaType,
      byteLength: file.blob.size,
      sha256: await sha256Hex(file.blob),
    });
  }

  return {
    schemaVersion: PRODUCTION_PACKAGE_SCHEMA_VERSION,
    designFingerprint: input.designFingerprint,
    productId: input.productId,
    variantId: input.variantId ?? null,
    size: input.size,
    model: structuredClone(input.model),
    uvExportVersion: input.uvExportVersion,
    atlas: structuredClone(input.atlas),
    patternPieces: structuredClone({
      height: input.patternPieces.height,
      layoutFingerprint: input.patternPieces.layoutFingerprint,
      outputTransform: normalizeOutputTransform(input.patternPieces.outputTransform),
      pieces: input.patternPieces.pieces,
      width: input.patternPieces.width,
    }),
    generatedAt: input.generatedAt,
    files,
  };
}

export async function verifyProductionArtifacts(files, manifest) {
  if (manifest?.schemaVersion !== PRODUCTION_PACKAGE_SCHEMA_VERSION) {
    throw new Error(
      `生产清单 Schema 无效：schemaVersion 必须为 ${PRODUCTION_PACKAGE_SCHEMA_VERSION}。`,
    );
  }
  assertExactNames(files);
  if (
    !manifest
    || !Array.isArray(manifest.files)
    || manifest.files.length !== PRODUCTION_ARTIFACT_NAMES.length
  ) {
    throw new Error('生产文件校验失败：清单数量不正确。');
  }
  await validateImageMetadata(manifest, files);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const expected = manifest.files[index];
    if (!(file.blob instanceof Blob) || file.blob.size === 0) {
      throw new Error(`生产文件校验失败：${file.name} 为空。`);
    }
    const hash = await sha256Hex(file.blob);
    if (
      file.name !== expected?.name
      || file.mediaType !== expected?.mediaType
      || file.blob.size !== expected?.byteLength
      || hash !== expected?.sha256
    ) {
      throw new Error(`生产文件校验失败：${file.name} 与清单不一致。`);
    }
  }

  return true;
}

function assertExactNames(files) {
  const names = files?.map((file) => file?.name);
  if (JSON.stringify(names) !== JSON.stringify(PRODUCTION_ARTIFACT_NAMES)) {
    throw new Error('生产文件校验失败：文件名称或顺序不正确。');
  }
}

export async function readPngDimensions(blob, name) {
  if (!(blob instanceof Blob)) {
    throw new Error(`生产文件 "${name}" 不是有效 PNG。`);
  }
  let header;
  try {
    header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  } catch (error) {
    throw new Error(`生产文件 "${name}" 的 PNG 数据无法读取。`, { cause: error });
  }
  if (
    header.length < PNG_SIGNATURE.length
    || !sameBytes(header.subarray(0, PNG_SIGNATURE.length), PNG_SIGNATURE)
  ) {
    throw new Error(`生产文件 "${name}" 不是有效 PNG。`);
  }
  if (header.length < 24) {
    throw new Error(`生产文件 "${name}" 的 PNG 数据不完整。`);
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (
    view.getUint32(8) !== 13
    || !sameBytes(header.subarray(12, 16), PNG_IHDR)
  ) {
    throw new Error(`生产文件 "${name}" 不是有效 PNG。`);
  }
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
    throw new Error(`生产文件 "${name}" 的 PNG 尺寸无效。`);
  }
  return { width, height };
}

async function validateImageMetadata(input, files) {
  if (
    !isPositiveInteger(input?.atlas?.width)
    || !isPositiveInteger(input?.atlas?.height)
  ) {
    throw new Error('生产清单中的 UV Atlas 数据无效：尺寸必须为正整数。');
  }
  validateProductionPatternPiecesMetadata(input.patternPieces, input.atlas);
  await validatePngArtifact(files, 'uv-atlas.png', input.atlas);
  await validatePngArtifact(files, 'uv-pattern-pieces.png', input.patternPieces);
}

export function validateProductionPatternPiecesMetadata(patternPieces, atlas) {
  if (
    !normalizeOutputTransform(patternPieces?.outputTransform)
    || !isPositiveInteger(patternPieces?.width)
    || !isPositiveInteger(patternPieces?.height)
    || patternPieces.width !== atlas.width
    || patternPieces.height !== atlas.height
    || !isNonEmptyString(patternPieces.layoutFingerprint)
    || !Array.isArray(patternPieces.pieces)
    || patternPieces.pieces.length === 0
  ) {
    throwInvalidPatternPieces('尺寸、布局指纹或裁片清单缺失。');
  }

  const ids = new Set();
  const orders = new Set();
  patternPieces.pieces.forEach((piece) => {
    const sourceMeshes = piece?.sourceMeshes;
    const islandMeshes = Array.isArray(piece?.islandRefs)
      ? piece.islandRefs.map((island) => island?.meshName)
      : null;
    if (
      !isNonEmptyString(piece?.id)
      || !isNonEmptyString(piece.label)
      || !isNonEmptyString(piece.zone)
      || (piece.duplicateGroup !== null && !isNonEmptyString(piece.duplicateGroup))
      || !Array.isArray(piece.aliases)
      || piece.aliases.some((alias) => !isNonEmptyString(alias))
      || !Number.isInteger(piece.order)
      || piece.order < 0
      || ![0, 90, 180, 270].includes(piece.rotation)
      || typeof piece.mirrorX !== 'boolean'
      || !Array.isArray(sourceMeshes)
      || sourceMeshes.length === 0
      || sourceMeshes.some((name) => !isNonEmptyString(name))
      || !Array.isArray(islandMeshes)
      || islandMeshes.some((name) => !isNonEmptyString(name))
      || JSON.stringify(sourceMeshes) !== JSON.stringify(islandMeshes)
      || !isPositiveInteger(piece.mappedTriangles)
      || !isPositiveBounds(piece.sourceBounds, atlas.width, atlas.height)
      || !isPositiveBounds(
        piece.outputBounds,
        patternPieces.width,
        patternPieces.height,
      )
      || !Number.isFinite(piece.scale)
      || piece.scale <= 0
      || !isPositiveInteger(piece.coveragePixels)
    ) {
      throwInvalidPatternPieces(`裁片 "${piece?.id ?? 'unknown'}" 的来源、变换或覆盖信息不匹配。`);
    }
    if (ids.has(piece.id) || orders.has(piece.order)) {
      throwInvalidPatternPieces(`裁片 "${piece.id}" 的 id 或 order 重复。`);
    }
    ids.add(piece.id);
    orders.add(piece.order);
  });
  if (!ids.has('front') || !ids.has('back')) {
    throwInvalidPatternPieces('裁片清单必须包含独立的 front 和 back。');
  }
}

function normalizeOutputTransform(outputTransform) {
  if (
    outputTransform === null
    || typeof outputTransform !== 'object'
    || Array.isArray(outputTransform)
  ) return null;

  let rotation;
  let mirrorX;
  try {
    rotation = Object.getOwnPropertyDescriptor(outputTransform, 'rotation');
    mirrorX = Object.getOwnPropertyDescriptor(outputTransform, 'mirrorX');
  } catch {
    return null;
  }
  if (
    !Object.hasOwn(rotation ?? {}, 'value')
    || !Object.hasOwn(mirrorX ?? {}, 'value')
    || ![0, 90, 180, 270].includes(rotation.value)
    || typeof mirrorX.value !== 'boolean'
  ) return null;

  return { rotation: rotation.value, mirrorX: mirrorX.value };
}

async function validatePngArtifact(files, name, expected) {
  const file = files.find((candidate) => candidate?.name === name);
  const actual = await readPngDimensions(file?.blob, name);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `生产文件 "${name}" 的实际尺寸 ${actual.width}×${actual.height}`
      + ` 与声明的 ${expected.width}×${expected.height} 不一致。`,
    );
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

function sameBytes(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function throwInvalidPatternPieces(detail) {
  throw new Error(`生产清单中的 UV 裁片数据无效：${detail}`);
}
