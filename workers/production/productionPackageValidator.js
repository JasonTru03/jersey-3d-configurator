import {
  DESIGN_DOCUMENT_FORMAT,
  DESIGN_DOCUMENT_VERSION,
} from '../../src/features/configurator/designs/designDocument.js';
import {
  createDesignFingerprint,
  PRODUCTION_PACKAGE_SCHEMA_VERSION,
  PRODUCTION_UV_EXPORT_VERSION,
} from '../../src/features/configurator/designs/productionFingerprint.js';
import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
  verifyProductionArtifacts,
} from '../../src/features/configurator/designs/productionManifest.js';

const SHOP_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8}$/u;
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const PDF_SIGNATURE = Object.freeze([37, 80, 68, 70, 45]);

export async function validateUploadedProductionPackage(input) {
  const request = snapshotRequest(input);
  const [design, manifest] = await Promise.all([
    parseJsonFile(request.files[0], 'design'),
    parseJsonFile(request.files[6], 'manifest'),
    ...request.files.slice(1, 6).map(assertFileMagic),
  ]);
  assertDesignDocument(design);
  assertManifestMetadata(manifest);
  if (design.productId !== manifest.productId || design.variantId !== manifest.variantId) {
    throw new TypeError('Production design and manifest do not match.');
  }

  const artifacts = request.files.slice(0, 6).map(({ blob, filename }, index) => ({
    blob,
    mediaType: PRODUCTION_PACKAGE_FILE_CONTRACT[index].mediaType,
    name: filename,
  }));
  await verifyProductionArtifacts(artifacts, manifest);

  const fingerprint = await createDesignFingerprint({
    model: {
      id: manifest.model.id,
      uvExportVersion: manifest.uvExportVersion,
      version: manifest.model.version,
    },
    productId: manifest.productId,
    size: manifest.size,
    state: design.state,
    variantId: manifest.variantId,
  });
  if (fingerprint !== manifest.designFingerprint) {
    throw new TypeError('Production package fingerprint does not match.');
  }

  return Object.freeze({
    designFingerprint: fingerprint,
    productId: manifest.productId,
    variantId: manifest.variantId,
    size: manifest.size,
    modelId: manifest.model.id,
    modelVersion: manifest.model.version,
    uvExportVersion: manifest.uvExportVersion,
    files: Object.freeze(request.files.map((file) => Object.freeze(file))),
  });
}

function snapshotRequest(input) {
  const request = readExactDataProperties(input, ['expectedShop', 'files']);
  if (!request) throw new TypeError('Production package request is invalid.');
  if (typeof request.expectedShop !== 'string' || !SHOP_DOMAIN_PATTERN.test(request.expectedShop)) {
    throw new TypeError('Production package shop is invalid.');
  }
  const candidateFiles = readExactArray(
    request.files,
    PRODUCTION_PACKAGE_FILE_CONTRACT.length,
  );
  if (!candidateFiles) {
    throw new TypeError('Production package files are invalid.');
  }

  let totalBytes = 0;
  const files = candidateFiles.map((candidate, index) => {
    const file = readExactDataProperties(candidate, ['blob', 'filename']);
    const contract = PRODUCTION_PACKAGE_FILE_CONTRACT[index];
    if (!file || file.filename !== contract.filename) {
      throw new TypeError('Production package files are invalid.');
    }
    const blob = snapshotBlob(file.blob);
    if (
      !blob
      || blob.size === 0
      || blob.type !== contract.mediaType
      || blob.size > contract.maxBytes
    ) throw new TypeError('Production package files are invalid.');
    totalBytes += blob.size;
    if (totalBytes > MAX_PRODUCTION_PACKAGE_BYTES) {
      throw new TypeError('Production package files are invalid.');
    }
    return { blob, filename: contract.filename };
  });
  return { files };
}

function readExactArray(value, expectedLength) {
  if (!Array.isArray(value)) return null;
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const expectedKeys = [
    ...Array.from({ length: expectedLength }, (_, index) => String(index)),
    'length',
  ];
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
    || expectedKeys.some((key) => !Object.hasOwn(descriptors[key], 'value'))
    || descriptors.length.value !== expectedLength
  ) return null;
  return expectedKeys.slice(0, -1).map((key) => descriptors[key].value);
}

function snapshotBlob(value) {
  if (!(value instanceof Blob)) return null;
  try {
    const sizeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
    const typeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')?.get;
    if (typeof sizeGetter !== 'function' || typeof typeGetter !== 'function') return null;
    const size = sizeGetter.call(value);
    const type = typeGetter.call(value);
    return Blob.prototype.slice.call(value, 0, size, type);
  } catch {
    return null;
  }
}

async function parseJsonFile(file, label) {
  let parsed;
  try {
    parsed = JSON.parse(await file.blob.text());
  } catch {
    throw new TypeError(`Production ${label} JSON is invalid.`);
  }
  if (!isPlainObject(parsed)) throw new TypeError(`Production ${label} JSON is invalid.`);
  return parsed;
}

async function assertFileMagic(file) {
  const expected = file.filename.endsWith('.png') ? PNG_SIGNATURE : PDF_SIGNATURE;
  const actual = new Uint8Array(await file.blob.slice(0, expected.length).arrayBuffer());
  if (!sameBytes(actual, expected)) {
    throw new TypeError(`Production file ${file.filename} has invalid content.`);
  }
}

function assertDesignDocument(design) {
  if (
    design.format !== DESIGN_DOCUMENT_FORMAT
    || ![1, 2, DESIGN_DOCUMENT_VERSION].includes(design.version)
    || typeof design.productId !== 'string'
    || design.productId.length === 0
    || (design.variantId !== null && typeof design.variantId !== 'string')
    || !isPlainObject(design.state)
  ) throw new TypeError('Production design document is invalid.');
}

function assertManifestMetadata(manifest) {
  if (
    manifest.schemaVersion !== PRODUCTION_PACKAGE_SCHEMA_VERSION
    || manifest.uvExportVersion !== PRODUCTION_UV_EXPORT_VERSION
    || typeof manifest.designFingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(manifest.designFingerprint)
    || typeof manifest.productId !== 'string'
    || manifest.productId.length === 0
    || (manifest.variantId !== null && typeof manifest.variantId !== 'string')
    || typeof manifest.size !== 'string'
    || manifest.size.length === 0
    || !isPlainObject(manifest.model)
    || typeof manifest.model.id !== 'string'
    || manifest.model.id.length === 0
    || typeof manifest.model.version !== 'string'
    || manifest.model.version.length === 0
  ) throw new TypeError('Production manifest metadata is invalid.');
}

function readExactDataProperties(value, expectedKeys) {
  if (!isPlainObject(value)) return null;
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return null;
  }
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
    || keys.some((key) => !Object.hasOwn(descriptors[key], 'value'))
  ) return null;
  return Object.fromEntries(expectedKeys.map((key) => [key, descriptors[key].value]));
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

function sameBytes(actual, expected) {
  return actual.length === expected.length
    && actual.every((byte, index) => byte === expected[index]);
}
