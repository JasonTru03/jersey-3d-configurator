const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const WEBHOOK_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const HMAC_PATTERN = /^[A-Za-z0-9+/]{43}=$/u;
const CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
const encoder = new TextEncoder();

export async function readVerifiedShopifyWebhook(request, options) {
  const { maxBodyBytes, secret, topics } = validateOptions(options);
  const headers = validateHeaders(request.headers, topics, maxBodyBytes);
  const rawBody = await readRawBody(request, maxBodyBytes);
  if (!await validHmac(rawBody, headers.hmac, secret)) {
    throw new ShopifyWebhookRequestError(401);
  }
  return Object.freeze({ ...headers, rawBody });
}

function validateOptions(options) {
  if (!options || !(options.topics instanceof Set) || options.topics.size === 0
    || !Number.isSafeInteger(options.maxBodyBytes) || options.maxBodyBytes < 1
    || options.maxBodyBytes > 1024 * 1024
    || typeof options.secret !== 'string' || encoder.encode(options.secret).length < 16) {
    throw new TypeError('Invalid Shopify webhook verification options.');
  }
  return options;
}

function validateHeaders(headers, topics, maxBodyBytes) {
  const hmac = headers.get('X-Shopify-Hmac-Sha256');
  const shop = headers.get('X-Shopify-Shop-Domain');
  const topic = headers.get('X-Shopify-Topic');
  const webhookId = headers.get('X-Shopify-Webhook-Id');
  const contentType = headers.get('Content-Type');
  const contentLength = headers.get('Content-Length');
  if (!SHOP_PATTERN.test(shop ?? '') || !topics.has(topic)
    || !WEBHOOK_ID_PATTERN.test(webhookId ?? '')
    || !CONTENT_TYPE_PATTERN.test(contentType ?? '')) throw new ShopifyWebhookRequestError(400);
  if (!HMAC_PATTERN.test(hmac ?? '')) throw new ShopifyWebhookRequestError(401);
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(contentLength)) {
      throw new ShopifyWebhookRequestError(400);
    }
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length)) throw new ShopifyWebhookRequestError(400);
    if (length > maxBodyBytes) throw new ShopifyWebhookRequestError(413);
  }
  return { hmac, shop, topic, webhookId };
}

async function readRawBody(request, maxBodyBytes) {
  if (!request.body) throw new ShopifyWebhookRequestError(400);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        throw new ShopifyWebhookRequestError(413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ShopifyWebhookRequestError) throw error;
    throw new ShopifyWebhookRequestError(400);
  }
  if (request.headers.has('Content-Length')
    && Number(request.headers.get('Content-Length')) !== total) {
    throw new ShopifyWebhookRequestError(400);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function validHmac(rawBody, provided, secret) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody));
  const actual = decodeBase64(provided);
  if (!actual || actual.byteLength !== expected.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < expected.byteLength; index += 1) {
    difference |= expected[index] ^ actual[index];
  }
  return difference === 0;
}

function decodeBase64(value) {
  try {
    const binary = atob(value);
    if (binary.length !== 32) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch { return null; }
}

export class ShopifyWebhookRequestError extends Error {
  constructor(status) {
    super('Shopify webhook request failed.');
    this.name = 'ShopifyWebhookRequestError';
    this.status = status;
  }
}
