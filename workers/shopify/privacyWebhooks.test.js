import { describe, expect, it, vi } from 'vitest';
import { createPrivacyWebhooksHandler } from './privacyWebhooks.js';

const SHOP = 'privacy-test.myshopify.com';
const OTHER_SHOP = 'other-shop.myshopify.com';
const SECRET = 'shopify-privacy-secret-at-least-32-bytes';
const NOW = 1_700_000_000_000;
const WEBHOOK_ID = 'privacy-webhook-12345678';
const DESIGN = Object.freeze({
  designId: 'dsg_1234567890abcdef',
  orderGid: 'gid://shopify/Order/5678901234567',
  status: 'paid_pending_production',
  productId: 'fn8788-jersey',
  variantId: '12345678901234',
  size: 's',
  manifestKey: `shops/${SHOP}/designs/dsg_1234567890abcdef/manifest.json`,
  bundleKey: `shops/${SHOP}/designs/dsg_1234567890abcdef/bundle.zip`,
});

describe('Shopify privacy compliance webhooks', () => {
  it('authenticates and prepares the minimum stored-data response for a customer request', async () => {
    const runtime = createRuntime({ designs: [DESIGN] });
    const response = await runtime.handler(await signedRequest('customers/data_request', {
      shop_id: 123,
      shop_domain: SHOP,
      orders_requested: [5678901234567],
      customer: { id: 99, email: 'not-stored@example.com' },
      data_request: { id: 7001 },
    }));

    expect(response.status).toBe(200);
    expect(runtime.repository.recordRequest).toHaveBeenCalledWith({
      webhookId: WEBHOOK_ID,
      shop: SHOP,
      topic: 'customers/data_request',
      requestId: '7001',
      orderGids: ['gid://shopify/Order/5678901234567'],
      receivedAt: NOW,
    });
    expect(runtime.repository.completeDataRequest).toHaveBeenCalledWith(expect.objectContaining({
      designs: [DESIGN],
      completedAt: NOW,
    }));
    expect(runtime.assets.delete).not.toHaveBeenCalled();
  });

  it('deletes only requested-order assets before completing customer redaction', async () => {
    const runtime = createRuntime({ designs: [DESIGN] });
    const response = await runtime.handler(await signedRequest('customers/redact', {
      shop_id: 123,
      shop_domain: SHOP,
      customer: { id: 99, email: 'redacted@example.com' },
      orders_to_redact: [5678901234567],
    }));

    expect(response.status).toBe(200);
    expect(runtime.repository.listDesigns).toHaveBeenCalledWith({
      shop: SHOP,
      topic: 'customers/redact',
      orderGids: ['gid://shopify/Order/5678901234567'],
    });
    expect(runtime.assets.delete).toHaveBeenCalledWith([DESIGN.manifestKey, DESIGN.bundleKey]);
    expect(runtime.repository.completeRedaction).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'customers/redact',
      designs: [DESIGN],
    }));
  });

  it('scopes shop redaction to the authenticated shop and supports empty shops', async () => {
    for (const designs of [[DESIGN], []]) {
      const runtime = createRuntime({ designs });
      const response = await runtime.handler(await signedRequest('shop/redact', {
        shop_id: 123,
        shop_domain: SHOP,
      }));

      expect(response.status).toBe(200);
      expect(runtime.repository.listDesigns).toHaveBeenCalledWith({
        shop: SHOP,
        topic: 'shop/redact',
        orderGids: [],
      });
      expect(runtime.repository.completeRedaction).toHaveBeenCalledWith(expect.objectContaining({
        shop: SHOP,
        requestId: '123',
      }));
    }
  });

  it('returns duplicate completed deliveries without deleting twice', async () => {
    const runtime = createRuntime({
      existing: {
        status: 'completed',
        shop: SHOP,
        topic: 'shop/redact',
        requestId: '123',
        orderGids: [],
      },
      designs: [DESIGN],
    });
    const response = await runtime.handler(await signedRequest('shop/redact', {
      shop_id: 123,
      shop_domain: SHOP,
    }));

    expect(response.status).toBe(200);
    expect(runtime.repository.recordRequest).not.toHaveBeenCalled();
    expect(runtime.assets.delete).not.toHaveBeenCalled();
    expect(runtime.repository.completeRedaction).not.toHaveBeenCalled();
  });

  it('rejects a completed webhook ID reused with different request data', async () => {
    const runtime = createRuntime({
      existing: {
        status: 'completed',
        shop: SHOP,
        topic: 'shop/redact',
        requestId: '999',
        orderGids: [],
      },
    });
    const response = await runtime.handler(await signedRequest('shop/redact', {
      shop_id: 123,
      shop_domain: SHOP,
    }));

    expect(response.status).toBe(503);
    expect(runtime.repository.recordRequest).not.toHaveBeenCalled();
    expect(runtime.assets.delete).not.toHaveBeenCalled();
  });

  it('retries a pending redaction and fails closed when object deletion is unavailable', async () => {
    const runtime = createRuntime({
      existing: {
        status: 'pending',
        shop: SHOP,
        topic: 'shop/redact',
        requestId: '123',
        orderGids: [],
      },
      designs: [DESIGN],
    });
    runtime.assets.delete.mockRejectedValueOnce(new Error('private storage detail'));
    const response = await runtime.handler(await signedRequest('shop/redact', {
      shop_id: 123,
      shop_domain: SHOP,
    }));

    expect(response.status).toBe(503);
    expect(runtime.repository.recordRequest).toHaveBeenCalledOnce();
    expect(runtime.repository.completeRedaction).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toMatch(/private storage/iu);
  });

  it('rejects forged HMAC, mismatched shops, invalid topics and oversized bodies before storage', async () => {
    const cases = [
      () => signedRequest('shop/redact', { shop_id: 123, shop_domain: SHOP }, {
        hmac: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
      () => signedRequest('shop/redact', { shop_id: 123, shop_domain: OTHER_SHOP }),
      () => signedRequest('orders/create', { shop_id: 123, shop_domain: SHOP }),
      () => signedRequest('shop/redact', { shop_id: 123, shop_domain: SHOP }, {
        contentLength: String(256 * 1024 + 1),
      }),
    ];
    for (const createRequest of cases) {
      const runtime = createRuntime();
      const response = await runtime.handler(await createRequest());
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(runtime.repository.getRequest).not.toHaveBeenCalled();
      expect(runtime.repository.recordRequest).not.toHaveBeenCalled();
      expect(runtime.assets.delete).not.toHaveBeenCalled();
    }
  });
});

function createRuntime({ designs = [], existing = null } = {}) {
  const repository = {
    getRequest: vi.fn(async () => existing),
    recordRequest: vi.fn(async (value) => ({ ...value, status: 'pending' })),
    listDesigns: vi.fn(async () => designs),
    completeDataRequest: vi.fn(async () => undefined),
    completeRedaction: vi.fn(async () => undefined),
  };
  const assets = { delete: vi.fn(async () => undefined) };
  const handler = createPrivacyWebhooksHandler({
    SHOPIFY_API_SECRET: SECRET,
    PRODUCTION_DB: { prepare: vi.fn(), batch: vi.fn() },
    PRODUCTION_ASSETS: assets,
  }, {
    createPrivacyRepository: () => repository,
    now: () => NOW,
    logger: { error: vi.fn() },
  });
  return { assets, handler, repository };
}

async function signedRequest(topic, payload, overrides = {}) {
  const body = JSON.stringify(payload);
  const hmac = overrides.hmac ?? await sign(body);
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Shopify-Hmac-Sha256': hmac,
    'X-Shopify-Shop-Domain': SHOP,
    'X-Shopify-Topic': topic,
    'X-Shopify-Webhook-Id': WEBHOOK_ID,
  });
  if (overrides.contentLength) headers.set('Content-Length', overrides.contentLength);
  return new Request('https://worker.example/webhooks/shopify/privacy', {
    method: 'POST',
    headers,
    body,
  });
}

async function sign(body) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(body),
  ));
  return btoa(String.fromCharCode(...bytes));
}
