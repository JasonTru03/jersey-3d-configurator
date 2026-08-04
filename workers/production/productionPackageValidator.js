import {
  DESIGN_DOCUMENT_FORMAT,
  DESIGN_DOCUMENT_VERSION,
} from '../../src/features/configurator/designs/designDocument.js';
import {
  createDesignFingerprint,
  PRODUCTION_PACKAGE_SCHEMA_VERSION,
  PRODUCTION_UV_EXPORT_VERSION,
} from '../../src/features/configurator/designs/productionFingerprint.js';
import { createStreamingProductionBundle } from '../../src/features/configurator/designs/productionBundle.js';
import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
  readPngDimensions,
  verifyProductionArtifacts,
} from '../../src/features/configurator/designs/productionManifest.js';

const SHOP_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8}$/u;
const PDF_SIGNATURE = Object.freeze([37, 80, 68, 70, 45]);
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const SHOPIFY_VARIANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const MODEL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;

export class ProductionPackageValidationError extends Error {
  constructor(cause) {
    super('Uploaded production package is invalid.', { cause });
    this.code = 'invalid-production-package';
    this.name = 'ProductionPackageValidationError';
  }
}

export class ProductionPackageRebuildError extends Error {
  constructor(cause) {
    super('Production package rebuild failed.', { cause });
    this.code = 'production-package-rebuild-failed';
    this.name = 'ProductionPackageRebuildError';
  }
}

export async function validateUploadedProductionPackage(input) {
  try {
    return await validateUploadedProductionPackageInternal(input);
  } catch (error) {
    if (error instanceof ProductionPackageValidationError) throw error;
    throw new ProductionPackageValidationError(error);
  }
}

export async function validateAndRebuildUploadedProductionPackage(input) {
  const validated = await validateUploadedProductionPackage(input);
  let bundle;
  try {
    bundle = createStreamingProductionBundle({
      files: validated.files,
      fingerprint: validated.designFingerprint,
      productId: validated.productId,
    });
  } catch (error) {
    throw new ProductionPackageRebuildError(error);
  }
  return Object.freeze({ validated, bundle });
}

async function validateUploadedProductionPackageInternal(input) {
  const request = snapshotRequest(input);
  const [design, manifest] = await Promise.all([
    parseJsonFile(request.files[0], 'design'),
    parseJsonFile(request.files[6], 'manifest'),
    ...request.files.slice(1, 6).map(assertFileMagic),
  ]);
  assertDesignDocument(design);
  assertManifestMetadata(manifest);
  if (
    design.productId !== manifest.productId
    || design.variantId !== manifest.variantId
    || design.state.layout !== manifest.size
  ) {
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
  if (file.filename.endsWith('.png')) {
    await readPngDimensions(file.blob, file.filename);
    return;
  }
  const actual = new Uint8Array(await file.blob.slice(0, PDF_SIGNATURE.length).arrayBuffer());
  if (!sameBytes(actual, PDF_SIGNATURE)) {
    throw new TypeError(`Production file ${file.filename} has invalid content.`);
  }
}

function assertDesignDocument(design) {
  if (
    design.format !== DESIGN_DOCUMENT_FORMAT
    || design.version !== DESIGN_DOCUMENT_VERSION
    || !matchesPattern(design.productId, PRODUCT_ID_PATTERN)
    || !isVariantId(design.variantId)
    || !isPlainObject(design.state)
    || !matchesPattern(design.state.layout, SAFE_ID_PATTERN)
  ) throw new TypeError('Production design document is invalid.');
}

function assertManifestMetadata(manifest) {
  if (
    manifest.schemaVersion !== PRODUCTION_PACKAGE_SCHEMA_VERSION
    || manifest.uvExportVersion !== PRODUCTION_UV_EXPORT_VERSION
    || typeof manifest.designFingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(manifest.designFingerprint)
    || !matchesPattern(manifest.productId, PRODUCT_ID_PATTERN)
    || !isVariantId(manifest.variantId)
    || !matchesPattern(manifest.size, SAFE_ID_PATTERN)
    || !isPlainObject(manifest.model)
    || !matchesPattern(manifest.model.id, SAFE_ID_PATTERN)
    || !matchesPattern(manifest.model.version, MODEL_VERSION_PATTERN)
  ) throw new TypeError('Production manifest metadata is invalid.');
}

function isVariantId(value) {
  return value === null || (
    typeof value === 'string' && SHOPIFY_VARIANT_ID_PATTERN.test(value)
  );
}

function matchesPattern(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
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
