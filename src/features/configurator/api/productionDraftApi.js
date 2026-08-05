import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
  sha256Hex,
} from '../designs/productionManifest.js';

const SHOP_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const UPLOAD_ID_PATTERN = /^upl_[A-Za-z0-9_-]{16,64}$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const UPLOAD_TOKEN_PATTERN = /^upt_[A-Za-z0-9_-]{16,124}$/u;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const VARIANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8}$/u;
const BUNDLE_FILENAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}-design-([a-f0-9]{8})\.zip$/u;
const MAX_BUNDLE_BYTES = MAX_PRODUCTION_PACKAGE_BYTES + 64 * 1024;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_SERVER_ERROR_LENGTH = 200;
const DEFAULT_TIMEOUT_MS = 120_000;
const GENERIC_ERROR = 'Production draft upload failed.';
const TIMEOUT_ERROR = 'Production draft upload timed out. Try again.';

export async function uploadProductionDraft({
  artifact,
  endpoint = '/api/production-drafts',
  fetchImpl = fetch,
  shop,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  turnstileToken,
  uploadId,
} = {}) {
  const request = snapshotRequest({
    artifact,
    endpoint,
    fetchImpl,
    shop,
    signal,
    timeoutMs,
    turnstileToken,
    uploadId,
  });
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternalSignal = () => controller.abort();
  if (signal?.aborted) abortFromExternalSignal();
  else signal?.addEventListener('abort', abortFromExternalSignal, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    throwIfCancelled({ controller, signal, timedOut });
    let hashes;
    try {
      hashes = await waitForAbortable(Promise.all([
        sha256Hex(request.manifestBlob),
        sha256Hex(request.bundleBlob),
      ]), controller.signal);
      throwIfCancelled({ controller, signal, timedOut });
    } catch (error) {
      throwCancellationOrGeneric({ controller, error, signal, timedOut });
    }
    const [manifestSha256, bundleSha256] = hashes;

    const session = await requestJson({
      controller,
      fetchImpl,
      init: {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop: request.shop,
          uploadId: request.uploadId,
          turnstileToken: request.turnstileToken,
          design: request.design,
          manifest: {
            byteLength: request.manifestBlob.size,
            sha256: manifestSha256,
          },
          bundle: {
            filename: request.bundleFilename,
            byteLength: request.bundleBlob.size,
            sha256: bundleSha256,
          },
        }),
      },
      signal,
      timedOut: () => timedOut,
      url: request.endpoint,
    });
    let uploadSession;
    try {
      if (isPlainObject(session) && !Object.hasOwn(session, 'uploadToken')) {
        const completed = snapshotResponse(session);
        assertSessionMatchesRequest(completed, request);
        return completed;
      }
      uploadSession = snapshotSession(session);
      assertSessionMatchesRequest(uploadSession, request);
    } catch {
      throw new Error(GENERIC_ERROR);
    }

    const uploadHeaders = {
      Accept: 'application/json',
      'X-Production-Shop': request.shop,
      'X-Production-Upload-Id': request.uploadId,
      'X-Production-Upload-Token': uploadSession.uploadToken,
    };
    await requestEmpty({
      controller,
      fetchImpl,
      init: {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { ...uploadHeaders, 'Content-Type': 'application/json' },
        body: request.manifestBlob,
      },
      signal,
      timedOut: () => timedOut,
      url: createUploadUrl(request.endpoint, uploadSession.designId, 'manifest'),
    });
    const result = await requestJson({
      controller,
      fetchImpl,
      init: {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { ...uploadHeaders, 'Content-Type': 'application/zip' },
        body: request.bundleBlob,
      },
      signal,
      timedOut: () => timedOut,
      url: createUploadUrl(request.endpoint, uploadSession.designId, 'bundle'),
    });
    try {
      const response = snapshotResponse(result);
      if (
        response.designId !== uploadSession.designId
        || response.designFingerprint !== uploadSession.designFingerprint
        || response.bundleFilename !== uploadSession.bundleFilename
        || response.expiresAt !== uploadSession.expiresAt
      ) throw new Error(GENERIC_ERROR);
      return response;
    } catch {
      throw new Error(GENERIC_ERROR);
    }
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

function snapshotRequest({ artifact, endpoint, fetchImpl, shop, signal, timeoutMs, turnstileToken, uploadId }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  const normalizedEndpoint = assertSameOriginEndpoint(endpoint);
  if (typeof shop !== 'string' || !SHOP_DOMAIN_PATTERN.test(shop)) {
    throw new TypeError('A valid shop is required.');
  }
  if (typeof uploadId !== 'string' || !UPLOAD_ID_PATTERN.test(uploadId)) {
    throw new TypeError('A valid production draft upload ID is required.');
  }
  if (
    typeof turnstileToken !== 'string'
    || turnstileToken.trim().length === 0
    || turnstileToken.length > MAX_TOKEN_LENGTH
  ) throw new TypeError('Turnstile verification is required.');
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('Production draft signal must be an AbortSignal.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new TypeError('Production draft timeout is invalid.');
  }
  const files = snapshotFiles(artifact);
  const manifestBlob = files[files.length - 1].blob;
  const bundleBlob = artifact?.blob;
  if (
    !(bundleBlob instanceof Blob)
    || bundleBlob.type !== 'application/zip'
    || bundleBlob.size <= 0
    || bundleBlob.size > MAX_BUNDLE_BYTES
  ) throw new TypeError('Production draft bundle is invalid.');
  const design = snapshotDesign(artifact?.manifest);
  if (artifact?.fingerprint !== design.designFingerprint) {
    throw new TypeError('Production draft bundle is invalid.');
  }
  const filename = typeof artifact?.filename === 'string'
    ? BUNDLE_FILENAME_PATTERN.exec(artifact.filename)
    : null;
  if (!filename || filename[1] !== design.designFingerprint) {
    throw new TypeError('Production draft bundle is invalid.');
  }
  return Object.freeze({
    bundleBlob,
    bundleFilename: artifact.filename,
    design,
    endpoint: normalizedEndpoint,
    manifestBlob,
    shop,
    turnstileToken,
    uploadId,
  });
}

function snapshotFiles(artifact) {
  if (!isPlainObject(artifact) || !Array.isArray(artifact.files)) {
    throw new TypeError('Production draft files are invalid.');
  }
  if (
    artifact.files.length !== PRODUCTION_PACKAGE_FILE_CONTRACT.length
    || artifact.files.some((file, index) => file?.filename !== PRODUCTION_PACKAGE_FILE_CONTRACT[index].filename)
  ) throw new TypeError('Production draft files are invalid.');
  let totalBytes = 0;
  return artifact.files.map((file, index) => {
    const { filename, mediaType, maxBytes } = PRODUCTION_PACKAGE_FILE_CONTRACT[index];
    const blob = file?.blob;
    if (!(blob instanceof Blob) || blob.size === 0 || blob.type !== mediaType || blob.size > maxBytes) {
      throw new TypeError('Production draft files are invalid.');
    }
    totalBytes += blob.size;
    if (totalBytes > MAX_PRODUCTION_PACKAGE_BYTES) {
      throw new TypeError('Production draft files are invalid.');
    }
    return Object.freeze({ blob, filename });
  });
}

function snapshotDesign(manifest) {
  if (!isPlainObject(manifest) || !isPlainObject(manifest.model)) {
    throw new TypeError('Production draft manifest is invalid.');
  }
  const value = {
    designFingerprint: manifest.designFingerprint,
    productId: manifest.productId,
    variantId: manifest.variantId,
    size: manifest.size,
    modelId: manifest.model.id,
    modelVersion: manifest.model.version,
    uvExportVersion: manifest.uvExportVersion,
  };
  if (
    !FINGERPRINT_PATTERN.test(value.designFingerprint)
    || !PRODUCT_ID_PATTERN.test(value.productId)
    || !VARIANT_ID_PATTERN.test(value.variantId)
    || !SAFE_ID_PATTERN.test(value.size)
    || !SAFE_ID_PATTERN.test(value.modelId)
    || !SAFE_ID_PATTERN.test(value.modelVersion)
    || !SAFE_ID_PATTERN.test(value.uvExportVersion)
  ) throw new TypeError('Production draft manifest is invalid.');
  return Object.freeze(value);
}

async function requestJson({ controller, fetchImpl, init, signal, timedOut, url }) {
  const response = await performFetch({ controller, fetchImpl, init, signal, timedOut, url });
  let body;
  try {
    body = await waitForAbortable(response.json(), controller.signal);
    throwIfCancelled({ controller, signal, timedOut: timedOut() });
  } catch (error) {
    throwCancellationOrGeneric({ controller, error, signal, timedOut: timedOut() });
  }
  if (!response.ok) throw new Error(getServerError(body) ?? GENERIC_ERROR);
  return body;
}

async function requestEmpty({ controller, fetchImpl, init, signal, timedOut, url }) {
  const response = await performFetch({ controller, fetchImpl, init, signal, timedOut, url });
  if (response.ok) return;
  let body = null;
  try {
    body = await waitForAbortable(response.json(), controller.signal);
  } catch {
    // Unsafe or non-JSON server bodies intentionally collapse to a stable error.
  }
  throw new Error(getServerError(body) ?? GENERIC_ERROR);
}

async function performFetch({ controller, fetchImpl, init, signal, timedOut, url }) {
  try {
    const response = await waitForAbortable(fetchImpl(url, {
      ...init,
      signal: controller.signal,
    }), controller.signal);
    throwIfCancelled({ controller, signal, timedOut: timedOut() });
    return response;
  } catch (error) {
    throwCancellationOrGeneric({ controller, error, signal, timedOut: timedOut() });
  }
}

function snapshotSession(body) {
  assertExactPlainObject(body, [
    'designId', 'designFingerprint', 'bundleFilename', 'expiresAt', 'uploadToken',
  ]);
  const response = snapshotResponse({
    designId: body.designId,
    designFingerprint: body.designFingerprint,
    bundleFilename: body.bundleFilename,
    expiresAt: body.expiresAt,
  });
  if (typeof body.uploadToken !== 'string' || !UPLOAD_TOKEN_PATTERN.test(body.uploadToken)) {
    throw new TypeError('Production draft upload token is invalid.');
  }
  return Object.freeze({ ...response, uploadToken: body.uploadToken });
}

function assertSessionMatchesRequest(session, request) {
  if (
    session.designFingerprint !== request.design.designFingerprint
    || session.bundleFilename !== request.bundleFilename
  ) throw new Error(GENERIC_ERROR);
}

function snapshotResponse(body) {
  assertExactPlainObject(body, ['designId', 'designFingerprint', 'bundleFilename', 'expiresAt']);
  if (typeof body.designId !== 'string' || !DESIGN_ID_PATTERN.test(body.designId)) {
    throw new TypeError('Production draft design ID is invalid.');
  }
  if (typeof body.designFingerprint !== 'string' || !FINGERPRINT_PATTERN.test(body.designFingerprint)) {
    throw new TypeError('Production draft fingerprint is invalid.');
  }
  const filename = typeof body.bundleFilename === 'string'
    ? BUNDLE_FILENAME_PATTERN.exec(body.bundleFilename)
    : null;
  if (!filename || filename[1] !== body.designFingerprint) {
    throw new TypeError('Production draft bundle filename is invalid.');
  }
  if (!Number.isSafeInteger(body.expiresAt) || body.expiresAt <= Date.now()) {
    throw new TypeError('Production draft expiry is invalid.');
  }
  return Object.freeze({
    designId: body.designId,
    designFingerprint: body.designFingerprint,
    bundleFilename: body.bundleFilename,
    expiresAt: body.expiresAt,
  });
}

function createUploadUrl(endpoint, designId, kind) {
  const url = new URL(endpoint, window.location.href);
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/${designId}/${kind}`;
  url.search = '';
  return url.origin === window.location.origin ? `${url.pathname}` : url.href;
}

function assertSameOriginEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.startsWith('//')) {
    throw new TypeError('Production draft endpoint must be same-origin.');
  }
  const pageProtocol = window.location.protocol;
  let url;
  try {
    url = new URL(endpoint, window.location.href);
  } catch {
    throw new TypeError('Production draft endpoint must be same-origin.');
  }
  if (
    (pageProtocol !== 'http:' && pageProtocol !== 'https:')
    || url.protocol !== pageProtocol
    || url.origin !== window.location.origin
    || url.username
    || url.password
    || url.hash
  ) throw new TypeError('Production draft endpoint must be same-origin.');
  return endpoint;
}

function throwIfCancelled({ controller, signal, timedOut }) {
  if (!controller.signal.aborted) return;
  if (timedOut) throw new Error(TIMEOUT_ERROR);
  if (signal?.aborted) throw createAbortError('Production draft upload was cancelled.');
  throw new Error(GENERIC_ERROR);
}

function throwCancellationOrGeneric({ controller, error, signal, timedOut }) {
  if (timedOut) throw new Error(TIMEOUT_ERROR);
  if (signal?.aborted) throw createAbortError('Production draft upload was cancelled.');
  if (controller.signal.aborted && error?.name === 'AbortError') {
    throw createAbortError('Production draft upload was cancelled.');
  }
  if (error instanceof Error && error.message === GENERIC_ERROR) throw error;
  throw new Error(GENERIC_ERROR);
}

function createAbortError(message) {
  return new DOMException(message, 'AbortError');
}

function waitForAbortable(value, signal) {
  if (signal.aborted) return Promise.reject(createAbortError('Production draft upload was cancelled.'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(createAbortError('Production draft upload was cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function getServerError(body) {
  if (!isPlainObject(body) || typeof body.error !== 'string') return null;
  if (
    body.error.length === 0
    || body.error.length > MAX_SERVER_ERROR_LENGTH
    || /[\x00-\x1F\x7F]/u.test(body.error)
  ) return null;
  return body.error;
}

function assertExactPlainObject(value, expectedKeys) {
  if (!isPlainObject(value)) throw new TypeError('Production draft response must be a plain object.');
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) throw new TypeError('Production draft response fields are invalid.');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
