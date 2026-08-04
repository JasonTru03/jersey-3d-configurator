import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
} from '../../src/features/configurator/designs/productionManifest.js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'production_draft';
export const TURNSTILE_TIMEOUT_MS = 8_000;
const MAX_MULTIPART_BYTES = MAX_PRODUCTION_PACKAGE_BYTES + 64 * 1024;
const MAX_TURNSTILE_TOKEN_LENGTH = 4_096;
const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const UPLOAD_ID_PATTERN = /^upl_[A-Za-z0-9_-]{16,64}$/u;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const VARIANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONFIG_KEYS = new Set(['productId', 'currency', 'jerseyVariants', 'surchargeVariants']);
const encoder = new TextEncoder();

export const SERVICE_MESSAGE = 'Production draft uploads are temporarily unavailable.';
export const REQUEST_MESSAGE = 'Production draft request is invalid.';
export const CONFLICT_MESSAGE = 'Production draft upload ID is already in use.';

export class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.headers = headers;
    this.status = status;
  }
}

export class ServiceError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function validateProductionDraftBindings(env, createRepository) {
  if (!isPlainObject(env) || isLocalProductionMode(env)) {
    throw new ServiceError('PRODUCTION_DRAFT_DISABLED');
  }
  const assets = env.PRODUCTION_ASSETS;
  if (!assets || ['put', 'get', 'head', 'delete'].some((method) => typeof assets[method] !== 'function')) {
    throw new ServiceError('PRODUCTION_DRAFT_R2_BINDING_INVALID');
  }
  const db = env.PRODUCTION_DB;
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new ServiceError('PRODUCTION_DRAFT_D1_BINDING_INVALID');
  }
  const rateLimit = env.PRODUCTION_UPLOAD_RATE_LIMIT;
  if (!rateLimit || typeof rateLimit.limit !== 'function') {
    throw new ServiceError('PRODUCTION_DRAFT_RATE_LIMIT_BINDING_INVALID');
  }
  if (typeof env.TURNSTILE_SITE_KEY !== 'string' || env.TURNSTILE_SITE_KEY.length === 0) {
    throw new ServiceError('PRODUCTION_DRAFT_SITE_KEY_INVALID');
  }
  if (typeof env.TURNSTILE_SECRET_KEY !== 'string' || env.TURNSTILE_SECRET_KEY.length === 0) {
    throw new ServiceError('PRODUCTION_DRAFT_SECRET_INVALID');
  }
  const storeConfigs = parseStoreConfigs(env.SHOPIFY_STORE_CONFIG_JSON);
  let repository;
  try {
    repository = createRepository(db);
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_REPOSITORY_INVALID');
  }
  if (!repository
    || typeof repository.getCartDraftByUpload !== 'function'
    || typeof repository.createUploadPending !== 'function'
    || typeof repository.finalizeCartDraft !== 'function'
    || typeof repository.takeOverStaleUpload !== 'function'
    || typeof repository.claimOwnedUploadCleanup !== 'function'
    || typeof repository.deleteClaimedDraft !== 'function') {
    throw new ServiceError('PRODUCTION_DRAFT_REPOSITORY_INVALID');
  }
  return {
    assets,
    rateLimit,
    repository,
    storeConfigs,
    turnstileSecret: env.TURNSTILE_SECRET_KEY,
  };
}

function parseStoreConfigs(serialized) {
  if (typeof serialized !== 'string' || serialized.length === 0) {
    throw new ServiceError('PRODUCTION_DRAFT_STORE_CONFIG_MISSING');
  }
  let configs;
  try {
    configs = JSON.parse(serialized);
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_STORE_CONFIG_JSON_INVALID');
  }
  if (!isPlainObject(configs)) throw new ServiceError('PRODUCTION_DRAFT_STORE_CONFIG_INVALID');
  for (const [shop, config] of Object.entries(configs)) {
    if (!SHOP_PATTERN.test(shop)
      || !isPlainObject(config)
      || Object.keys(config).length !== CONFIG_KEYS.size
      || Object.keys(config).some((key) => !CONFIG_KEYS.has(key))
      || !matches(config.productId, PRODUCT_ID_PATTERN)
      || !matches(config.currency, /^[A-Z]{3}$/u)
      || !isPlainObject(config.jerseyVariants)
      || !isPlainObject(config.surchargeVariants)) {
      throw new ServiceError('PRODUCTION_DRAFT_STORE_CONFIG_INVALID');
    }
    for (const [size, variantId] of Object.entries(config.jerseyVariants)) {
      if (!matches(size, SAFE_ID_PATTERN)
        || (variantId !== null && !matches(variantId, VARIANT_ID_PATTERN))) {
        throw new ServiceError('PRODUCTION_DRAFT_STORE_CONFIG_INVALID');
      }
    }
    for (const [quantity, variantId] of Object.entries(config.surchargeVariants)) {
      if (!/^[1-9][0-9]{0,5}$/u.test(quantity) || !matches(variantId, VARIANT_ID_PATTERN)) {
        throw new ServiceError('PRODUCTION_DRAFT_STORE_CONFIG_INVALID');
      }
    }
  }
  return configs;
}

export function isLocalProductionMode(env) {
  return env?.LOCAL_PRODUCTION_FILES === true || env?.LOCAL_PRODUCTION_FILES === 'true';
}

export function validateProductionMultipartHeaders(request) {
  const contentType = request.headers?.get?.('content-type');
  if (!hasValidMultipartBoundary(contentType)) {
    throw new HttpError(415, 'Content-Type must be multipart/form-data with a boundary.');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength === null) throw new HttpError(411, 'Content-Length is required.');
  if (!/^[1-9][0-9]*$/u.test(declaredLength)) throw new HttpError(400, REQUEST_MESSAGE);
  const length = Number(declaredLength);
  if (!Number.isSafeInteger(length) || length > MAX_MULTIPART_BYTES) {
    throw new HttpError(413, 'Production draft request is too large.');
  }
}

function hasValidMultipartBoundary(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split(';').map((part) => part.trim());
  if (parts[0].toLowerCase() !== 'multipart/form-data') return false;
  const boundaries = parts.slice(1).filter((part) => /^boundary=/iu.test(part));
  if (boundaries.length !== 1) return false;
  const raw = boundaries[0].slice(boundaries[0].indexOf('=') + 1);
  const boundary = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  return boundary.length >= 1
    && boundary.length <= 70
    && /^[0-9A-Za-z'()+_,.\/:=? -]+$/u.test(boundary)
    && !boundary.endsWith(' ')
    && !boundary.includes('"');
}

export async function parseProductionDraftForm(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  if (!(form instanceof FormData)) throw new HttpError(400, REQUEST_MESSAGE);
  let entries;
  try {
    entries = Array.from(form.entries());
  } catch {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  if (entries.length !== 3 + PRODUCTION_PACKAGE_FILE_CONTRACT.length) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  const grouped = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
      throw new HttpError(400, REQUEST_MESSAGE);
    }
    const values = grouped.get(entry[0]) ?? [];
    values.push(entry[1]);
    grouped.set(entry[0], values);
  }
  const expectedNames = [
    'shop', 'uploadId', 'turnstileToken',
    ...PRODUCTION_PACKAGE_FILE_CONTRACT.map(({ filename }) => filename),
  ];
  if (grouped.size !== expectedNames.length
    || expectedNames.some((name) => grouped.get(name)?.length !== 1)
    || [...grouped.keys()].some((name) => !expectedNames.includes(name))) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  const shop = grouped.get('shop')[0];
  const uploadId = grouped.get('uploadId')[0];
  const turnstileToken = grouped.get('turnstileToken')[0];
  if (typeof shop !== 'string' || !SHOP_PATTERN.test(shop)
    || typeof uploadId !== 'string' || !UPLOAD_ID_PATTERN.test(uploadId)
    || typeof turnstileToken !== 'string'
    || turnstileToken.trim().length === 0
    || turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }

  let aggregateBytes = 0;
  const files = PRODUCTION_PACKAGE_FILE_CONTRACT.map((contract) => {
    const blob = snapshotFormFile(grouped.get(contract.filename)[0], contract);
    aggregateBytes += blob.size;
    if (aggregateBytes > MAX_PRODUCTION_PACKAGE_BYTES) throw new HttpError(400, REQUEST_MESSAGE);
    return Object.freeze({ filename: contract.filename, blob });
  });
  const manifest = await parseLightweightManifest(files[6].blob);
  return Object.freeze({ shop, uploadId, turnstileToken, files: Object.freeze(files), manifest });
}

function snapshotFormFile(value, contract) {
  if (!(value instanceof Blob)) throw new HttpError(400, REQUEST_MESSAGE);
  try {
    const sizeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
    const typeGetter = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')?.get;
    const size = sizeGetter.call(value);
    const type = typeGetter.call(value);
    const filename = readNativeFilename(value);
    if (filename !== contract.filename
      || size === 0
      || size > contract.maxBytes
      || type !== contract.mediaType) {
      throw new HttpError(400, REQUEST_MESSAGE);
    }
    return Blob.prototype.slice.call(value, 0, size, type);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, REQUEST_MESSAGE);
  }
}

function readNativeFilename(value) {
  let prototype = Object.getPrototypeOf(value);
  while (prototype && prototype !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'name');
    if (typeof descriptor?.get === 'function') return descriptor.get.call(value);
    prototype = Object.getPrototypeOf(prototype);
  }
  return null;
}

async function parseLightweightManifest(blob) {
  let manifest;
  try {
    manifest = JSON.parse(await Blob.prototype.text.call(blob));
  } catch {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  if (!isPlainObject(manifest)
    || !matches(manifest.designFingerprint, FINGERPRINT_PATTERN)
    || !matches(manifest.productId, PRODUCT_ID_PATTERN)
    || !matches(manifest.variantId, VARIANT_ID_PATTERN)
    || !matches(manifest.size, SAFE_ID_PATTERN)
    || !Array.isArray(manifest.files)
    || manifest.files.length !== 6) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
  const hashes = {};
  for (let index = 0; index < 6; index += 1) {
    const expected = PRODUCTION_PACKAGE_FILE_CONTRACT[index];
    const file = manifest.files[index];
    if (!isPlainObject(file)
      || file.name !== expected.filename
      || file.mediaType !== expected.mediaType
      || !Number.isSafeInteger(file.byteLength)
      || file.byteLength <= 0
      || !matches(file.sha256, SHA256_PATTERN)) {
      throw new HttpError(400, REQUEST_MESSAGE);
    }
    hashes[expected.filename] = file.sha256;
  }
  return Object.freeze({
    designFingerprint: manifest.designFingerprint,
    productId: manifest.productId,
    variantId: manifest.variantId,
    size: manifest.size,
    hashes: Object.freeze(hashes),
  });
}

export function assertProductionStoreIdentity(config, identity) {
  const variantId = config.jerseyVariants[identity.size];
  if (config.productId !== identity.productId
    || !matches(variantId, VARIANT_ID_PATTERN)
    || variantId !== identity.variantId) {
    throw new HttpError(400, REQUEST_MESSAGE);
  }
}

export async function verifyProductionTurnstile({ fetchImpl, ip, secret, timeoutMs, token }) {
  if (typeof fetchImpl !== 'function'
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > TURNSTILE_TIMEOUT_MS) {
    throw new ServiceError('PRODUCTION_DRAFT_TURNSTILE_CONFIGURATION_INVALID');
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const body = new URLSearchParams({ secret, response: token });
  if (typeof ip === 'string' && ip.length > 0) body.set('remoteip', ip);
  try {
    const response = await waitForAbort(fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    }), controller.signal);
    if (!response?.ok || typeof response.json !== 'function') {
      throw new ServiceError('PRODUCTION_DRAFT_TURNSTILE_SERVICE_FAILED');
    }
    const result = await waitForAbort(response.json(), controller.signal);
    if (!isPlainObject(result) || typeof result.success !== 'boolean' || typeof result.action !== 'string') {
      throw new ServiceError('PRODUCTION_DRAFT_TURNSTILE_RESULT_INVALID');
    }
    if (!result.success || result.action !== TURNSTILE_ACTION) {
      throw new HttpError(403, 'Turnstile verification failed.');
    }
  } catch (error) {
    if (error instanceof HttpError || error instanceof ServiceError) throw error;
    throw new ServiceError('PRODUCTION_DRAFT_TURNSTILE_SERVICE_FAILED');
  } finally {
    clearTimeout(timeoutId);
  }
}

function waitForAbort(value, signal) {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export async function consumeProductionRateLimit(rateLimit, shop, ip) {
  const client = typeof ip === 'string' && ip.length > 0 ? `ip:${ip}` : 'anonymous';
  let digest;
  try {
    digest = new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`production-draft:${shop}:${client}`),
    ));
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_RATE_HASH_FAILED');
  }
  let result;
  try {
    result = await rateLimit.limit({ key: `production-draft:${encodeBase64Url(digest).slice(0, 32)}` });
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_RATE_LIMIT_FAILED');
  }
  if (!isPlainObject(result) || typeof result.success !== 'boolean') {
    throw new ServiceError('PRODUCTION_DRAFT_RATE_LIMIT_RESULT_INVALID');
  }
  if (!result.success) throw new HttpError(429, 'Production draft upload rate limit exceeded.');
}

export async function consumeProductionPreflightRateLimit(rateLimit, ip) {
  const client = typeof ip === 'string' && ip.length > 0 ? `ip:${ip}` : 'anonymous';
  let digest;
  try {
    digest = new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`production-draft-preflight:${client}`),
    ));
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_PREFLIGHT_RATE_HASH_FAILED');
  }
  let result;
  try {
    result = await rateLimit.limit({
      key: `production-draft-preflight:${encodeBase64Url(digest).slice(0, 32)}`,
    });
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_PREFLIGHT_RATE_LIMIT_FAILED');
  }
  if (!isPlainObject(result) || typeof result.success !== 'boolean') {
    throw new ServiceError('PRODUCTION_DRAFT_PREFLIGHT_RATE_LIMIT_RESULT_INVALID');
  }
  if (!result.success) throw new HttpError(429, 'Production draft upload rate limit exceeded.');
}

export async function getProductionDraft(repository, shop, uploadId) {
  try {
    return await repository.getCartDraftByUpload(shop, uploadId);
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_D1_READ_FAILED');
  }
}

export function matchesReusableProductionDraft(draft, identity, now) {
  return isPlainObject(draft)
    && draft.status === 'cart_draft'
    && Number.isSafeInteger(draft.expiresAt)
    && draft.expiresAt > now
    && draft.designFingerprint === identity.designFingerprint
    && draft.productId === identity.productId
    && draft.variantId === identity.variantId
    && draft.size === identity.size
    && typeof draft.designId === 'string'
    && typeof draft.bundleFilename === 'string';
}

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function matches(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}
