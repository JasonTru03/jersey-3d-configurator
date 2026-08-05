// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  CLEANUP_LEASE_MS,
  cleanExpiredProductionDrafts,
} from './cleanupDrafts.js';

const NOW = 1_700_000_000_000;
const SHOP = 'testcsj.myshopify.com';
const UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

describe('expired production draft cleanup', () => {
  it('claims one candidate before deleting its two known R2 keys and guarded row', async () => {
    const candidates = Array.from({ length: 101 }, (_, index) => candidate(index));
    const events = [];
    const runtime = createRuntime({
      candidates,
      randomUUID: vi.fn(() => UUIDS[0]),
      claimExpiredDraft: vi.fn(async (input) => {
        events.push(`claim:${input.designId}`);
        return claimed(candidates.find(({ designId }) => designId === input.designId), input);
      }),
      deleteR2: vi.fn(async (keys) => {
        events.push(`r2:${keys[0]}`);
      }),
      deleteClaimedDraft: vi.fn(async (input) => {
        events.push(`d1:${input.designId}`);
        return true;
      }),
    });

    await expect(cleanExpiredProductionDrafts(runtime.env, NOW, runtime.dependencies))
      .resolves.toEqual({ scanned: 1, claimed: 1, deleted: 1, failed: 0 });

    expect(runtime.repository.listExpiredDrafts).toHaveBeenCalledWith({
      before: NOW,
      staleBefore: NOW - CLEANUP_LEASE_MS,
      limit: 1,
    });
    expect(runtime.repository.claimExpiredDraft).toHaveBeenCalledOnce();
    expect(runtime.assets.delete).toHaveBeenCalledOnce();
    expect(runtime.repository.deleteClaimedDraft).toHaveBeenCalledOnce();
    expect(events.slice(0, 3)).toEqual([
      `claim:${candidates[0].designId}`,
      `r2:${candidates[0].manifestKey}`,
      `d1:${candidates[0].designId}`,
    ]);

    const claimInput = runtime.repository.claimExpiredDraft.mock.calls[0][0];
    expect(claimInput).toEqual({
      shop: SHOP,
      designId: candidates[0].designId,
      expiresAt: candidates[0].expiresAt,
      claimToken: `cln_${UUIDS[0]}`,
      claimedAt: NOW,
      staleBefore: NOW - CLEANUP_LEASE_MS,
    });
    expect(runtime.assets.delete.mock.calls[0][0]).toEqual([
      candidates[0].manifestKey,
      candidates[0].bundleKey,
    ]);
    expect(runtime.repository.deleteClaimedDraft.mock.calls[0][0]).toEqual({
      shop: SHOP,
      designId: candidates[0].designId,
      expiresAt: candidates[0].expiresAt,
      claimToken: `cln_${UUIDS[0]}`,
    });
  });

  it('leaves a claimed row for stale-lease retry after R2 fails, then reclaims it with a new token', async () => {
    const draft = candidate(0, {
      cleanupToken: 'cln_previous0000000000',
      cleanupStartedAt: NOW - CLEANUP_LEASE_MS,
    });
    const runtime = createRuntime({
      candidates: [draft],
      randomUUID: vi.fn()
        .mockReturnValueOnce(UUIDS[0])
        .mockReturnValueOnce(UUIDS[1]),
      deleteR2: vi.fn()
        .mockRejectedValueOnce(new Error('R2 unavailable'))
        .mockResolvedValueOnce(undefined),
    });

    await expect(cleanExpiredProductionDrafts(runtime.env, NOW, runtime.dependencies))
      .resolves.toEqual({ scanned: 1, claimed: 1, deleted: 0, failed: 1 });
    expect(runtime.repository.deleteClaimedDraft).not.toHaveBeenCalled();

    await expect(cleanExpiredProductionDrafts(
      runtime.env,
      NOW + CLEANUP_LEASE_MS + 1,
      runtime.dependencies,
    )).resolves.toEqual({ scanned: 1, claimed: 1, deleted: 1, failed: 0 });

    expect(runtime.repository.claimExpiredDraft.mock.calls[1][0].claimToken)
      .toBe(`cln_${UUIDS[1]}`);
    expect(runtime.repository.deleteClaimedDraft).toHaveBeenCalledWith({
      shop: SHOP,
      designId: draft.designId,
      expiresAt: draft.expiresAt,
      claimToken: `cln_${UUIDS[1]}`,
    });
    expect(runtime.logger.error).toHaveBeenCalledWith('PRODUCTION_DRAFT_CLEANUP_R2_DELETE_FAILED');
  });

  it('does not delete files when payment or another transition wins the atomic claim race', async () => {
    const runtime = createRuntime({
      candidates: [candidate(0)],
      claimExpiredDraft: vi.fn(async () => {
        const error = new Error('paid first');
        error.code = 'production-repository-conflict';
        throw error;
      }),
    });

    await expect(cleanExpiredProductionDrafts(runtime.env, NOW, runtime.dependencies))
      .resolves.toEqual({ scanned: 1, claimed: 0, deleted: 0, failed: 0 });
    expect(runtime.assets.delete).not.toHaveBeenCalled();
    expect(runtime.repository.deleteClaimedDraft).not.toHaveBeenCalled();
  });

  it('makes cleanup the sole winner when its atomic claim completes before payment', async () => {
    let status = 'cart_draft';
    const draft = candidate(0);
    const runtime = createRuntime({
      candidates: [draft],
      claimExpiredDraft: vi.fn(async (input) => {
        expect(status).toBe('cart_draft');
        status = 'cleanup_pending';
        return claimed(draft, input);
      }),
      deleteClaimedDraft: vi.fn(async () => {
        expect(status).toBe('cleanup_pending');
        status = 'deleted';
        return true;
      }),
    });
    const recordPayment = async () => {
      if (status !== 'cart_draft') {
        const error = new Error('cleanup first');
        error.code = 'production-repository-conflict';
        throw error;
      }
      status = 'paid_pending_production';
    };

    await expect(cleanExpiredProductionDrafts(runtime.env, NOW, runtime.dependencies))
      .resolves.toEqual({ scanned: 1, claimed: 1, deleted: 1, failed: 0 });
    await expect(recordPayment()).rejects.toMatchObject({ code: 'production-repository-conflict' });
    expect(status).toBe('deleted');
  });

  it('does not touch R2 when the claimed row or its object-key relationship is invalid', async () => {
    const draft = candidate(0);
    const invalidClaim = createRuntime({
      candidates: [draft],
      claimExpiredDraft: vi.fn(async (input) => ({
        ...claimed(draft, input),
        cleanupToken: `cln_${UUIDS[1]}`,
      })),
    });
    await expect(cleanExpiredProductionDrafts(invalidClaim.env, NOW, invalidClaim.dependencies))
      .resolves.toEqual({ scanned: 1, claimed: 0, deleted: 0, failed: 1 });
    expect(invalidClaim.assets.delete).not.toHaveBeenCalled();

    const malformedKeys = createRuntime({
      candidates: [candidate(0, { bundleKey: 'shops/another/design.zip' })],
    });
    await expect(cleanExpiredProductionDrafts(malformedKeys.env, NOW, malformedKeys.dependencies))
      .resolves.toEqual({ scanned: 1, claimed: 0, deleted: 0, failed: 1 });
    expect(malformedKeys.repository.claimExpiredDraft).not.toHaveBeenCalled();
    expect(malformedKeys.assets.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['returns false', vi.fn(async () => false)],
    ['throws', vi.fn(async () => { throw new Error('D1 unavailable'); })],
  ])('leaves cleanup_pending for retry when guarded D1 deletion %s', async (_case, deleteRow) => {
    const runtime = createRuntime({
      candidates: [candidate(0)],
      deleteClaimedDraft: deleteRow,
    });

    await expect(cleanExpiredProductionDrafts(runtime.env, NOW, runtime.dependencies))
      .resolves.toEqual({ scanned: 1, claimed: 1, deleted: 0, failed: 1 });
    expect(runtime.assets.delete).toHaveBeenCalledOnce();
    expect(runtime.logger.error)
      .toHaveBeenCalledWith('PRODUCTION_DRAFT_CLEANUP_ROW_DELETE_FAILED');
  });

  it('fails closed when bindings, scheduled time or cryptographic UUID generation are invalid', async () => {
    const runtime = createRuntime({ candidates: [candidate(0)] });
    await expect(cleanExpiredProductionDrafts(
      { ...runtime.env, PRODUCTION_ASSETS: undefined },
      NOW,
      runtime.dependencies,
    )).rejects.toMatchObject({ code: 'PRODUCTION_DRAFT_CLEANUP_BINDINGS_INVALID' });
    await expect(cleanExpiredProductionDrafts(runtime.env, Number.NaN, runtime.dependencies))
      .rejects.toMatchObject({ code: 'PRODUCTION_DRAFT_CLEANUP_TIME_INVALID' });

    runtime.dependencies.randomUUID = vi.fn(() => 'predictable');
    await expect(cleanExpiredProductionDrafts(runtime.env, NOW, runtime.dependencies))
      .resolves.toEqual({ scanned: 1, claimed: 0, deleted: 0, failed: 1 });
    expect(runtime.repository.claimExpiredDraft).not.toHaveBeenCalled();
    expect(runtime.assets.delete).not.toHaveBeenCalled();
    expect(runtime.logger.error).toHaveBeenCalledWith('PRODUCTION_DRAFT_CLEANUP_RANDOM_INVALID');
  });
});

function createRuntime(options = {}) {
  const candidates = options.candidates ?? [];
  const repository = {
    listExpiredDrafts: vi.fn(async () => candidates),
    claimExpiredDraft: options.claimExpiredDraft ?? vi.fn(async (input) => {
      const draft = candidates.find(({ designId }) => designId === input.designId);
      return claimed(draft, input);
    }),
    deleteClaimedDraft: options.deleteClaimedDraft ?? vi.fn(async () => true),
  };
  const assets = { delete: options.deleteR2 ?? vi.fn(async () => undefined) };
  const logger = { error: vi.fn() };
  return {
    assets,
    env: {
      PRODUCTION_ASSETS: assets,
      PRODUCTION_DB: { prepare: vi.fn(), batch: vi.fn() },
    },
    logger,
    repository,
    dependencies: {
      createRepository: vi.fn(() => repository),
      logger,
      randomUUID: options.randomUUID ?? vi.fn(() => UUIDS[0]),
    },
  };
}

function candidate(index, overrides = {}) {
  const suffix = String(index).padStart(16, '0');
  const designId = `dsg_${suffix}`;
  const shopFingerprint = 'shop_abcdefghijkl';
  const objectPrefix = `shops/${shopFingerprint}/designs/${designId}/`;
  return {
    shop: SHOP,
    designId,
    manifestKey: `${objectPrefix}manifest.json`,
    bundleKey: `${objectPrefix}fn8788-jersey-design-12345678.zip`,
    expiresAt: NOW - 1,
    cleanupToken: null,
    cleanupStartedAt: null,
    ...overrides,
  };
}

function claimed(draft, input) {
  return {
    ...draft,
    status: 'cleanup_pending',
    cleanupToken: input.claimToken,
    cleanupStartedAt: input.claimedAt,
    uploadToken: null,
  };
}

function prefix(draft) {
  return draft.manifestKey.slice(0, -'manifest.json'.length);
}
