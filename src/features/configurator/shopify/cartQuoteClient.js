const SHOP_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const BUNDLE_ID_PATTERN = /^bun_[A-Za-z0-9_-]{16,64}$/u;
const HANDOFF_PATH = '/apps/jersey-configurator/cart-handoff';
const MAX_TOKEN_LENGTH = 255;
const MAX_SERVER_ERROR_LENGTH = 200;
const GENERIC_ERROR = 'Secure cart preparation failed.';
const TIMEOUT_ERROR = 'Secure cart request timed out. Try again.';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const PRODUCTION_FILE_KEYS = [
  'atlasFilename',
  'atlasSha256',
  'bundleFilename',
  'designFilename',
];
export async function createSecureCartHandoff({
  endpoint = '/api/cart-quotes',
  context,
  state,
  productionFiles,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const request = snapshotRequest({
    endpoint,
    context,
    state,
    productionFiles,
    signal,
    timeoutMs,
    fetchImpl,
  });
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternalSignal = () => controller.abort(signal.reason);
  if (signal?.aborted) abortFromExternalSignal();
  else signal?.addEventListener('abort', abortFromExternalSignal, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(createAbortError('Secure cart request timed out.'));
  }, timeoutMs);

  try {
    throwIfCancelled({ controller, signal, timedOut });
    let response;
    try {
      response = await waitForAbortable(fetchImpl(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shop: request.shop,
          state,
          productionFiles: request.productionFiles,
        }),
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

    if (!response.ok) {
      throw new Error(getServerError(body) ?? GENERIC_ERROR);
    }

    try {
      return snapshotResponse(body, request.shop);
    } catch {
      throw new Error(GENERIC_ERROR);
    }
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromExternalSignal);
  }
}

function snapshotRequest({ endpoint, context, state, productionFiles, signal, timeoutMs, fetchImpl }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!isPlainObject(context)) {
    throw new TypeError('A valid Shopify launch context is required.');
  }
  const shop = context.shop;
  if (typeof shop !== 'string' || !SHOP_DOMAIN_PATTERN.test(shop)) {
    throw new TypeError('A valid Shopify launch context is required.');
  }
  if (!isPlainObject(state)) throw new TypeError('A design state is required.');
  assertSameOriginEndpoint(endpoint);
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('Cart quote signal must be an AbortSignal.');
  }
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs <= 0
    || timeoutMs > MAX_TIMEOUT_MS
  ) throw new TypeError('Cart quote timeout is invalid.');
  return {
    shop,
    productionFiles: productionFiles === undefined || productionFiles === null
      ? null
      : snapshotProductionFiles(productionFiles),
  };
}

function assertSameOriginEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.startsWith('//')) {
    throw new TypeError('Cart quote endpoint must be same-origin.');
  }
  let url;
  try {
    url = new URL(endpoint, window.location.href);
  } catch {
    throw new TypeError('Cart quote endpoint must be same-origin.');
  }
  if (
    url.origin !== window.location.origin
    || url.username
    || url.password
    || url.hash
  ) {
    throw new TypeError('Cart quote endpoint must be same-origin.');
  }
}

function snapshotProductionFiles(value) {
  assertExactPlainObject(value, PRODUCTION_FILE_KEYS, 'Production files');
  const snapshot = {};
  for (const key of PRODUCTION_FILE_KEYS) {
    const fieldValue = value[key];
    if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
      throw new TypeError(`Production files ${key} is invalid.`);
    }
    snapshot[key] = fieldValue;
  }
  return snapshot;
}

function throwIfCancelled({ controller, signal, timedOut }) {
  if (!controller.signal.aborted) return;
  if (timedOut) throw new Error(TIMEOUT_ERROR);
  if (signal?.aborted) throw createAbortError('Secure cart request was cancelled.');
  throw new Error(GENERIC_ERROR);
}

function throwCancellationOrGeneric({ controller, error, signal, timedOut }) {
  if (timedOut) throw new Error(TIMEOUT_ERROR);
  if (signal?.aborted) throw createAbortError('Secure cart request was cancelled.');
  if (controller.signal.aborted && error?.name === 'AbortError') {
    throw createAbortError('Secure cart request was cancelled.');
  }
  throw new Error(GENERIC_ERROR);
}

function createAbortError(message) {
  return new DOMException(message, 'AbortError');
}

function waitForAbortable(value, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? createAbortError('Request cancelled.'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? createAbortError('Request cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(value).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function snapshotResponse(body, shop) {
  const keys = ['handoffUrl', 'designId', 'bundleId', 'expiresAt'];
  assertExactPlainObject(body, keys, 'Cart quote response');
  if (typeof body.handoffUrl !== 'string' || !isSafeHandoffUrl(body.handoffUrl, shop)) {
    throw new TypeError('Cart quote handoff URL is invalid.');
  }
  if (typeof body.designId !== 'string' || !DESIGN_ID_PATTERN.test(body.designId)) {
    throw new TypeError('Cart quote design ID is invalid.');
  }
  if (typeof body.bundleId !== 'string' || !BUNDLE_ID_PATTERN.test(body.bundleId)) {
    throw new TypeError('Cart quote bundle ID is invalid.');
  }
  if (!Number.isSafeInteger(body.expiresAt) || body.expiresAt <= Date.now()) {
    throw new TypeError('Cart quote expiry is invalid.');
  }
  return {
    handoffUrl: body.handoffUrl,
    designId: body.designId,
    bundleId: body.bundleId,
    expiresAt: body.expiresAt,
  };
}

function isSafeHandoffUrl(value, shop) {
  if (!value.startsWith(`https://${shop}/`)) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== shop
    || url.port
    || url.username
    || url.password
    || url.hash
    || url.pathname !== HANDOFF_PATH
  ) return false;
  const queryKeys = [...url.searchParams.keys()];
  const tokens = url.searchParams.getAll('token');
  return queryKeys.length === 1
    && queryKeys[0] === 'token'
    && tokens.length === 1
    && tokens[0].length > 0
    && tokens[0].length <= MAX_TOKEN_LENGTH;
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

function assertExactPlainObject(value, expectedKeys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object.`);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) throw new TypeError(`${label} fields are invalid.`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
