import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
} from '../designs/productionManifest.js';

const SHOP_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const UPLOAD_ID_PATTERN = /^upl_[A-Za-z0-9_-]{16,64}$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8}$/u;
const BUNDLE_FILENAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}-design-([a-f0-9]{8})\.zip$/u;
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
    const form = createFormData(request);
    let response;
    try {
      response = await waitForAbortable(fetchImpl(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        body: form,
        signal: controller.signal,
      }), controller.signal);
      throwIfCancelled({ controller, signal, timedOut });
    } catch (error) {
      throwCancellationOrGeneric({ controller, error, signal, timedOut });
    }

    let body;
    try {
      body = await waitForAbortable(response.json(), controller.signal);
      throwIfCancelled({ controller, signal, timedOut });
    } catch (error) {
      throwCancellationOrGeneric({ controller, error, signal, timedOut });
    }

    if (!response.ok) throw new Error(getServerError(body) ?? GENERIC_ERROR);
    try {
      return snapshotResponse(body);
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
  assertSameOriginEndpoint(endpoint);
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
  ) {
    throw new TypeError('Turnstile verification is required.');
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('Production draft signal must be an AbortSignal.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new TypeError('Production draft timeout is invalid.');
  }
  return {
    files: snapshotFiles(artifact),
    shop,
    turnstileToken,
    uploadId,
  };
}

function snapshotFiles(artifact) {
  if (!isPlainObject(artifact) || !Array.isArray(artifact.files)) {
    throw new TypeError('Production draft files are invalid.');
  }
  if (
    artifact.files.length !== PRODUCTION_PACKAGE_FILE_CONTRACT.length
    || artifact.files.some((file, index) => (
      file?.filename !== PRODUCTION_PACKAGE_FILE_CONTRACT[index].filename
    ))
  ) {
    throw new TypeError('Production draft files are invalid.');
  }
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
    return { blob, filename };
  });
}

function createFormData({ files, shop, turnstileToken, uploadId }) {
  const form = new FormData();
  form.append('shop', shop);
  form.append('uploadId', uploadId);
  form.append('turnstileToken', turnstileToken);
  for (const file of files) form.append(file.filename, file.blob, file.filename);
  return form;
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
  ) {
    throw new TypeError('Production draft endpoint must be same-origin.');
  }
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
  return {
    designId: body.designId,
    designFingerprint: body.designFingerprint,
    bundleFilename: body.bundleFilename,
    expiresAt: body.expiresAt,
  };
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
