import { createProductionRepository } from './productionRepository.js';

// Workers Free has a 10 ms CPU budget. One claimed draft per invocation keeps
// cleanup bounded; the hourly schedule provides retry capacity without a long loop.
const CLEANUP_BATCH_LIMIT = 1;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const SHOP_FINGERPRINT_SOURCE = 'shop_[A-Za-z0-9_-]{12}';
const BUNDLE_FILENAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}-design-[a-f0-9]{8}\.zip$/u;

export const CLEANUP_LEASE_MS = 15 * 60 * 1000;

export class ProductionDraftCleanupError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProductionDraftCleanupError';
    this.code = code;
  }
}

export async function cleanExpiredProductionDrafts(env, scheduledTime, dependencies = {}) {
  const { assets, repository } = readBindings(env, dependencies.createRepository);
  const logger = dependencies.logger ?? console;
  const randomUUID = dependencies.randomUUID ?? (() => crypto.randomUUID());
  const staleBefore = readStaleBefore(scheduledTime);
  let candidates;
  try {
    candidates = await repository.listExpiredDrafts({
      before: scheduledTime,
      staleBefore,
      limit: CLEANUP_BATCH_LIMIT,
    });
  } catch {
    logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_LIST_FAILED');
    throw new ProductionDraftCleanupError('PRODUCTION_DRAFT_CLEANUP_LIST_FAILED');
  }
  if (!Array.isArray(candidates)) {
    logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_LIST_INVALID');
    throw new ProductionDraftCleanupError('PRODUCTION_DRAFT_CLEANUP_LIST_INVALID');
  }

  const summary = { scanned: 0, claimed: 0, deleted: 0, failed: 0 };
  for (const candidate of candidates.slice(0, CLEANUP_BATCH_LIMIT)) {
    summary.scanned += 1;
    const keys = createKnownObjectKeys(candidate);
    if (!keys) {
      summary.failed += 1;
      logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_KEYS_INVALID');
      continue;
    }
    const cleanupToken = createCleanupToken(randomUUID, logger);
    if (!cleanupToken) {
      summary.failed += 1;
      continue;
    }

    let claimed;
    try {
      claimed = await repository.claimExpiredDraft({
        shop: candidate.shop,
        designId: candidate.designId,
        expiresAt: candidate.expiresAt,
        claimToken: cleanupToken,
        claimedAt: scheduledTime,
        staleBefore,
      });
    } catch (error) {
      if (error?.code === 'production-repository-conflict') continue;
      summary.failed += 1;
      logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_CLAIM_FAILED');
      continue;
    }
    if (claimed === null) continue;
    if (!matchesClaim(claimed, candidate, cleanupToken, scheduledTime)) {
      summary.failed += 1;
      logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_CLAIM_INVALID');
      continue;
    }
    summary.claimed += 1;

    try {
      await assets.delete(keys);
    } catch {
      summary.failed += 1;
      logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_R2_DELETE_FAILED');
      continue;
    }

    try {
      const deleted = await repository.deleteClaimedDraft({
        shop: candidate.shop,
        designId: candidate.designId,
        expiresAt: candidate.expiresAt,
        claimToken: cleanupToken,
      });
      if (deleted !== true) throw new Error('Claimed draft was not deleted.');
      summary.deleted += 1;
    } catch {
      summary.failed += 1;
      logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_ROW_DELETE_FAILED');
    }
  }
  return summary;
}

function readBindings(env, createRepository = createProductionRepository) {
  if (
    !isPlainObject(env)
    || typeof env.PRODUCTION_ASSETS?.delete !== 'function'
    || typeof env.PRODUCTION_DB?.prepare !== 'function'
    || typeof env.PRODUCTION_DB?.batch !== 'function'
    || typeof createRepository !== 'function'
  ) throw new ProductionDraftCleanupError('PRODUCTION_DRAFT_CLEANUP_BINDINGS_INVALID');
  let repository;
  try {
    repository = createRepository(env.PRODUCTION_DB);
  } catch {
    throw new ProductionDraftCleanupError('PRODUCTION_DRAFT_CLEANUP_BINDINGS_INVALID');
  }
  if (
    !repository
    || typeof repository.listExpiredDrafts !== 'function'
    || typeof repository.claimExpiredDraft !== 'function'
    || typeof repository.deleteClaimedDraft !== 'function'
  ) throw new ProductionDraftCleanupError('PRODUCTION_DRAFT_CLEANUP_BINDINGS_INVALID');
  return { assets: env.PRODUCTION_ASSETS, repository };
}

function readStaleBefore(scheduledTime) {
  if (!Number.isSafeInteger(scheduledTime) || scheduledTime < CLEANUP_LEASE_MS) {
    throw new ProductionDraftCleanupError('PRODUCTION_DRAFT_CLEANUP_TIME_INVALID');
  }
  return scheduledTime - CLEANUP_LEASE_MS;
}

function createCleanupToken(randomUUID, logger) {
  let uuid;
  try {
    uuid = randomUUID();
  } catch {
    logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_RANDOM_FAILED');
    return null;
  }
  if (typeof uuid !== 'string' || !UUID_V4_PATTERN.test(uuid)) {
    logCode(logger, 'PRODUCTION_DRAFT_CLEANUP_RANDOM_INVALID');
    return null;
  }
  return `cln_${uuid}`;
}

function createKnownObjectKeys(candidate) {
  if (
    !isPlainObject(candidate)
    || !SHOP_PATTERN.test(candidate.shop)
    || !DESIGN_ID_PATTERN.test(candidate.designId)
    || !Number.isSafeInteger(candidate.expiresAt)
    || typeof candidate.manifestKey !== 'string'
    || typeof candidate.bundleKey !== 'string'
    || !candidate.manifestKey.endsWith('/manifest.json')
  ) return null;
  const prefix = candidate.manifestKey.slice(0, -'manifest.json'.length);
  const expectedPrefix = new RegExp(
    `^shops/${SHOP_FINGERPRINT_SOURCE}/designs/${escapeRegExp(candidate.designId)}/$`,
    'u',
  );
  if (!expectedPrefix.test(prefix) || !candidate.bundleKey.startsWith(prefix)) return null;
  const bundleFilename = candidate.bundleKey.slice(prefix.length);
  if (!BUNDLE_FILENAME_PATTERN.test(bundleFilename)) return null;
  const keys = [candidate.manifestKey, candidate.bundleKey];
  return new Set(keys).size === 2 ? keys : null;
}

function matchesClaim(value, candidate, cleanupToken, claimedAt) {
  return isPlainObject(value)
    && value.status === 'cleanup_pending'
    && value.shop === candidate.shop
    && value.designId === candidate.designId
    && value.expiresAt === candidate.expiresAt
    && value.manifestKey === candidate.manifestKey
    && value.bundleKey === candidate.bundleKey
    && value.cleanupToken === cleanupToken
    && value.cleanupStartedAt === claimedAt
    && value.uploadToken === null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function logCode(logger, code) {
  try {
    logger?.error?.(code);
  } catch {
    // Cleanup safety must not depend on logging availability.
  }
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
