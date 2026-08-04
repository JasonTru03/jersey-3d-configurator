import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
} from '../../src/features/configurator/designs/productionManifest.js';
import {
  PRODUCTION_PACKAGE_SCHEMA_VERSION,
  PRODUCTION_UV_EXPORT_VERSION,
  createDesignFingerprint,
} from '../../src/features/configurator/designs/productionFingerprint.js';

const MANIFEST_MAX_BYTES = PRODUCTION_PACKAGE_FILE_CONTRACT.at(-1).maxBytes;
const BUNDLE_MAX_BYTES = MAX_PRODUCTION_PACKAGE_BYTES + 64 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export class CloudDraftUnavailableError extends Error {}

export async function loadAuthoritativeCloudDraft({
  assets,
  designId,
  expectedProductId,
  expectedSize,
  expectedVariantId,
  now,
  repository,
  shop,
  state,
}) {
  const draft = await repository.getDesign(shop, designId);
  if (!isQuoteableDraft(draft, shop, designId, now)) {
    throw new CloudDraftUnavailableError();
  }
  if (
    draft.productId !== expectedProductId
    || draft.size !== expectedSize
    || draft.variantId !== expectedVariantId
  ) throw new CloudDraftUnavailableError();

  let fingerprint;
  try {
    fingerprint = await createDesignFingerprint({
      model: {
        id: draft.modelId,
        version: draft.modelVersion,
        uvExportVersion: draft.uvExportVersion,
      },
      productId: draft.productId,
      size: draft.size,
      state,
      variantId: draft.variantId,
    });
  } catch {
    throw new CloudDraftUnavailableError();
  }
  if (fingerprint !== draft.designFingerprint) throw new CloudDraftUnavailableError();

  const [manifestHeadValue, bundleHeadValue] = await Promise.all([
    assets.head(draft.manifestKey),
    assets.head(draft.bundleKey),
  ]);
  const manifestHead = validateHead(manifestHeadValue, {
    contentType: 'application/json',
    draft,
    expectedHash: draft.manifestSha256,
    expectedKey: draft.manifestKey,
    maximumSize: MANIFEST_MAX_BYTES,
  });
  validateHead(bundleHeadValue, {
    contentType: 'application/zip',
    draft,
    expectedKey: draft.bundleKey,
    maximumSize: BUNDLE_MAX_BYTES,
    requireContentLength: true,
    requireNativeChecksum: true,
  });
  assertObjectKeyRelationship(draft);

  const manifestObject = await assets.get(draft.manifestKey);
  const manifestBytes = await readManifestBytes(manifestObject, manifestHead.size);
  if (await sha256Hex(manifestBytes) !== draft.manifestSha256) {
    throw new Error('Production manifest digest is invalid.');
  }
  const manifest = parseManifest(manifestBytes, draft);
  return Object.freeze({
    draft,
    atlasSha256: manifest.files[1].sha256,
  });
}

function isQuoteableDraft(draft, shop, designId, now) {
  return isPlainObject(draft)
    && draft.shop === shop
    && draft.designId === designId
    && draft.status === 'cart_draft'
    && Number.isSafeInteger(draft.expiresAt)
    && draft.expiresAt > now
    && (draft.bundleId === null || typeof draft.bundleId === 'string');
}

function validateHead(value, {
  contentType,
  draft,
  expectedHash,
  expectedKey,
  maximumSize,
  requireContentLength = false,
  requireNativeChecksum = false,
}) {
  const head = readBindingProperties(value, [
    'key', 'size', 'httpMetadata', 'customMetadata', 'checksums',
  ]);
  if (!head
    || head.key !== expectedKey
    || !Number.isSafeInteger(head.size)
    || head.size <= 0
    || head.size > maximumSize) throw new Error('Production R2 object is invalid.');
  const http = readBindingProperties(head.httpMetadata, ['contentType']);
  const metadata = readBindingProperties(head.customMetadata, [
    'designFingerprint', 'productId', 'variantId', 'size', 'sha256',
    ...(requireContentLength ? ['contentLength'] : []),
  ]);
  const checksums = requireNativeChecksum
    ? readBindingProperties(head.checksums, ['sha256'])
    : null;
  if (!http
    || http.contentType !== contentType
    || !metadata
    || metadata.designFingerprint !== draft.designFingerprint
    || metadata.productId !== draft.productId
    || metadata.variantId !== draft.variantId
    || metadata.size !== draft.size
    || !SHA256_PATTERN.test(metadata.sha256)
    || (expectedHash !== undefined && metadata.sha256 !== expectedHash)
    || (requireNativeChecksum && (
      !checksums || bytesToHex(checksums.sha256) !== metadata.sha256
    ))
    || (requireContentLength && metadata.contentLength !== String(head.size))) {
    throw new Error('Production R2 metadata is invalid.');
  }
  return head;
}

function assertObjectKeyRelationship(draft) {
  const suffix = `/${draft.bundleFilename}`;
  if (!draft.manifestKey.endsWith('/manifest.json')
    || !draft.bundleKey.endsWith(suffix)
    || draft.manifestKey.slice(0, -'/manifest.json'.length)
      !== draft.bundleKey.slice(0, -suffix.length)) {
    throw new Error('Production R2 keys are invalid.');
  }
}

async function readManifestBytes(value, expectedSize) {
  const arrayBuffer = readDataMethod(value, 'arrayBuffer');
  if (!arrayBuffer) {
    throw new Error('Production manifest body is unavailable.');
  }
  let buffer;
  try {
    buffer = await arrayBuffer.call(value);
  } catch {
    throw new Error('Production manifest body is unavailable.');
  }
  if (!isArrayBuffer(buffer) || buffer.byteLength !== expectedSize) {
    throw new Error('Production manifest body size is invalid.');
  }
  return new Uint8Array(buffer);
}

function parseManifest(bytes, draft) {
  let parsed;
  try {
    parsed = JSON.parse(UTF8_DECODER.decode(bytes));
  } catch {
    throw new Error('Production manifest JSON is invalid.');
  }
  const manifest = readExactDataProperties(parsed, [
    'schemaVersion', 'designFingerprint', 'productId', 'variantId', 'size',
    'model', 'uvExportVersion', 'atlas', 'patternPieces', 'generatedAt', 'files',
  ]);
  const model = readExactDataProperties(manifest?.model, ['id', 'version']);
  const atlas = readExactDataProperties(manifest?.atlas, ['colorSpace', 'height', 'width']);
  if (!manifest
    || manifest.schemaVersion !== PRODUCTION_PACKAGE_SCHEMA_VERSION
    || manifest.designFingerprint !== draft.designFingerprint
    || manifest.productId !== draft.productId
    || manifest.variantId !== draft.variantId
    || manifest.size !== draft.size
    || manifest.uvExportVersion !== PRODUCTION_UV_EXPORT_VERSION
    || manifest.uvExportVersion !== draft.uvExportVersion
    || !model
    || model.id !== draft.modelId
    || model.version !== draft.modelVersion
    || !atlas
    || atlas.colorSpace !== 'sRGB'
    || !Number.isSafeInteger(atlas.width)
    || atlas.width <= 0
    || !Number.isSafeInteger(atlas.height)
    || atlas.height <= 0
    || !isPlainObject(manifest.patternPieces)
    || typeof manifest.generatedAt !== 'string'
    || manifest.generatedAt.length === 0
    || manifest.generatedAt.length > 64
    || !Array.isArray(manifest.files)
    || manifest.files.length !== PRODUCTION_PACKAGE_FILE_CONTRACT.length - 1) {
    throw new Error('Production manifest fields are invalid.');
  }
  const files = manifest.files.map((candidate, index) => {
    const file = readExactDataProperties(candidate, ['name', 'mediaType', 'byteLength', 'sha256']);
    const contract = PRODUCTION_PACKAGE_FILE_CONTRACT[index];
    if (!file
      || file.name !== contract.filename
      || file.mediaType !== contract.mediaType
      || !Number.isSafeInteger(file.byteLength)
      || file.byteLength <= 0
      || file.byteLength > contract.maxBytes
      || !SHA256_PATTERN.test(file.sha256)) {
      throw new Error('Production manifest file is invalid.');
    }
    return file;
  });
  return { ...manifest, files };
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(digest);
}

function bytesToHex(value) {
  if (!isArrayBuffer(value) || value.byteLength !== 32) return null;
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isArrayBuffer(value) {
  try {
    return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
  } catch {
    return false;
  }
}

function readBindingProperties(value, keys) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
  const properties = {};
  try {
    // workerd exposes trusted R2 result fields as lazy readonly accessors.
    for (const key of keys) properties[key] = value[key];
  } catch {
    return null;
  }
  return properties;
}

function readDataMethod(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
  let current = value;
  try {
    while (current !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        return Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function'
          ? descriptor.value
          : null;
      }
      current = Object.getPrototypeOf(current);
    }
  } catch {
    return null;
  }
  return null;
}

function readExactDataProperties(value, keys) {
  if (!isPlainObject(value)) return null;
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length
    || keys.some((key) => !Object.hasOwn(descriptors, key)
      || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
