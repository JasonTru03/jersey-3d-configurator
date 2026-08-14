import { loadTurnstileApi } from './turnstileLoader.js';

const VERIFICATION_FAILED = 'Design upload verification failed.';
const VERIFICATION_TIMEOUT = 'Design upload verification timed out.';
const DEFAULT_TIMEOUT_MS = 120_000;
const TURNSTILE_ALWAYS_PASS_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

export async function getDesignUploadTurnstileToken({
  action = 'production_draft',
  container,
  endpoint = '/api/production-drafts/config',
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  turnstile,
} = {}) {
  if (
    !(container instanceof HTMLElement)
    || !container.isConnected
    || !container.hasAttribute('data-turnstile-production-draft')
    || !container.closest('[role="dialog"][aria-modal="true"]')
  ) {
    throw new Error('Design upload verification is unavailable.');
  }
  container.replaceChildren();
  const requestController = new AbortController();
  let timedOut = false;
  const handleExternalAbort = () => requestController.abort(toAbortError(signal?.reason));
  signal?.addEventListener('abort', handleExternalAbort, { once: true });
  if (signal?.aborted) handleExternalAbort();
  const timeout = setTimeout(() => {
    timedOut = true;
    requestController.abort(new DOMException(VERIFICATION_TIMEOUT, 'AbortError'));
  }, normalizeTimeout(timeoutMs));

  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      signal: requestController.signal,
    });
    const config = await response.json().catch(() => ({}));
    if (
      !response.ok
      || typeof config.turnstileSiteKey !== 'string'
      || config.turnstileSiteKey.trim().length === 0
    ) {
      throw new StableTurnstileError('Design upload verification is not configured.');
    }
    if (config.turnstileSiteKey.trim() === TURNSTILE_ALWAYS_PASS_SITE_KEY) {
      return TURNSTILE_DUMMY_TOKEN;
    }
    const turnstileApi = turnstile ?? await loadTurnstileApi({
      signal: requestController.signal,
    });
    if (
      typeof turnstileApi?.ready !== 'function'
      || typeof turnstileApi?.render !== 'function'
      || typeof turnstileApi?.execute !== 'function'
      || typeof turnstileApi?.remove !== 'function'
    ) {
      throw new StableTurnstileError('Design upload verification is unavailable.');
    }

    await waitUntilReady(turnstileApi, requestController.signal);
    return await executeWidget({
      action,
      container,
      signal: requestController.signal,
      siteKey: config.turnstileSiteKey.trim(),
      turnstile: turnstileApi,
    });
  } catch (error) {
    if (signal?.aborted) throw toAbortError(signal.reason);
    if (timedOut) throw new Error(VERIFICATION_TIMEOUT);
    if (error instanceof StableTurnstileError) throw new Error(error.message);
    throw new Error(VERIFICATION_FAILED);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', handleExternalAbort);
  }
}

function executeWidget({ action, container, signal, siteKey, turnstile }) {
  return new Promise((resolve, reject) => {
    let widgetId = null;
    let renderComplete = false;
    let settled = false;
    const hasWidgetId = () => typeof widgetId === 'string' && widgetId.length > 0;

    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
      if (hasWidgetId()) {
        try {
          turnstile.remove(widgetId);
        } catch {
          // Cleanup must not replace the stable verification result.
        }
      }
      container.replaceChildren();
    };
    const settle = (handler, value) => {
      if (settled) return;
      settled = true;
      const complete = () => {
        cleanup();
        handler(value);
      };
      if (renderComplete && hasWidgetId()) {
        complete();
      } else {
        queueMicrotask(complete);
      }
    };
    const fail = () => settle(reject, new StableTurnstileError(VERIFICATION_FAILED));
    const handleAbort = () => settle(reject, signal.reason ?? toAbortError());

    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) {
      handleAbort();
      return;
    }

    try {
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        action,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (token) => {
          if (typeof token !== 'string' || token.trim().length === 0) {
            fail();
            return;
          }
          settle(resolve, token);
        },
        'error-callback': fail,
        'expired-callback': fail,
        'timeout-callback': fail,
      });
      renderComplete = true;
      if (typeof widgetId !== 'string' || widgetId.length === 0) {
        fail();
        return;
      }
      if (settled) return;
      turnstile.execute(widgetId);
    } catch {
      fail();
    }
  });
}

function waitUntilReady(turnstile, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      handler(value);
    };
    const handleAbort = () => finish(reject, signal.reason ?? toAbortError());
    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) {
      handleAbort();
      return;
    }
    try {
      turnstile.ready(() => finish(resolve));
    } catch {
      finish(reject, new StableTurnstileError(VERIFICATION_FAILED));
    }
  });
}

function normalizeTimeout(timeoutMs) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
}

function toAbortError(reason) {
  if (reason instanceof DOMException && reason.name === 'AbortError') return reason;
  return new DOMException('Design upload verification was cancelled.', 'AbortError');
}

class StableTurnstileError extends Error {}
