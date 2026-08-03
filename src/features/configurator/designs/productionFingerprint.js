import { normalizeDesignState } from './designDocument.js';

export const PRODUCTION_PACKAGE_SCHEMA_VERSION = 2;

export function canonicalizeProductionValue(value) {
  return JSON.stringify(sortValue(value));
}

export function normalizeProductionState(state) {
  return stripVolatileFields(normalizeDesignState(structuredClone(state)));
}

export async function createDesignFingerprint({
  model,
  productId,
  size,
  state,
  variantId = null,
}) {
  validateFingerprintInput({ model, productId, size, state });
  if (!globalThis.crypto?.subtle) {
    throw new Error('此浏览器不支持 SHA-256，无法生成生产文件。');
  }

  const canonical = canonicalizeProductionValue({
    model: {
      id: model.id,
      version: model.version,
    },
    packageSchemaVersion: PRODUCTION_PACKAGE_SCHEMA_VERSION,
    productId,
    size,
    state: normalizeProductionState(state),
    uvExportVersion: model.uvExportVersion,
    variantId,
  });
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('').slice(0, 8);
}

export function createProductionFilename(productId, fingerprint) {
  if (typeof productId !== 'string' || productId.length === 0) {
    throw new Error('产品 ID 无效。');
  }
  if (!/^[0-9a-f]{8}$/.test(fingerprint)) {
    throw new Error('生产文件指纹格式无效。');
  }
  return `${productId}-design-${fingerprint}.zip`;
}

function validateFingerprintInput({ model, productId, size, state }) {
  if (typeof productId !== 'string' || productId.length === 0) {
    throw new Error('产品 ID 无效。');
  }
  if (typeof size !== 'string' || size.length === 0) {
    throw new Error('尺码信息无效。');
  }
  if (!state || typeof state !== 'object') {
    throw new Error('设计状态无效。');
  }
  for (const key of ['id', 'version', 'uvExportVersion']) {
    if (typeof model?.[key] !== 'string' || model[key].length === 0) {
      throw new Error(`模型生产元数据 ${key} 无效。`);
    }
  }
}

function stripVolatileFields(value) {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).reduce((result, key) => {
    if ([
      'atlasFilename',
      'atlasSha256',
      'bakeMetadata',
      'bundleFilename',
      'designFilename',
      'filename',
      'generatedAt',
      'savedAt',
    ].includes(key)) return result;
    result[key] = stripVolatileFields(value[key]);
    return result;
  }, {});
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = sortValue(value[key]);
      return result;
    }, {});
  }
  return value;
}
