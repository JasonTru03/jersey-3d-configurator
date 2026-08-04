import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDesignUploadTurnstileToken } from './turnstile.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.querySelectorAll('[data-turnstile-production-draft]').forEach((element) => element.remove());
});

describe('getDesignUploadTurnstileToken', () => {
  it('renders an explicit execute-mode widget and resolves only the callback token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    let options;
    let renderedWhileConnected = false;
    const turnstile = {
      ready: vi.fn((callback) => callback()),
      render: vi.fn((container, nextOptions) => {
        renderedWhileConnected = container.isConnected;
        options = nextOptions;
        return 'widget-1';
      }),
      execute: vi.fn(() => {
        options.callback('captcha-token');
        return 'not-a-token';
      }),
      remove: vi.fn(),
    };

    const token = await getDesignUploadTurnstileToken({ turnstile });

    expect(token).toBe('captcha-token');
    expect(fetch).toHaveBeenCalledWith('/api/production-drafts/config', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(renderedWhileConnected).toBe(true);
    const container = turnstile.render.mock.calls[0][0];
    expect(container).toHaveAttribute('role', 'group');
    expect(container).toHaveAttribute('aria-label', 'Security verification');
    expect(container.style.position).toBe('fixed');
    expect(Number(container.style.zIndex)).toBeGreaterThan(1000);
    expect(turnstile.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      sitekey: 'public-site-key',
      action: 'production_draft',
      execution: 'execute',
      appearance: 'interaction-only',
      callback: expect.any(Function),
      'error-callback': expect.any(Function),
      'expired-callback': expect.any(Function),
      'timeout-callback': expect.any(Function),
    }));
    expect(turnstile.execute).toHaveBeenCalledWith('widget-1');
    expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
    expect(document.querySelector('[data-turnstile-production-draft]')).toBeNull();
  });

  it('keeps endpoint and action dependency injection available to callers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    let options;
    const turnstile = {
      ready: (callback) => callback(),
      render: (_container, nextOptions) => {
        options = nextOptions;
        return 'widget-custom';
      },
      execute: () => options.callback('captcha-token'),
      remove: vi.fn(),
    };

    await getDesignUploadTurnstileToken({
      action: 'test_action',
      endpoint: '/api/test-turnstile-config',
      turnstile,
    });

    expect(fetch).toHaveBeenCalledWith('/api/test-turnstile-config', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(options.action).toBe('test_action');
  });

  it('creates and removes a fresh widget for every token request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const containers = [];
    const optionsById = new Map();
    let widgetNumber = 0;
    const turnstile = {
      ready: (callback) => callback(),
      render: (container, options) => {
        const id = `widget-${widgetNumber += 1}`;
        containers.push(container);
        optionsById.set(id, options);
        return id;
      },
      execute: (id) => optionsById.get(id).callback(`token-${id}`),
      remove: vi.fn(),
    };

    await expect(getDesignUploadTurnstileToken({ turnstile })).resolves.toBe('token-widget-1');
    await expect(getDesignUploadTurnstileToken({ turnstile })).resolves.toBe('token-widget-2');

    expect(containers[0]).not.toBe(containers[1]);
    expect(turnstile.remove.mock.calls).toEqual([['widget-1'], ['widget-2']]);
    expect(containers.every((container) => !container.isConnected)).toBe(true);
  });

  it('handles a callback fired synchronously during render without executing or leaking the widget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const execute = vi.fn();
    const remove = vi.fn();
    const turnstile = {
      ready: (callback) => callback(),
      render: (_container, options) => {
        options.callback('synchronous-token');
        return 'widget-synchronous';
      },
      execute,
      remove,
    };

    await expect(getDesignUploadTurnstileToken({ turnstile })).resolves.toBe('synchronous-token');
    expect(execute).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('widget-synchronous');
    expect(document.querySelector('[data-turnstile-production-draft]')).toBeNull();
  });

  it.each([
    ['error-callback', 'private-error-code'],
    ['expired-callback'],
    ['timeout-callback'],
  ])('rejects a %s with one stable error and cleans up', async (callbackName, callbackValue) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    let options;
    const remove = vi.fn();
    const turnstile = {
      ready: (callback) => callback(),
      render: (_container, nextOptions) => {
        options = nextOptions;
        return 'widget-failure';
      },
      execute: () => options[callbackName](callbackValue),
      remove,
    };

    await expect(getDesignUploadTurnstileToken({ turnstile }))
      .rejects.toThrow('Design upload verification failed.');
    expect(remove).toHaveBeenCalledWith('widget-failure');
    expect(document.querySelector('[data-turnstile-production-draft]')).toBeNull();
  });

  it('aborts a pending widget, removes it once, and ignores a late callback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const controller = new AbortController();
    let options;
    const remove = vi.fn();
    const turnstile = {
      ready: (callback) => callback(),
      render: (_container, nextOptions) => {
        options = nextOptions;
        return 'widget-abort';
      },
      execute: vi.fn(),
      remove,
    };

    const request = getDesignUploadTurnstileToken({ signal: controller.signal, turnstile });
    await vi.waitFor(() => expect(turnstile.execute).toHaveBeenCalledWith('widget-abort'));
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    options.callback('late-token');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-turnstile-production-draft]')).toBeNull();
  });

  it('times out a pending widget and cleans it up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const remove = vi.fn();
    const turnstile = {
      ready: (callback) => callback(),
      render: () => 'widget-timeout',
      execute: vi.fn(),
      remove,
    };
    vi.useFakeTimers();

    const request = getDesignUploadTurnstileToken({ timeoutMs: 25, turnstile });
    const rejection = expect(request).rejects.toThrow('Design upload verification timed out.');
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(remove).toHaveBeenCalledWith('widget-timeout');
    expect(document.querySelector('[data-turnstile-production-draft]')).toBeNull();
  });

  it.each(['ready', 'render', 'execute'])('contains synchronous %s failures and removes any created widget', async (failurePoint) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const remove = vi.fn();
    const turnstile = {
      ready: (callback) => {
        if (failurePoint === 'ready') throw new Error('private ready failure');
        callback();
      },
      render: () => {
        if (failurePoint === 'render') throw new Error('private render failure');
        return 'widget-sync-failure';
      },
      execute: () => {
        if (failurePoint === 'execute') throw new Error('private execute failure');
      },
      remove,
    };

    await expect(getDesignUploadTurnstileToken({ turnstile }))
      .rejects.toThrow('Design upload verification failed.');
    expect(remove).toHaveBeenCalledTimes(failurePoint === 'execute' ? 1 : 0);
    expect(document.querySelector('[data-turnstile-production-draft]')).toBeNull();
  });
});
