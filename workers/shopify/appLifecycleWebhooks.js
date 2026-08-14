import { createOAuthRepository } from './oauthRepository.js';
import { REQUIRED_SHOPIFY_SCOPES } from './oauth.js';
import {
  readVerifiedShopifyWebhook,
  ShopifyWebhookRequestError,
} from './webhookSecurity.js';

const TOPICS = new Set(['app/uninstalled', 'app/scopes_update']);
const MAX_BODY_BYTES = 64 * 1024;
const encoder = new TextEncoder();

export function createAppLifecycleWebhooksHandler(env, dependencies = {}) {
  const createRepository = dependencies.createOAuthRepository ?? createOAuthRepository;
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? console;

  return async function handleAppLifecycleWebhook(request) {
    if (request.method !== 'POST') return response(405, 'Method must be POST.', { Allow: 'POST' });
    try {
      const bindings = validateBindings(env, createRepository);
      const { rawBody, ...headers } = await readVerifiedShopifyWebhook(request, {
        maxBodyBytes: MAX_BODY_BYTES,
        secret: bindings.secret,
        topics: TOPICS,
      });
      const payload = parsePayload(rawBody);
      const createdAt = readNow(now);
      if (headers.topic === 'app/uninstalled') {
        await bindings.repository.markUninstalled({
          webhookId: headers.webhookId,
          shop: headers.shop,
          event: 'uninstalled',
          scopes: [],
          createdAt,
        });
      } else {
        await bindings.repository.updateScopes({
          webhookId: headers.webhookId,
          shop: headers.shop,
          event: 'scopes_updated',
          scopes: readScopes(payload.current),
          requiredScopes: REQUIRED_SHOPIFY_SCOPES,
          createdAt,
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: standardHeaders(),
      });
    } catch (error) {
      if (error instanceof LifecycleRequestError) return response(error.status, error.message);
      if (error instanceof ShopifyWebhookRequestError) {
        const message = error.status === 401
          ? 'Webhook authentication failed.'
          : error.status === 413 ? 'Webhook body is too large.' : 'Webhook request is invalid.';
        return response(error.status, message);
      }
      logger.error?.('SHOPIFY_APP_LIFECYCLE_WEBHOOK_FAILED');
      return response(503, 'Webhook processing is temporarily unavailable.');
    }
  };
}

function validateBindings(env, createRepository) {
  if (!env || typeof env.SHOPIFY_API_SECRET !== 'string'
    || encoder.encode(env.SHOPIFY_API_SECRET).length < 16 || !env.PRODUCTION_DB) {
    throw new Error('Invalid lifecycle bindings.');
  }
  const repository = createRepository(env.PRODUCTION_DB);
  if (typeof repository?.markUninstalled !== 'function'
    || typeof repository?.updateScopes !== 'function') throw new Error('Invalid lifecycle repository.');
  return { repository, secret: env.SHOPIFY_API_SECRET };
}

function parsePayload(bytes) {
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch {
    throw new LifecycleRequestError(400, 'Webhook request is invalid.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LifecycleRequestError(400, 'Webhook request is invalid.');
  }
  return payload;
}

function readScopes(value) {
  if (!Array.isArray(value) || value.length > 100) throw new LifecycleRequestError(400, 'Webhook request is invalid.');
  const scopes = value.map((scope) => {
    if (typeof scope !== 'string' || !/^[a-z][a-z0-9_]{1,79}$/u.test(scope)) {
      throw new LifecycleRequestError(400, 'Webhook request is invalid.');
    }
    return scope;
  });
  if (new Set(scopes).size !== scopes.length) throw new LifecycleRequestError(400, 'Webhook request is invalid.');
  return scopes;
}

function readNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid clock.');
  return value;
}

function response(status, message, extra = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...standardHeaders(), ...extra },
  });
}

function standardHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
}

class LifecycleRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
