import { describe, expect, it, vi } from 'vitest';
import { verifyProductionTurnstile } from './productionDraftRequest.js';

const OFFICIAL_ALWAYS_PASS_SECRET = '1x0000000000000000000000000000000AA';

describe('verifyProductionTurnstile test credentials', () => {
  it('accepts Cloudflare official always-pass results that omit action', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true }));

    await expect(verifyProductionTurnstile({
      fetchImpl,
      ip: '203.0.113.10',
      secret: OFFICIAL_ALWAYS_PASS_SECRET,
      timeoutMs: 1_000,
      token: 'XXXX.DUMMY.TOKEN.XXXX',
    })).resolves.toBeUndefined();
  });

  it('keeps action mandatory for every non-test secret', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: true }));

    await expect(verifyProductionTurnstile({
      fetchImpl,
      ip: '203.0.113.10',
      secret: 'production-secret',
      timeoutMs: 1_000,
      token: 'production-token',
    })).rejects.toMatchObject({
      code: 'PRODUCTION_DRAFT_TURNSTILE_RESULT_INVALID',
    });
  });

  it('still rejects a failed result in official test mode', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: false }));

    await expect(verifyProductionTurnstile({
      fetchImpl,
      ip: '',
      secret: OFFICIAL_ALWAYS_PASS_SECRET,
      timeoutMs: 1_000,
      token: 'XXXX.DUMMY.TOKEN.XXXX',
    })).rejects.toMatchObject({ status: 403 });
  });
});
