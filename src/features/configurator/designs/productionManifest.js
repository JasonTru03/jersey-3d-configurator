import { PRODUCTION_PACKAGE_SCHEMA_VERSION } from './productionFingerprint.js';

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
  validateImageMetadata(input);
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
    patternPieces: structuredClone(input.patternPieces),
    generatedAt: input.generatedAt,
    files,
  };
}

export async function verifyProductionArtifacts(files, manifest) {
  assertExactNames(files);
  if (
    !manifest
    || !Array.isArray(manifest.files)
    || manifest.files.length !== PRODUCTION_ARTIFACT_NAMES.length
  ) {
    throw new Error('生产文件校验失败：清单数量不正确。');
  }
  validateImageMetadata(manifest);

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

function validateImageMetadata(input) {
  if (
    !isPositiveInteger(input?.atlas?.width)
    || !isPositiveInteger(input?.atlas?.height)
  ) {
    throw new Error('生产清单中的 UV Atlas 数据无效：尺寸必须为正整数。');
  }
  validatePatternPieces(input.patternPieces, input.atlas);
}

function validatePatternPieces(patternPieces, atlas) {
  if (
    !isPositiveInteger(patternPieces?.width)
    || !isPositiveInteger(patternPieces?.height)
    || patternPieces.width !== atlas.width
    || patternPieces.height !== atlas.height
    || typeof patternPieces.layoutFingerprint !== 'string'
    || patternPieces.layoutFingerprint.length === 0
    || !Array.isArray(patternPieces.pieces)
    || patternPieces.pieces.length === 0
  ) {
    throwInvalidPatternPieces('尺寸、布局指纹或裁片清单缺失。');
  }

  patternPieces.pieces.forEach((piece) => {
    const sourceMeshes = piece?.sourceMeshes;
    const islandMeshes = piece?.islandRefs?.map((island) => island?.meshName);
    if (
      typeof piece?.id !== 'string'
      || piece.id.length === 0
      || typeof piece.label !== 'string'
      || piece.label.length === 0
      || !Number.isInteger(piece.order)
      || piece.order < 0
      || ![0, 90, 180, 270].includes(piece.rotation)
      || typeof piece.mirrorX !== 'boolean'
      || !Array.isArray(sourceMeshes)
      || sourceMeshes.length === 0
      || sourceMeshes.some((name) => typeof name !== 'string' || name.length === 0)
      || !Array.isArray(islandMeshes)
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
  });
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

function throwInvalidPatternPieces(detail) {
  throw new Error(`生产清单中的 UV 裁片数据无效：${detail}`);
}
