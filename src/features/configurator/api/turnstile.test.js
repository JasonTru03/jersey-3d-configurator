import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDesignUploadTurnstileToken } from './turnstile.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.querySelectorAll('[data-turnstile-test-dialog]').forEach((element) => element.remove());
});

describe('getDesignUploadTurnstileToken', () => {
  it('uses Cloudflare official dummy credentials without loading a browser widget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      turnstileSiteKey: '1x00000000000000000000AA',
    })));

    await expect(getDesignUploadTurnstileToken({ container: createTurnstileContainer() }))
      .resolves.toBe('XXXX.DUMMY.TOKEN.XXXX');
  });

  it('renders an explicit execute-mode widget and resolves only the callback token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const container = createTurnstileContainer();
    let options;
    let renderedWhileConnected = false;
    const turnstile = {
      ready: vi.fn((callback) => callback()),
      render: vi.fn((container, nextOptions) => {
        renderedWhileConnected = container.isConnected;
        const iframe = document.createElement('iframe');
        iframe.title = 'Cloudflare security verification';
        container.append(iframe);
        options = nextOptions;
        return 'widget-1';
      }),
      execute: vi.fn(() => {
        options.callback('captcha-token');
        return 'not-a-token';
      }),
      remove: vi.fn(),
    };

    const token = await getDesignUploadTurnstileToken({ container, turnstile });

    expect(token).toBe('captcha-token');
    expect(fetch).toHaveBeenCalledWith('/api/production-drafts/config', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(renderedWhileConnected).toBe(true);
    expect(container).toHaveAttribute('role', 'group');
    expect(container).toHaveAttribute('aria-label', 'Security verification');
    expect(turnstile.render).toHaveBeenCalledWith(container, expect.objectContaining({
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
    expect(container.isConnected).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps endpoint and action dependency injection available to callers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const container = createTurnstileContainer();
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
      container,
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
    const container = createTurnstileContainer();
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

    await expect(getDesignUploadTurnstileToken({ container, turnstile })).resolves.toBe('token-widget-1');
    await expect(getDesignUploadTurnstileToken({ container, turnstile })).resolves.toBe('token-widget-2');

    expect(containers).toEqual([container, container]);
    expect(turnstile.remove.mock.calls).toEqual([['widget-1'], ['widget-2']]);
    expect(container.isConnected).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it('handles a callback fired synchronously during render without executing or leaking the widget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const container = createTurnstileContainer();
    const execute = vi.fn();
    const remove = vi.fn();
    let removedBeforeRenderReturned = false;
    const turnstile = {
      ready: (callback) => callback(),
      render: (_container, options) => {
        options.callback('synchronous-token');
        removedBeforeRenderReturned = remove.mock.calls.length > 0;
        return 'widget-synchronous';
      },
      execute,
      remove,
    };

    await expect(getDesignUploadTurnstileToken({ container, turnstile })).resolves.toBe('synchronous-token');
    expect(removedBeforeRenderReturned).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('widget-synchronous');
    expect(container.isConnected).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it('removes and clears synchronously when an asynchronous callback settles a rendered widget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const container = createTurnstileContainer();
    let options;
    const remove = vi.fn();
    const turnstile = {
      ready: (callback) => callback(),
      render: (_container, nextOptions) => {
        options = nextOptions;
        container.append(document.createElement('iframe'));
        return 'widget-async-callback';
      },
      execute: vi.fn(),
      remove,
    };

    const request = getDesignUploadTurnstileToken({ container, turnstile });
    await vi.waitFor(() => expect(turnstile.execute).toHaveBeenCalledWith('widget-async-callback'));
    options.callback('async-token');

    expect(remove).toHaveBeenCalledWith('widget-async-callback');
    expect(container).toBeEmptyDOMElement();
    await expect(request).resolves.toBe('async-token');
  });

  it.each([
    ['error-callback', 'private-error-code'],
    ['expired-callback'],
    ['timeout-callback'],
  ])('rejects a %s with one stable error and cleans up', async (callbackName, callbackValue) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const container = createTurnstileContainer();
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

    await expect(getDesignUploadTurnstileToken({ container, turnstile }))
      .rejects.toThrow('Design upload verification failed.');
    expect(remove).toHaveBeenCalledWith('widget-failure');
    expect(container.isConnected).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it('aborts a pending widget, removes it once, and ignores a late callback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const container = createTurnstileContainer();
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

    const request = getDesignUploadTurnstileToken({ container, signal: controller.signal, turnstile });
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(turnstile.execute).toHaveBeenCalledWith('widget-abort'));
    controller.abort();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(container.isConnected).toBe(true);
    expect(container).toBeEmptyDOMElement();
    await rejection;
    options.callback('late-token');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('times out a pending widget and cleans it up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const container = createTurnstileContainer();
    const remove = vi.fn();
    const turnstile = {
      ready: (callback) => callback(),
      render: () => 'widget-timeout',
      execute: vi.fn(),
      remove,
    };
    vi.useFakeTimers();

    const request = getDesignUploadTurnstileToken({ container, timeoutMs: 25, turnstile });
    const rejection = expect(request).rejects.toThrow('Design upload verification timed out.');
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(remove).toHaveBeenCalledWith('widget-timeout');
    expect(container.isConnected).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['ready', 'render', 'execute'])('contains synchronous %s failures and removes any created widget', async (failurePoint) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ turnstileSiteKey: 'public-site-key' })));
    const container = createTurnstileContainer();
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

    await expect(getDesignUploadTurnstileToken({ container, turnstile }))
      .rejects.toThrow('Design upload verification failed.');
    expect(remove).toHaveBeenCalledTimes(failurePoint === 'execute' ? 1 : 0);
    expect(container.isConnected).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([null, document.createElement('div'), document.body])('fails closed before fetch when the container is not a valid dialog placeholder', async (container) => {
    vi.stubGlobal('fetch', vi.fn());

    await expect(getDesignUploadTurnstileToken({ container, turnstile: {} }))
      .rejects.toThrow('Design upload verification is unavailable.');
    expect(fetch).not.toHaveBeenCalled();
  });
});

function createTurnstileContainer() {
  const dialog = document.createElement('section');
  dialog.dataset.turnstileTestDialog = '';
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('role', 'dialog');
  const container = document.createElement('div');
  container.dataset.turnstileProductionDraft = '';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Security verification');
  dialog.append(container);
  document.body.append(dialog);
  return container;
}
