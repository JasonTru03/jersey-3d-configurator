const TURNSTILE_API_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_SELECTOR = 'script[data-turnstile-api]';

export function loadTurnstileApi({
  documentRef = document,
  signal,
  windowRef = window,
} = {}) {
  if (isTurnstileApi(windowRef.turnstile)) return Promise.resolve(windowRef.turnstile);
  if (signal?.aborted) return Promise.reject(toAbortError(signal.reason));

  let script = documentRef.querySelector(SCRIPT_SELECTOR);
  const created = !script;
  if (!script) {
    script = documentRef.createElement('script');
    script.async = true;
    script.dataset.turnstileApi = '';
    script.src = TURNSTILE_API_URL;
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort);
      script.removeEventListener('error', handleError);
      script.removeEventListener('load', handleLoad);
    };
    const settle = (handler, value) => {
      cleanup();
      handler(value);
    };
    const handleAbort = () => settle(reject, toAbortError(signal?.reason));
    const handleError = () => settle(reject, new Error('Turnstile API failed to load.'));
    const handleLoad = () => {
      if (!isTurnstileApi(windowRef.turnstile)) {
        handleError();
        return;
      }
      settle(resolve, windowRef.turnstile);
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    script.addEventListener('error', handleError, { once: true });
    script.addEventListener('load', handleLoad, { once: true });
    if (created) documentRef.head.append(script);
  });
}

function isTurnstileApi(turnstile) {
  return typeof turnstile?.ready === 'function'
    && typeof turnstile?.render === 'function'
    && typeof turnstile?.execute === 'function'
    && typeof turnstile?.remove === 'function';
}

function toAbortError(reason) {
  if (reason instanceof DOMException && reason.name === 'AbortError') return reason;
  return new DOMException('Design upload verification was cancelled.', 'AbortError');
}
