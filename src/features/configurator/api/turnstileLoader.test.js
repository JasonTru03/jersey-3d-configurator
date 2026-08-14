import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTurnstileApi } from './turnstileLoader.js';

afterEach(() => {
  document.querySelectorAll('script[data-turnstile-api]').forEach((element) => element.remove());
});

describe('loadTurnstileApi', () => {
  it('waits for the API script load event before exposing Turnstile', async () => {
    const windowRef = {};
    const turnstile = createTurnstileApi();
    const request = loadTurnstileApi({ documentRef: document, windowRef });
    const script = document.querySelector('script[data-turnstile-api]');

    expect(script).not.toBeNull();
    expect(script.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    windowRef.turnstile = turnstile;
    script.dispatchEvent(new Event('load'));

    await expect(request).resolves.toBe(turnstile);
  });

  it('reuses an API that has already loaded without adding another script', async () => {
    const turnstile = createTurnstileApi();

    await expect(loadTurnstileApi({ documentRef: document, windowRef: { turnstile } }))
      .resolves.toBe(turnstile);
    expect(document.querySelector('script[data-turnstile-api]')).toBeNull();
  });

  it('rejects an aborted load and ignores a later script event', async () => {
    const controller = new AbortController();
    const request = loadTurnstileApi({
      documentRef: document,
      signal: controller.signal,
      windowRef: {},
    });
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    document.querySelector('script[data-turnstile-api]').dispatchEvent(new Event('load'));

    await rejection;
  });
});

function createTurnstileApi() {
  return {
    execute: vi.fn(),
    ready: vi.fn(),
    remove: vi.fn(),
    render: vi.fn(),
  };
}
