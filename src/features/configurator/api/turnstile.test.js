import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDesignUploadTurnstileToken } from './turnstile.js';

afterEach(() => vi.unstubAllGlobals());

describe('getDesignUploadTurnstileToken', () => {
  it('loads the public site key from the production-draft worker route and executes fresh Turnstile', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const execute = vi.fn(async () => 'captcha-token');
    const token = await getDesignUploadTurnstileToken({ turnstile: { ready: (callback) => callback(), execute } });
    expect(token).toBe('captcha-token');
    expect(fetch).toHaveBeenCalledWith('/api/production-drafts/config', { cache: 'no-store' });
    expect(execute).toHaveBeenCalledWith('public-site-key', { action: 'production_draft' });
  });

  it('keeps endpoint and action dependency injection available to callers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const execute = vi.fn(async () => 'captcha-token');

    await getDesignUploadTurnstileToken({
      action: 'test_action',
      endpoint: '/api/test-turnstile-config',
      turnstile: { ready: (callback) => callback(), execute },
    });

    expect(fetch).toHaveBeenCalledWith('/api/test-turnstile-config', { cache: 'no-store' });
    expect(execute).toHaveBeenCalledWith('public-site-key', { action: 'test_action' });
  });
});
