import { HttpError, REQUEST_MESSAGE, isPlainObject } from './productionDraftRequest.js';

const MAX_SESSION_BYTES = 16 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024 + 64 * 1024;
const MAX_TURNSTILE_TOKEN_LENGTH = 4_096;
const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const UPLOAD_ID_PATTERN = /^upl_[A-Za-z0-9_-]{16,64}$/u;
const UPLOAD_TOKEN_PATTERN = /^upt_[A-Za-z0-9_-]{16,124}$/u;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const VARIANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BUNDLE_FILENAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}-design-([a-f0-9]{8})\.zip$/u;

export function validateSessionHeaders(request) {
  if (request.headers.get('content-type') !== 'application/json') {
    throw new HttpError(415, 'Content-Type must be application/json.');
  }
  readContentLength(request, MAX_SESSION_BYTES);
}

export async function parseProductionDraftSession(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  if (!hasExactKeys(body, ['shop', 'uploadId', 'turnstileToken', 'design', 'manifest', 'bundle'])) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  if (!matches(body.shop, SHOP_PATTERN)
    || !matches(body.uploadId, UPLOAD_ID_PATTERN)
    || typeof body.turnstileToken !== 'string'
    || body.turnstileToken.trim().length === 0
    || body.turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  const design = snapshotDesign(body.design);
  const manifest = snapshotFile(body.manifest, MAX_MANIFEST_BYTES);
  const bundle = snapshotBundle(body.bundle, design.designFingerprint);
  return Object.freeze({
    shop: body.shop,
    uploadId: body.uploadId,
    turnstileToken: body.turnstileToken,
    design,
    manifest,
    bundle,
  });
}

export function parseProductionUploadAuthorization(request, expected) {
  const contentType = request.headers.get('content-type');
  if (contentType !== expected.contentType) {
    throw new HttpError(415, `Content-Type must be ${expected.contentType}.`);
  }
  const byteLength = readContentLength(request, expected.maxBytes);
  const shop = request.headers.get('x-production-shop');
  const uploadId = request.headers.get('x-production-upload-id');
  const uploadToken = request.headers.get('x-production-upload-token');
  if (!matches(shop, SHOP_PATTERN)
    || !matches(uploadId, UPLOAD_ID_PATTERN)
    || !matches(uploadToken, UPLOAD_TOKEN_PATTERN)) {
    throw new HttpError(401, 'Production upload authorization is invalid.');
  }
  if (!(request.body instanceof ReadableStream)) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  return Object.freeze({ byteLength, shop, uploadId, uploadToken });
}

export function matchesDeclaredDraft(draft, session, now) {
  return isPlainObject(draft)
    && Number.isSafeInteger(draft.expiresAt)
    && draft.expiresAt > now
    && draft.shop === session.shop
    && draft.uploadId === session.uploadId
    && draft.productId === session.design.productId
    && draft.variantId === session.design.variantId
    && draft.size === session.design.size
    && draft.modelId === session.design.modelId
    && draft.modelVersion === session.design.modelVersion
    && draft.uvExportVersion === session.design.uvExportVersion
    && draft.designFingerprint === session.design.designFingerprint
    && draft.manifestSha256 === session.manifest.sha256
    && draft.manifestBytes === session.manifest.byteLength
    && draft.bundleSha256 === session.bundle.sha256
    && draft.bundleBytes === session.bundle.byteLength
    && draft.bundleFilename === session.bundle.filename;
}

function snapshotDesign(value) {
  if (!hasExactKeys(value, [
    'designFingerprint', 'productId', 'variantId', 'size',
    'modelId', 'modelVersion', 'uvExportVersion',
  ])) throw new HttpError(400, REQUEST_MESSAGE);
  if (!matches(value.designFingerprint, FINGERPRINT_PATTERN)
    || !matches(value.productId, PRODUCT_ID_PATTERN)
    || !matches(value.variantId, VARIANT_ID_PATTERN)
    || !matches(value.size, SAFE_ID_PATTERN)
    || !matches(value.modelId, SAFE_ID_PATTERN)
    || !matches(value.modelVersion, SAFE_ID_PATTERN)
    || !matches(value.uvExportVersion, SAFE_ID_PATTERN)) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  return Object.freeze({ ...value });
}

function snapshotFile(value, maxBytes) {
  if (!hasExactKeys(value, ['byteLength', 'sha256'])
    || !Number.isSafeInteger(value.byteLength)
    || value.byteLength <= 0
    || value.byteLength > maxBytes
    || !matches(value.sha256, SHA256_PATTERN)) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  return Object.freeze({ byteLength: value.byteLength, sha256: value.sha256 });
}

function snapshotBundle(value, fingerprint) {
  if (!hasExactKeys(value, ['filename', 'byteLength', 'sha256'])) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  const file = snapshotFile(
    { byteLength: value.byteLength, sha256: value.sha256 },
    MAX_BUNDLE_BYTES,
  );
  const match = typeof value.filename === 'string'
    ? BUNDLE_FILENAME_PATTERN.exec(value.filename)
    : null;
  if (!match || match[1] !== fingerprint) throw new HttpError(400, REQUEST_MESSAGE);
  return Object.freeze({ ...file, filename: value.filename });
}

function readContentLength(request, maximum) {
  const declared = request.headers.get('content-length');
  if (declared === null) throw new HttpError(411, 'Content-Length is required.');
  if (!/^[1-9][0-9]*$/u.test(declared)) throw new HttpError(400, REQUEST_MESSAGE);
  const value = Number(declared);
  if (!Number.isSafeInteger(value)) throw new HttpError(400, REQUEST_MESSAGE);
  if (value > maximum) throw new HttpError(413, 'Production draft request is too large.');
  return value;
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function matches(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

export const PRODUCTION_UPLOAD_LIMITS = Object.freeze({
  bundle: MAX_BUNDLE_BYTES,
  manifest: MAX_MANIFEST_BYTES,
});
