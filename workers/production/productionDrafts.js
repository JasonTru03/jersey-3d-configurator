import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
  sha256Hex,
} from '../../src/features/configurator/designs/productionManifest.js';
import { createShopFingerprint } from '../shopify/quoteContract.js';
import {
  ProductionPackageValidationError,
  validateAndRebuildUploadedProductionPackage,
} from './productionPackageValidator.js';
import {
  CONFLICT_MESSAGE,
  HttpError,
  REQUEST_MESSAGE,
  SERVICE_MESSAGE,
  ServiceError,
  TURNSTILE_TIMEOUT_MS,
  assertProductionStoreIdentity,
  consumeProductionPreflightRateLimit,
  consumeProductionRateLimit,
  getProductionDraft,
  isLocalProductionMode,
  isPlainObject,
  matchesReusableProductionDraft,
  parseProductionDraftForm,
  validateProductionDraftBindings,
  validateProductionMultipartHeaders,
  verifyProductionTurnstile,
} from './productionDraftRequest.js';
import { createProductionRepository } from './productionRepository.js';
import { sha256ReadableStreamHex } from './incrementalSha256.js';

const CART_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UPLOAD_LEASE_MS = 15 * 60 * 1000;
const MAX_BUNDLE_BYTES = MAX_PRODUCTION_PACKAGE_BYTES + 64 * 1024;
const DESIGN_ID_PATTERN = /^dsg_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UPLOAD_TOKEN_PATTERN = /^upt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CLEANUP_TOKEN_PATTERN = /^cln_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const VARIANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/u;
const FINGERPRINT_PATTERN = /^[a-f0-9]{8}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHOP_FINGERPRINT_PATTERN = /^shop_[A-Za-z0-9_-]{12}$/u;

export function createProductionDraftsHandler(env, dependencies = {}) {
  const validateAndRebuild = dependencies.validateAndRebuildUploadedProductionPackage
    ?? validateAndRebuildUploadedProductionPackage;
  const createRepository = dependencies.createProductionRepository ?? createProductionRepository;
  const fingerprintShop = dependencies.createShopFingerprint ?? createShopFingerprint;
  const hashBlob = dependencies.sha256Hex ?? sha256Hex;
  const hashStream = dependencies.sha256ReadableStreamHex ?? sha256ReadableStreamHex;
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
    if (pathname !== '/api/production-drafts') return errorResponse(404, 'Not found.');
    if (request.method !== 'POST') return methodNotAllowed('POST');

    try {
      const bindings = validateProductionDraftBindings(env, createRepository);
      validateProductionMultipartHeaders(request);
      await consumeProductionPreflightRateLimit(
        bindings.rateLimit,
        request.headers.get('cf-connecting-ip'),
      );
      const form = await parseProductionDraftForm(request);
      const storeConfig = bindings.storeConfigs[form.shop];
      if (!storeConfig) throw new ServiceError('PRODUCTION_DRAFT_STORE_NOT_CONFIGURED');

      await verifyProductionTurnstile({
        fetchImpl,
        ip: request.headers.get('cf-connecting-ip'),
        secret: bindings.turnstileSecret,
        timeoutMs: turnstileTimeoutMs,
        token: form.turnstileToken,
      });
      await consumeProductionRateLimit(
        bindings.rateLimit,
        form.shop,
        request.headers.get('cf-connecting-ip'),
      );
      assertProductionStoreIdentity(storeConfig, form.manifest);

      const currentTime = readClock(now);
      const existing = await getProductionDraft(bindings.repository, form.shop, form.uploadId);
      if (existing) {
        if (matchesReusableProductionDraft(existing, form.manifest, currentTime)) {
          return successResponse(existing);
        }
        if (existing.status !== 'upload_pending'
          || !Number.isSafeInteger(existing.uploadStartedAt)
          || existing.uploadStartedAt > currentTime - UPLOAD_LEASE_MS) {
          throw new HttpError(409, CONFLICT_MESSAGE);
        }
      }

      const packageSnapshot = await validatePackage(validateAndRebuild, form);
      assertValidatedIdentity(packageSnapshot.validated, form.manifest, storeConfig);
      const shopFingerprint = await createFingerprint(fingerprintShop, form.shop);
      const manifestSha256 = await createManifestHash(
        hashBlob,
        packageSnapshot.validated.files[6].blob,
      );
      const designId = existing?.designId ?? createDesignId(randomUUID);
      const uploadToken = createLeaseToken(randomUUID, 'upt', UPLOAD_TOKEN_PATTERN);
      const expiresAt = existing?.expiresAt ?? currentTime + CART_DRAFT_TTL_MS;
      if (!Number.isSafeInteger(expiresAt)) throw new ServiceError('PRODUCTION_DRAFT_EXPIRY_INVALID');
      const prefix = `shops/${shopFingerprint}/designs/${designId}/`;
      const keys = [
        ...PRODUCTION_PACKAGE_FILE_CONTRACT.map(({ filename }) => `${prefix}${filename}`),
        `${prefix}${packageSnapshot.bundle.filename}`,
      ];
      const draft = createDraftRecord({
        currentTime,
        designId,
        expiresAt,
        form,
        keys,
        manifestSha256,
        packageSnapshot,
        uploadToken,
      });

      let reservation;
      if (existing) {
        if (!matchesStrictPendingDraft(existing, draft, currentTime)) {
          throw new HttpError(409, CONFLICT_MESSAGE);
        }
        try {
          reservation = await bindings.repository.takeOverStaleUpload({
            shop: form.shop,
            designId,
            uploadId: form.uploadId,
            previousUploadToken: existing.uploadToken,
            newUploadToken: uploadToken,
            startedAt: currentTime,
            staleBefore: currentTime - UPLOAD_LEASE_MS,
          });
        } catch (error) {
          if (error?.code === 'production-repository-conflict') {
            throw new HttpError(409, CONFLICT_MESSAGE);
          }
          throw new ServiceError('PRODUCTION_DRAFT_D1_TAKEOVER_FAILED');
        }
      } else {
        reservation = await reservePendingDraft(
          bindings.repository,
          draft,
          form.manifest,
          currentTime,
        );
        if (matchesReusableProductionDraft(reservation, form.manifest, currentTime)) {
          return successResponse(reservation);
        }
      }
      if (!matchesOwnedPendingDraft(reservation, draft, currentTime)) {
        throw new HttpError(409, CONFLICT_MESSAGE);
      }

      try {
        const bundleSha256 = await createBundleHash(hashStream, packageSnapshot.bundle.stream);
        await storePackage(
          bindings.assets,
          keys,
          packageSnapshot,
          form.manifest,
          manifestSha256,
          bundleSha256,
        );
      } catch {
        await cleanupOwnedUpload({
          assets: bindings.assets,
          draft,
          keys,
          logger,
          now: currentTime,
          randomUUID,
          repository: bindings.repository,
        });
        throw new ServiceError('PRODUCTION_DRAFT_R2_WRITE_FAILED');
      }

      let authoritative;
      try {
        authoritative = await bindings.repository.finalizeCartDraft({
          shop: form.shop,
          designId,
          uploadId: form.uploadId,
          uploadToken,
          updatedAt: currentTime,
        });
      } catch {
        const recovery = await recoverDraft(bindings.repository, form.shop, form.uploadId);
        if (recovery.kind === 'read_failed') {
          throw new ServiceError('PRODUCTION_DRAFT_D1_RECOVERY_READ_FAILED');
        }
        if (recovery.kind === 'found'
          && recovery.draft.designId === designId
          && matchesReusableProductionDraft(recovery.draft, form.manifest, currentTime)) {
          return successResponse(recovery.draft);
        }
        await cleanupOwnedUpload({
          assets: bindings.assets,
          draft,
          keys,
          logger,
          now: currentTime,
          randomUUID,
          repository: bindings.repository,
        });
        throw new ServiceError('PRODUCTION_DRAFT_D1_WRITE_FAILED');
      }

      if (authoritative.designId === designId
        && matchesReusableProductionDraft(authoritative, form.manifest, currentTime)) {
        return successResponse(authoritative);
      }
      await cleanupOwnedUpload({
        assets: bindings.assets,
        draft,
        keys,
        logger,
        now: currentTime,
        randomUUID,
        repository: bindings.repository,
      });
      throw new ServiceError('PRODUCTION_DRAFT_FINALIZE_UNCONFIRMED');
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, error.message, error.headers);
      }
      const code = error instanceof ServiceError
        ? error.code
        : 'PRODUCTION_DRAFT_UNEXPECTED_FAILURE';
      logCode(logger, code);
      return errorResponse(503, SERVICE_MESSAGE);
    }
  };
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

function readClock(now) {
  let currentTime;
  try {
    currentTime = now();
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_CLOCK_FAILED');
  }
  if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
    throw new ServiceError('PRODUCTION_DRAFT_CLOCK_INVALID');
  }
  return currentTime;
}

async function validatePackage(validateAndRebuild, form) {
  let result;
  try {
    result = await validateAndRebuild({ expectedShop: form.shop, files: form.files });
  } catch (error) {
    if (error instanceof ProductionPackageValidationError
      || error?.code === 'invalid-production-package') {
      throw new HttpError(400, REQUEST_MESSAGE);
    }
    throw new ServiceError('PRODUCTION_DRAFT_PACKAGE_REBUILD_FAILED');
  }
  return snapshotPackageResult(result);
}

function snapshotPackageResult(result) {
  if (!isPlainObject(result) || !isPlainObject(result.validated) || !isPlainObject(result.bundle)) {
    throw new ServiceError('PRODUCTION_DRAFT_PACKAGE_RESULT_INVALID');
  }
  const validated = result.validated;
  const bundle = result.bundle;
  if (!matches(validated.designFingerprint, FINGERPRINT_PATTERN)
    || !matches(validated.productId, PRODUCT_ID_PATTERN)
    || !matches(validated.variantId, VARIANT_ID_PATTERN)
    || !matches(validated.size, SAFE_ID_PATTERN)
    || !matches(validated.modelId, SAFE_ID_PATTERN)
    || !matches(validated.modelVersion, SAFE_ID_PATTERN)
    || !matches(validated.uvExportVersion, SAFE_ID_PATTERN)
    || !Array.isArray(validated.files)
    || validated.files.length !== PRODUCTION_PACKAGE_FILE_CONTRACT.length
    || typeof bundle.filename !== 'string'
    || bundle.filename !== `${validated.productId}-design-${validated.designFingerprint}.zip`
    || bundle.mediaType !== 'application/zip'
    || !(bundle.stream instanceof ReadableStream)
    || typeof bundle.createStream !== 'function'
    || !Number.isSafeInteger(bundle.contentLength)
    || bundle.contentLength <= 0
    || bundle.contentLength > MAX_BUNDLE_BYTES) {
    throw new ServiceError('PRODUCTION_DRAFT_PACKAGE_RESULT_INVALID');
  }
  validated.files.forEach((file, index) => {
    const contract = PRODUCTION_PACKAGE_FILE_CONTRACT[index];
    if (!isPlainObject(file)
      || file.filename !== contract.filename
      || !(file.blob instanceof Blob)
      || file.blob.size <= 0
      || file.blob.size > contract.maxBytes
      || file.blob.type !== contract.mediaType) {
      throw new ServiceError('PRODUCTION_DRAFT_PACKAGE_RESULT_INVALID');
    }
  });
  return { validated, bundle };
}

function assertValidatedIdentity(validated, manifest, storeConfig) {
  if (validated.designFingerprint !== manifest.designFingerprint
    || validated.productId !== manifest.productId
    || validated.variantId !== manifest.variantId
    || validated.size !== manifest.size) {
    throw new ServiceError('PRODUCTION_DRAFT_VALIDATED_IDENTITY_MISMATCH');
  }
  assertProductionStoreIdentity(storeConfig, validated);
}

function createDesignId(randomUUID) {
  let uuid;
  try {
    uuid = randomUUID();
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_RANDOM_FAILED');
  }
  const designId = `dsg_${uuid}`;
  if (!DESIGN_ID_PATTERN.test(designId)) throw new ServiceError('PRODUCTION_DRAFT_RANDOM_INVALID');
  return designId;
}

function createLeaseToken(randomUUID, prefix, pattern) {
  let uuid;
  try {
    uuid = randomUUID();
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_RANDOM_FAILED');
  }
  const token = `${prefix}_${uuid}`;
  if (!pattern.test(token)) throw new ServiceError('PRODUCTION_DRAFT_RANDOM_INVALID');
  return token;
}

async function createFingerprint(fingerprintShop, shop) {
  let fingerprint;
  try {
    fingerprint = await fingerprintShop(shop);
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_SHOP_FINGERPRINT_FAILED');
  }
  if (!matches(fingerprint, SHOP_FINGERPRINT_PATTERN)) {
    throw new ServiceError('PRODUCTION_DRAFT_SHOP_FINGERPRINT_INVALID');
  }
  return fingerprint;
}

async function createManifestHash(hashBlob, blob) {
  let hash;
  try {
    hash = await hashBlob(blob);
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_MANIFEST_HASH_FAILED');
  }
  if (typeof hash !== 'string' || !SHA256_PATTERN.test(hash)) {
    throw new ServiceError('PRODUCTION_DRAFT_MANIFEST_HASH_INVALID');
  }
  return hash;
}

function createDraftRecord({
  currentTime,
  designId,
  expiresAt,
  form,
  keys,
  manifestSha256,
  packageSnapshot,
  uploadToken,
}) {
  return {
    designId,
    shop: form.shop,
    uploadId: form.uploadId,
    productId: packageSnapshot.validated.productId,
    variantId: packageSnapshot.validated.variantId,
    size: packageSnapshot.validated.size,
    modelId: packageSnapshot.validated.modelId,
    modelVersion: packageSnapshot.validated.modelVersion,
    uvExportVersion: packageSnapshot.validated.uvExportVersion,
    designFingerprint: packageSnapshot.validated.designFingerprint,
    manifestSha256,
    manifestKey: keys[6],
    bundleKey: keys[7],
    bundleFilename: packageSnapshot.bundle.filename,
    createdAt: currentTime,
    expiresAt,
    uploadToken,
    uploadStartedAt: currentTime,
    updatedAt: currentTime,
  };
}

async function createBundleHash(hashStream, stream) {
  let hash;
  try {
    hash = await hashStream(stream);
  } catch {
    throw new ServiceError('PRODUCTION_DRAFT_BUNDLE_HASH_FAILED');
  }
  if (!matches(hash, SHA256_PATTERN)) {
    throw new ServiceError('PRODUCTION_DRAFT_BUNDLE_HASH_INVALID');
  }
  return hash;
}

async function reservePendingDraft(repository, draft, manifest, currentTime) {
  let authoritative;
  try {
    authoritative = await repository.createUploadPending(draft);
  } catch {
    const recovery = await recoverDraft(repository, draft.shop, draft.uploadId);
    if (recovery.kind === 'read_failed') {
      throw new ServiceError('PRODUCTION_DRAFT_D1_RESERVATION_READ_FAILED');
    }
    if (recovery.kind === 'missing') {
      throw new ServiceError('PRODUCTION_DRAFT_D1_RESERVATION_FAILED');
    }
    authoritative = recovery.draft;
  }
  if (!isPlainObject(authoritative)) {
    throw new ServiceError('PRODUCTION_DRAFT_D1_RESERVATION_INVALID');
  }
  if (authoritative.designId !== draft.designId
    && !matchesReusableProductionDraft(authoritative, manifest, currentTime)) {
    throw new HttpError(409, CONFLICT_MESSAGE);
  }
  return authoritative;
}

function matchesOwnedPendingDraft(value, draft, currentTime) {
  return matchesPendingPayload(value, draft, currentTime)
    && value.status === 'upload_pending'
    && value.uploadToken === draft.uploadToken
    && value.uploadStartedAt === draft.uploadStartedAt;
}

function matchesStrictPendingDraft(value, draft, currentTime) {
  return matchesPendingPayload(value, draft, currentTime)
    && value.status === 'upload_pending'
    && matches(value.uploadToken, UPLOAD_TOKEN_PATTERN)
    && Number.isSafeInteger(value.uploadStartedAt)
    && value.uploadStartedAt <= currentTime - UPLOAD_LEASE_MS;
}

function matchesPendingPayload(value, draft, currentTime) {
  return isPlainObject(value)
    && value.designId === draft.designId
    && value.shop === draft.shop
    && value.uploadId === draft.uploadId
    && value.productId === draft.productId
    && value.variantId === draft.variantId
    && value.size === draft.size
    && value.modelId === draft.modelId
    && value.modelVersion === draft.modelVersion
    && value.uvExportVersion === draft.uvExportVersion
    && value.designFingerprint === draft.designFingerprint
    && value.manifestSha256 === draft.manifestSha256
    && value.manifestKey === draft.manifestKey
    && value.bundleKey === draft.bundleKey
    && value.bundleFilename === draft.bundleFilename
    && value.expiresAt === draft.expiresAt
    && value.expiresAt > currentTime;
}

async function storePackage(
  assets,
  keys,
  packageResult,
  manifest,
  manifestSha256,
  bundleSha256,
) {
  const common = {
    designFingerprint: packageResult.validated.designFingerprint,
    productId: packageResult.validated.productId,
    variantId: packageResult.validated.variantId,
    size: packageResult.validated.size,
  };
  for (let index = 0; index < packageResult.validated.files.length; index += 1) {
    const file = packageResult.validated.files[index];
    const hash = index === 6 ? manifestSha256 : manifest.hashes[file.filename];
    await checkedPut(assets, keys[index], file.blob, {
      httpMetadata: { contentType: PRODUCTION_PACKAGE_FILE_CONTRACT[index].mediaType },
      customMetadata: { ...common, sha256: hash },
    });
  }
  let bundleStream;
  try {
    bundleStream = packageResult.bundle.createStream();
  } catch {
    throw new Error('Production ZIP stream creation failed.');
  }
  if (!(bundleStream instanceof ReadableStream)) {
    throw new Error('Production ZIP stream is invalid.');
  }
  await checkedPut(assets, keys[7], bundleStream, {
    httpMetadata: { contentType: 'application/zip' },
    sha256: bundleSha256,
    customMetadata: {
      ...common,
      contentLength: String(packageResult.bundle.contentLength),
      sha256: bundleSha256,
    },
  });
}

async function checkedPut(assets, key, value, options) {
  const result = await assets.put(key, value, options);
  if (!result || typeof result !== 'object' || result.key !== key) {
    throw new Error('R2 put result is invalid.');
  }
}

async function recoverDraft(repository, shop, uploadId) {
  try {
    const draft = await repository.getCartDraftByUpload(shop, uploadId);
    return draft === null
      ? Object.freeze({ kind: 'missing' })
      : Object.freeze({ kind: 'found', draft });
  } catch {
    return Object.freeze({ kind: 'read_failed' });
  }
}

async function cleanupOwnedUpload({
  assets,
  draft,
  keys,
  logger,
  now,
  randomUUID,
  repository,
}) {
  let cleanupToken;
  let claimed;
  try {
    cleanupToken = createLeaseToken(randomUUID, 'cln', CLEANUP_TOKEN_PATTERN);
    claimed = await repository.claimOwnedUploadCleanup({
      shop: draft.shop,
      designId: draft.designId,
      expiresAt: draft.expiresAt,
      uploadToken: draft.uploadToken,
      cleanupToken,
      claimedAt: now,
    });
  } catch {
    logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_CLAIM_FAILED');
    return false;
  }
  if (!matchesCleanupClaim(claimed, draft, cleanupToken, now)) {
    logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_CLAIM_INVALID');
    return false;
  }
  try {
    await assets.delete(keys);
  } catch {
    logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_FAILED');
    return false;
  }
  try {
    const deleted = await repository.deleteClaimedDraft({
      shop: draft.shop,
      designId: draft.designId,
      expiresAt: draft.expiresAt,
      claimToken: cleanupToken,
    });
    if (deleted !== true) throw new Error('Claimed draft was not deleted.');
    return true;
  } catch {
    logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_ROW_DELETE_FAILED');
    return false;
  }
}

function matchesCleanupClaim(value, draft, cleanupToken, claimedAt) {
  return isPlainObject(value)
    && value.status === 'cleanup_pending'
    && value.designId === draft.designId
    && value.shop === draft.shop
    && value.uploadId === draft.uploadId
    && value.expiresAt === draft.expiresAt
    && value.manifestKey === draft.manifestKey
    && value.bundleKey === draft.bundleKey
    && value.cleanupToken === cleanupToken
    && value.cleanupStartedAt === claimedAt
    && value.uploadToken === null
    && value.uploadStartedAt === null;
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

function matches(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}
