import { PRODUCTION_PACKAGE_SCHEMA_VERSION } from './productionFingerprint.js';

export const PRODUCTION_ARTIFACT_NAMES = Object.freeze([
  'design.json',
  'uv-atlas.png',
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
