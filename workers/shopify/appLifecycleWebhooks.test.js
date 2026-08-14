import { describe, expect, it, vi } from 'vitest';
import { createAppLifecycleWebhooksHandler } from './appLifecycleWebhooks.js';
import { REQUIRED_SHOPIFY_SCOPES } from './oauth.js';

const SHOP = 'lifecycle-test.myshopify.com';
const SECRET = 'lifecycle-webhook-secret-at-least-32';
const NOW = 1_700_000_000_000;

describe('Shopify app lifecycle webhooks', () => {
  it('clears the installation on an authenticated uninstall', async () => {
    const runtime = createRuntime();
    const response = await runtime.handler(await signedRequest('app/uninstalled', { id: 123 }));

    expect(response.status).toBe(200);
    expect(runtime.repository.markUninstalled).toHaveBeenCalledWith({
      webhookId: 'lifecycle-webhook-1234',
      shop: SHOP,
      event: 'uninstalled',
      scopes: [],
      createdAt: NOW,
    });
  });

  it('updates and validates current scopes', async () => {
    const runtime = createRuntime();
    const response = await runtime.handler(await signedRequest('app/scopes_update', {
      current: [...REQUIRED_SHOPIFY_SCOPES], previous: [],
    }));

    expect(response.status).toBe(200);
    expect(runtime.repository.updateScopes).toHaveBeenCalledWith({
      webhookId: 'lifecycle-webhook-1234',
      shop: SHOP,
      event: 'scopes_updated',
      scopes: [...REQUIRED_SHOPIFY_SCOPES],
      requiredScopes: REQUIRED_SHOPIFY_SCOPES,
      createdAt: NOW,
    });
  });

  it('rejects forged signatures and invalid topics before mutation', async () => {
    const forged = await signedRequest('app/uninstalled', { id: 123 }, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    const invalidTopic = await signedRequest('orders/create', { id: 123 });
    for (const request of [forged, invalidTopic]) {
      const runtime = createRuntime();
      const response = await runtime.handler(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(runtime.repository.markUninstalled).not.toHaveBeenCalled();
      expect(runtime.repository.updateScopes).not.toHaveBeenCalled();
    }
  });
});

function createRuntime() {
  const repository = {
    markUninstalled: vi.fn(async () => undefined),
    updateScopes: vi.fn(async () => undefined),
  };
  return {
    repository,
    handler: createAppLifecycleWebhooksHandler({
      SHOPIFY_API_SECRET: SECRET,
      PRODUCTION_DB: {},
    }, {
      createOAuthRepository: () => repository,
      now: () => NOW,
      logger: { error: vi.fn() },
    }),
  };
}

async function signedRequest(topic, payload, providedHmac) {
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(body),
  ));
  const hmac = providedHmac ?? btoa(String.fromCharCode(...bytes));
  return new Request('https://public.example/webhooks/shopify/app-lifecycle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Hmac-Sha256': hmac,
      'X-Shopify-Shop-Domain': SHOP,
      'X-Shopify-Topic': topic,
      'X-Shopify-Webhook-Id': 'lifecycle-webhook-1234',
    },
    body,
  });
}
