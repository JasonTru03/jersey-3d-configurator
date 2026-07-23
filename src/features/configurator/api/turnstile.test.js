import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDesignUploadTurnstileToken } from './turnstile.js';

afterEach(() => vi.unstubAllGlobals());

describe('getDesignUploadTurnstileToken', () => {
  it('loads the public site key from the worker and executes Turnstile for each upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const execute = vi.fn(async () => 'captcha-token');
    const token = await getDesignUploadTurnstileToken({ turnstile: { ready: (callback) => callback(), execute } });
    expect(token).toBe('captcha-token');
    expect(fetch).toHaveBeenCalledWith('/api/design-assets/config', { cache: 'no-store' });
    expect(execute).toHaveBeenCalledWith('public-site-key', { action: 'design_upload' });
  });
});
