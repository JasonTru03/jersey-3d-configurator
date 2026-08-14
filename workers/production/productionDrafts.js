import { createShopFingerprint } from '../shopify/quoteContract.js';
import {
  CONFLICT_MESSAGE,
  HttpError,
  SERVICE_MESSAGE,
  ServiceError,
  TURNSTILE_TIMEOUT_MS,
  assertProductionStoreIdentity,
  consumeProductionPreflightRateLimit,
  consumeProductionRateLimit,
  getProductionDraft,
  isLocalProductionMode,
  isPlainObject,
  validateProductionDraftBindings,
  verifyProductionTurnstile,
} from './productionDraftRequest.js';
import {
  PRODUCTION_UPLOAD_LIMITS,
  matchesDeclaredDraft,
  parseProductionDraftSession,
  parseProductionUploadAuthorization,
  validateSessionHeaders,
} from './productionDraftProtocol.js';
import { createProductionRepository } from './productionRepository.js';

const CART_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DESIGN_ID_PATTERN = /^dsg_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UPLOAD_TOKEN_PATTERN = /^upt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHOP_FINGERPRINT_PATTERN = /^shop_[A-Za-z0-9_-]{12}$/u;
const UPLOAD_PATH_PATTERN = /^\/api\/production-drafts\/(dsg_[A-Za-z0-9_-]{16,64})\/(manifest|bundle)$/u;

export function createProductionDraftsHandler(env, dependencies = {}) {
  const createRepository = dependencies.createProductionRepository ?? createProductionRepository;
  const createConfigRepository = dependencies.createStoreConfigRepository;
  const fingerprintShop = dependencies.createShopFingerprint ?? createShopFingerprint;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());
  const logger = dependencies.logger ?? console;
  const turnstileTimeoutMs = dependencies.turnstileTimeoutMs ?? TURNSTILE_TIMEOUT_MS;

  return async function handleProductionDraft(request) {
    const pathname = readPathname(request);
    if (pathname === '/api/production-drafts/config') {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      return handlePublicConfig(env);
    }
    const uploadRoute = UPLOAD_PATH_PATTERN.exec(pathname);
    if (uploadRoute) {
      if (request.method !== 'PUT') return methodNotAllowed('PUT');
      return guard(logger, () => handleUpload({
        createRepository,
        designId: uploadRoute[1],
        env,
        kind: uploadRoute[2],
        logger,
        now,
        request,
      }));
    }
    if (pathname !== '/api/production-drafts') return errorResponse(404, 'Not found.');
    if (request.method !== 'POST') return methodNotAllowed('POST');
    return guard(logger, () => handleCreateSession({
      createConfigRepository,
      createRepository,
      env,
      fetchImpl,
      fingerprintShop,
      now,
      randomUUID,
      request,
      turnstileTimeoutMs,
    }));
  };
}

async function handleCreateSession({
  createConfigRepository,
  createRepository,
  env,
  fetchImpl,
  fingerprintShop,
  now,
  randomUUID,
  request,
  turnstileTimeoutMs,
}) {
  const bindings = validateProductionDraftBindings(env, createRepository, createConfigRepository);
  validateSessionHeaders(request);
  const ip = request.headers.get('cf-connecting-ip');
  await consumeProductionPreflightRateLimit(bindings.rateLimit, ip);
  const session = await parseProductionDraftSession(request);
  const storedConfig = await bindings.configRepository.get(session.shop);
  const storeConfig = storedConfig?.status === 'active' ? storedConfig.config : null;
  if (!storeConfig) throw new ServiceError('PRODUCTION_DRAFT_STORE_NOT_CONFIGURED');
  await verifyProductionTurnstile({
    fetchImpl,
    ip,
    secret: bindings.turnstileSecret,
    timeoutMs: turnstileTimeoutMs,
    token: session.turnstileToken,
  });
  await consumeProductionRateLimit(bindings.rateLimit, session.shop, ip);
  assertProductionStoreIdentity(storeConfig, session.design);

  const currentTime = readClock(now);
  const existing = await getProductionDraft(bindings.repository, session.shop, session.uploadId);
  if (existing) return reuseSession(existing, session, currentTime);

  const shopFingerprint = await createFingerprint(fingerprintShop, session.shop);
  const designId = createIdentifier(randomUUID, 'dsg', DESIGN_ID_PATTERN);
  const uploadToken = createIdentifier(randomUUID, 'upt', UPLOAD_TOKEN_PATTERN);
  const expiresAt = currentTime + CART_DRAFT_TTL_MS;
  if (!Number.isSafeInteger(expiresAt)) throw new ServiceError('PRODUCTION_DRAFT_EXPIRY_INVALID');
  const prefix = `shops/${shopFingerprint}/designs/${designId}/`;
  const draft = Object.freeze({
    designId,
    shop: session.shop,
    uploadId: session.uploadId,
    productId: session.design.productId,
    variantId: session.design.variantId,
    size: session.design.size,
    modelId: session.design.modelId,
    modelVersion: session.design.modelVersion,
    uvExportVersion: session.design.uvExportVersion,
    designFingerprint: session.design.designFingerprint,
    manifestSha256: session.manifest.sha256,
    manifestBytes: session.manifest.byteLength,
    manifestKey: `${prefix}manifest.json`,
    bundleSha256: session.bundle.sha256,
    bundleBytes: session.bundle.byteLength,
    bundleKey: `${prefix}${session.bundle.filename}`,
    bundleFilename: session.bundle.filename,
    createdAt: currentTime,
    expiresAt,
    uploadToken,
    updatedAt: currentTime,
  });

  let authoritative;
  try {
    authoritative = await bindings.repository.createUploadPending(draft);
  } catch {
    authoritative = await getProductionDraft(bindings.repository, session.shop, session.uploadId);
    if (!authoritative) throw new ServiceError('PRODUCTION_DRAFT_D1_RESERVATION_FAILED');
  }
  return reuseSession(authoritative, session, currentTime);
}

async function handleUpload({ createRepository, designId, env, kind, logger, now, request }) {
  const bindings = validateProductionDraftBindings(env, createRepository);
  const expected = kind === 'manifest'
    ? { contentType: 'application/json', maxBytes: PRODUCTION_UPLOAD_LIMITS.manifest }
    : { contentType: 'application/zip', maxBytes: PRODUCTION_UPLOAD_LIMITS.bundle };
  const auth = parseProductionUploadAuthorization(request, expected);
  const currentTime = readClock(now);
  let draft;
  try {
    draft = await bindings.repository.getOwnedUploadPending({
      shop: auth.shop,
      designId,
      uploadId: auth.uploadId,
      uploadToken: auth.uploadToken,
    });
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_D1_READ_FAILED');
  }
  if (!draft) throw new HttpError(401, 'Production upload authorization is invalid.');
  if (draft.expiresAt <= currentTime) throw new HttpError(409, 'Production upload session has expired.');

  const expectedBytes = kind === 'manifest' ? draft.manifestBytes : draft.bundleBytes;
  if (auth.byteLength !== expectedBytes) {
    logger?.error?.(JSON.stringify({
      code: 'PRODUCTION_DRAFT_UPLOAD_LENGTH_MISMATCH',
      kind,
      expectedBytes,
      receivedBytes: auth.byteLength,
    }));
    throw new HttpError(400, 'Production upload length does not match.');
  }
  if (kind === 'bundle') await assertManifestStored(bindings.assets, draft);
  const key = kind === 'manifest' ? draft.manifestKey : draft.bundleKey;
  const sha256 = kind === 'manifest' ? draft.manifestSha256 : draft.bundleSha256;
  await putStream(bindings.assets, key, request.body, {
    contentType: expected.contentType,
    draft,
    sha256,
    byteLength: expectedBytes,
  });
  if (kind === 'manifest') {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  let finalized;
  try {
    finalized = await bindings.repository.finalizeCartDraft({
      shop: draft.shop,
      designId: draft.designId,
      uploadId: draft.uploadId,
      uploadToken: draft.uploadToken,
      updatedAt: currentTime,
    });
  } catch {
    const recovered = await getProductionDraft(bindings.repository, draft.shop, draft.uploadId);
    if (recovered?.status === 'cart_draft' && matchesStoredDraft(recovered, draft)) {
      return successResponse(recovered);
    }
    throw new ServiceError('PRODUCTION_DRAFT_D1_WRITE_FAILED');
  }
  if (finalized.status !== 'cart_draft' || !matchesStoredDraft(finalized, draft)) {
    throw new ServiceError('PRODUCTION_DRAFT_FINALIZE_UNCONFIRMED');
  }
  return successResponse(finalized);
}

function reuseSession(draft, session, now) {
  if (!matchesDeclaredDraft(draft, session, now)) throw new HttpError(409, CONFLICT_MESSAGE);
  if (draft.status === 'cart_draft') return successResponse(draft);
  if (draft.status !== 'upload_pending' || typeof draft.uploadToken !== 'string') {
    throw new HttpError(409, CONFLICT_MESSAGE);
  }
  return jsonResponse(201, {
    designId: draft.designId,
    designFingerprint: draft.designFingerprint,
    bundleFilename: draft.bundleFilename,
    expiresAt: draft.expiresAt,
    uploadToken: draft.uploadToken,
  });
}

async function assertManifestStored(assets, draft) {
  let object;
  try {
    object = await assets.head(draft.manifestKey);
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_R2_READ_FAILED');
  }
  if (!object
    || object.key !== draft.manifestKey
    || object.size !== draft.manifestBytes
    || object.customMetadata?.sha256 !== draft.manifestSha256) {
    throw new HttpError(409, 'Production manifest must be uploaded first.');
  }
}

async function putStream(assets, key, stream, { contentType, draft, sha256, byteLength }) {
  let result;
  try {
    result = await assets.put(key, stream, {
      httpMetadata: { contentType },
      sha256,
      customMetadata: {
        designFingerprint: draft.designFingerprint,
        productId: draft.productId,
        variantId: draft.variantId,
        size: draft.size,
        contentLength: String(byteLength),
        sha256,
      },
    });
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_R2_WRITE_FAILED');
  }
  if (!isPlainObject(result) || result.key !== key || result.size !== byteLength) {
    throw new ServiceError('PRODUCTION_DRAFT_R2_WRITE_RESULT_INVALID');
  }
}

function matchesStoredDraft(value, expected) {
  return isPlainObject(value)
    && value.designId === expected.designId
    && value.shop === expected.shop
    && value.uploadId === expected.uploadId
    && value.designFingerprint === expected.designFingerprint
    && value.manifestSha256 === expected.manifestSha256
    && value.manifestBytes === expected.manifestBytes
    && value.bundleSha256 === expected.bundleSha256
    && value.bundleBytes === expected.bundleBytes
    && value.bundleFilename === expected.bundleFilename;
}

function readPathname(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return '';
  }
}

function handlePublicConfig(env) {
  if (isLocalProductionMode(env)
    || typeof env?.TURNSTILE_SITE_KEY !== 'string'
    || env.TURNSTILE_SITE_KEY.length === 0) {
    return errorResponse(503, SERVICE_MESSAGE);
  }
  return jsonResponse(200, { turnstileSiteKey: env.TURNSTILE_SITE_KEY });
}

async function guard(logger, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error.status, error.message, error.headers);
    const code = error instanceof ServiceError
      ? error.code
      : 'PRODUCTION_DRAFT_UNEXPECTED_FAILURE';
    logCode(logger, code);
    return errorResponse(503, SERVICE_MESSAGE);
  }
}

function readClock(now) {
  let value;
  try {
    value = now();
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_CLOCK_FAILED');
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ServiceError('PRODUCTION_DRAFT_CLOCK_INVALID');
  }
  return value;
}

function createIdentifier(randomUUID, prefix, pattern) {
  let uuid;
  try {
    uuid = randomUUID();
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_RANDOM_FAILED');
  }
  const value = `${prefix}_${uuid}`;
  if (!pattern.test(value)) throw new ServiceError('PRODUCTION_DRAFT_RANDOM_INVALID');
  return value;
}

async function createFingerprint(fingerprintShop, shop) {
  let fingerprint;
  try {
    fingerprint = await fingerprintShop(shop);
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_SHOP_FINGERPRINT_FAILED');
  }
  if (typeof fingerprint !== 'string' || !SHOP_FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new ServiceError('PRODUCTION_DRAFT_SHOP_FINGERPRINT_INVALID');
  }
  return fingerprint;
}

function successResponse(draft) {
  return jsonResponse(201, {
    designId: draft.designId,
    designFingerprint: draft.designFingerprint,
    bundleFilename: draft.bundleFilename,
    expiresAt: draft.expiresAt,
  });
}

function methodNotAllowed(method) {
  return errorResponse(405, `Method must be ${method}.`, { Allow: method });
}

function errorResponse(status, message, headers = {}) {
  return jsonResponse(status, { error: message }, headers);
}

function jsonResponse(status, body, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

function logCode(logger, code) {
  try {
    logger?.error?.(code);
  } catch {
    // Stable responses must not depend on logging availability.
  }
}
