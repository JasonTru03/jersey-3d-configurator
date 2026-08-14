import { createPrivacyRepository } from './privacyRepository.js';
import {
  readVerifiedShopifyWebhook,
  ShopifyWebhookRequestError,
} from './webhookSecurity.js';

const TOPICS = new Set(['customers/data_request', 'customers/redact', 'shop/redact']);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ORDERS = 250;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

class PrivacyWebhookError extends Error {
  constructor(status) {
    super('Shopify privacy webhook request failed.');
    this.status = status;
  }
}

export function createPrivacyWebhooksHandler(env, dependencies = {}) {
  const createRepository = dependencies.createPrivacyRepository ?? createPrivacyRepository;
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? console;

  return async function handlePrivacyWebhook(request) {
    if (request.method !== 'POST') return errorResponse(405, 'Method must be POST.', { Allow: 'POST' });
    try {
      const bindings = validateBindings(env, createRepository);
      const { rawBody, ...headers } = await readVerifiedShopifyWebhook(request, {
        maxBodyBytes: MAX_BODY_BYTES,
        secret: bindings.secret,
        topics: TOPICS,
      });
      const payload = parsePayload(rawBody, headers);
      const receivedAt = readNow(now);
      const orderGids = payload.orderIds.map((id) => `gid://shopify/Order/${id}`);
      const requestRecord = {
        webhookId: headers.webhookId,
        shop: headers.shop,
        topic: headers.topic,
        requestId: payload.requestId,
        orderGids,
        receivedAt,
      };
      const existing = await bindings.repository.getRequest(headers.webhookId);
      if (existing && !sameRequest(existing, requestRecord)) throw new Error('Webhook ID conflict.');
      if (existing && existing.status !== 'pending') return successResponse();
      await bindings.repository.recordRequest(requestRecord);
      const designs = await bindings.repository.listDesigns({
        shop: headers.shop,
        topic: headers.topic,
        orderGids,
      });
      if (headers.topic === 'customers/data_request') {
        await bindings.repository.completeDataRequest({
          ...requestRecord,
          designs,
          completedAt: readNow(now),
        });
        return successResponse();
      }
      await deleteDesignAssets(bindings.assets, designs);
      await bindings.repository.completeRedaction({
        ...requestRecord,
        designs,
        completedAt: readNow(now),
      });
      return successResponse();
    } catch (error) {
      if (error instanceof PrivacyWebhookError || error instanceof ShopifyWebhookRequestError) {
        return errorResponse(error.status, errorMessage(error.status));
      }
      logger.error?.('SHOPIFY_PRIVACY_WEBHOOK_FAILED');
      return errorResponse(503, 'Privacy request processing is temporarily unavailable.');
    }
  };
}

function sameRequest(existing, received) {
  return existing.shop === received.shop
    && existing.topic === received.topic
    && existing.requestId === received.requestId
    && Array.isArray(existing.orderGids)
    && existing.orderGids.length === received.orderGids.length
    && existing.orderGids.every((value, index) => value === received.orderGids[index]);
}

function validateBindings(env, createRepository) {
  if (!env || typeof env.SHOPIFY_API_SECRET !== 'string'
    || encoder.encode(env.SHOPIFY_API_SECRET).length < 16
    || !env.PRODUCTION_DB
    || typeof env.PRODUCTION_DB.prepare !== 'function'
    || typeof env.PRODUCTION_DB.batch !== 'function'
    || !env.PRODUCTION_ASSETS
    || typeof env.PRODUCTION_ASSETS.delete !== 'function') throw new Error('Invalid bindings.');
  const repository = createRepository(env.PRODUCTION_DB);
  for (const method of [
    'getRequest', 'recordRequest', 'listDesigns', 'completeDataRequest', 'completeRedaction',
  ]) {
    if (typeof repository?.[method] !== 'function') throw new Error('Invalid repository.');
  }
  return { assets: env.PRODUCTION_ASSETS, repository, secret: env.SHOPIFY_API_SECRET };
}

function parsePayload(rawBody, headers) {
  let payload;
  try { payload = JSON.parse(decoder.decode(rawBody)); } catch { throw new PrivacyWebhookError(400); }
  if (!isPlainObject(payload) || payload.shop_domain !== headers.shop) {
    throw new PrivacyWebhookError(400);
  }
  if (headers.topic === 'customers/data_request') {
    return {
      requestId: readId(payload.data_request?.id),
      orderIds: readIds(payload.orders_requested),
    };
  }
  if (headers.topic === 'customers/redact') {
    return {
      requestId: readId(payload.customer?.id),
      orderIds: readIds(payload.orders_to_redact),
    };
  }
  return { requestId: readId(payload.shop_id), orderIds: [] };
}

function readIds(value) {
  if (!Array.isArray(value) || value.length > MAX_ORDERS) throw new PrivacyWebhookError(400);
  const result = value.map(readId);
  if (new Set(result).size !== result.length) throw new PrivacyWebhookError(400);
  return result;
}

function readId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9][0-9]{0,31}$/u.test(value)) return value;
  throw new PrivacyWebhookError(400);
}

async function deleteDesignAssets(assets, designs) {
  const keys = [...new Set(designs.flatMap(({ manifestKey, bundleKey }) => [manifestKey, bundleKey]))];
  for (let index = 0; index < keys.length; index += 1000) {
    await assets.delete(keys.slice(index, index + 1000));
  }
}

function readNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid clock.');
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function successResponse() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: responseHeaders() });
}

function errorResponse(status, error, extra = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...responseHeaders(), ...extra },
  });
}

function responseHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
}

function errorMessage(status) {
  if (status === 401) return 'Webhook authentication failed.';
  if (status === 413) return 'Webhook body is too large.';
  return 'Webhook request is invalid.';
}
