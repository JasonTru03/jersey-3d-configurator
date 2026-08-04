import { describe, expect, it, vi } from 'vitest';
import { createOrderLifecycleWebhooksHandler } from './orderLifecycleWebhooks.js';

const SHOP = 'jersey-test.myshopify.com';
const SECRET = 'shopify-webhook-secret-at-least-32-bytes';
const NOW = 1_700_000_000_500;
const PAID_AT = Date.parse('2023-11-14T22:13:20.000Z');
const ORDER_ID = '5678901234567';
const ORDER_GID = `gid://shopify/Order/${ORDER_ID}`;
const DESIGN_ID = 'dsg_1234567890abcdef';
const SECOND_DESIGN_ID = 'dsg_fedcba0987654321';
const BUNDLE_ID = 'bun_1234567890abcdef';
const SECOND_BUNDLE_ID = 'bun_fedcba0987654321';
const VARIANT_ID = '12345678901234';
const SECOND_VARIANT_ID = '22345678901234';
const LARGE_ORDER_ID = '820982911946154508';
const LARGE_VARIANT_ID = '123456789012345678';
const MANIFEST_BYTES = new TextEncoder().encode('{"manifest":"trusted"}');
const BUNDLE_HASH = 'b'.repeat(64);

describe('Shopify order lifecycle webhooks', () => {
  it('authenticates a real paid-order payload and atomically links trusted jersey designs', async () => {
    const runtime = await createRuntime();
    const response = await runtime.handler(await signedRequest(paidPayload()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(runtime.repository.getDesign).toHaveBeenCalledWith(SHOP, DESIGN_ID);
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledOnce();
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledWith({
      delivery: {
        webhookId: '12345678-1234-1234-1234-123456789abc',
        eventId: '01HXABCDEFGHIJKLMNOPQRSTUV',
        shop: SHOP,
        topic: 'orders/paid',
        orderGid: ORDER_GID,
        receivedAt: NOW,
      },
      designs: [{
        designId: DESIGN_ID,
        bundleId: BUNDLE_ID,
        orderName: '#1001',
        paidAt: PAID_AT,
        updatedAt: NOW,
        errorCode: null,
      }],
      status: 'paid_pending_production',
    });
    expect(runtime.assets.head).toHaveBeenCalledTimes(2);
    expect(runtime.assets.get).toHaveBeenCalledWith(runtime.drafts[DESIGN_ID].manifestKey);
  });

  it('preserves official REST-shaped unsafe integer order and variant IDs from raw JSON', async () => {
    const runtime = await createRuntime({
      drafts: { [DESIGN_ID]: draft({ variantId: LARGE_VARIANT_ID }) },
    });
    const payload = paidPayload({
      id: '__ORDER_ID__',
      admin_graphql_api_id: `gid://shopify/Order/${LARGE_ORDER_ID}`,
      line_items: jerseyLines({
        variantId: LARGE_VARIANT_ID,
        variantValue: '__VARIANT_ID__',
      }),
    });
    const rawJson = JSON.stringify(payload)
      .replace('"__ORDER_ID__"', LARGE_ORDER_ID)
      .replace('"__VARIANT_ID__"', LARGE_VARIANT_ID);

    const response = await runtime.handler(await signedJsonText(rawJson));

    expect(response.status).toBe(200);
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      delivery: expect.objectContaining({
        orderGid: `gid://shopify/Order/${LARGE_ORDER_ID}`,
      }),
      status: 'paid_pending_production',
    }));
  });

  it('uses only private design properties and ignores buyer-facing summaries and unrelated orders', async () => {
    const runtime = await createRuntime();
    const unrelated = paidPayload({
      line_items: [{
        id: 7001,
        admin_graphql_api_id: 'gid://shopify/LineItem/7001',
        variant_id: 123,
        admin_graphql_api_product_id: 'gid://shopify/Product/123',
        quantity: 1,
        properties: [
          { name: 'Production Files', value: `forged ${DESIGN_ID}` },
          { name: 'Bundle File', value: BUNDLE_ID },
          { name: 'Design File', value: DESIGN_ID },
          { name: 'UV Atlas SHA-256', value: 'sha256:' + 'a'.repeat(64) },
        ],
      }],
    });

    const response = await runtime.handler(await signedRequest(unrelated));

    expect(response.status).toBe(200);
    expect(runtime.repository.hasWebhookDelivery).toHaveBeenCalledOnce();
    expect(runtime.repository.getDesign).not.toHaveBeenCalled();
    expect(runtime.repository.recordOrderLifecycle).not.toHaveBeenCalled();
    expect(runtime.assets.head).not.toHaveBeenCalled();
  });

  it('requires every line for a design to use its stored bundle and the base line variant', async () => {
    for (const payload of [
      paidPayload({ line_items: jerseyLines({ bundleId: SECOND_BUNDLE_ID }) }),
      paidPayload({ line_items: jerseyLines({ variantId: SECOND_VARIANT_ID }) }),
      paidPayload({ line_items: jerseyLines({ component: 'surcharge' }) }),
    ]) {
      const runtime = await createRuntime();
      const response = await runtime.handler(await signedRequest(payload));

      expect(response.status).toBe(422);
      expect(runtime.repository.recordOrderLifecycle).not.toHaveBeenCalled();
      expect(runtime.assets.head).not.toHaveBeenCalled();
    }
  });

  it('accepts the real Cart Transform merged parent with canonical component evidence', async () => {
    const runtime = await createRuntime();
    const response = await runtime.handler(await signedRequest(paidPayload({
      line_items: [mergedJerseyLine()],
    })));

    expect(response.status).toBe(200);
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'paid_pending_production',
      designs: [expect.objectContaining({ designId: DESIGN_ID, bundleId: BUNDLE_ID })],
    }));
  });

  it.each([
    JSON.stringify([['b', VARIANT_ID, 1, 'extra']]),
    JSON.stringify([['b', VARIANT_ID, 1], ['b', VARIANT_ID, 1]]),
    JSON.stringify([['b', VARIANT_ID, 1], ['s', VARIANT_ID, 1]]),
    JSON.stringify([['s', '42', 1], ['b', VARIANT_ID, 1]]),
    ` ${JSON.stringify([['b', VARIANT_ID, 1]])}`,
    JSON.stringify([['b', VARIANT_ID, 0]]),
  ])('rejects non-canonical or ambiguous merged component evidence: %s', async (components) => {
    const runtime = await createRuntime();
    const response = await runtime.handler(await signedRequest(paidPayload({
      line_items: [mergedJerseyLine({ components })],
    })));

    expect(response.status).toBe(422);
    expect(runtime.repository.getDesign).not.toHaveBeenCalled();
    expect(runtime.assets.head).not.toHaveBeenCalled();
  });

  it('rejects a design stored under another shop or Shopify order before touching R2', async () => {
    for (const stored of [
      draft({ shop: 'another-shop.myshopify.com' }),
      draft({ shopifyOrderGid: 'gid://shopify/Order/9999999999999' }),
    ]) {
      const runtime = await createRuntime({ drafts: { [DESIGN_ID]: stored } });
      const response = await runtime.handler(await signedRequest(paidPayload()));

      expect(response.status).toBe(422);
      expect(runtime.assets.head).not.toHaveBeenCalled();
      expect(runtime.repository.recordOrderLifecycle).not.toHaveBeenCalled();
    }
  });

  it('rejects variant IDs outside the canonical Shopify uint64 range', async () => {
    const oversizedVariantId = '99999999999999999999999999999999';
    const runtime = await createRuntime({
      drafts: { [DESIGN_ID]: draft({ variantId: oversizedVariantId }) },
    });

    const response = await runtime.handler(await signedRequest(paidPayload({
      line_items: jerseyLines({ variantId: oversizedVariantId }),
    })));

    expect(response.status).toBe(422);
    expect(runtime.assets.head).not.toHaveBeenCalled();
  });

  it('marks the whole paid order file_error atomically when any design files are missing', async () => {
    const runtime = await createRuntime({
      drafts: {
        [DESIGN_ID]: draft(),
        [SECOND_DESIGN_ID]: draft({
          designId: SECOND_DESIGN_ID,
          bundleId: SECOND_BUNDLE_ID,
          variantId: SECOND_VARIANT_ID,
          manifestKey: `shops/${SHOP}/designs/${SECOND_DESIGN_ID}/manifest.json`,
          bundleKey: `shops/${SHOP}/designs/${SECOND_DESIGN_ID}/second-design-deadbeef.zip`,
          bundleFilename: 'second-design-deadbeef.zip',
        }),
      },
      missingKey: `shops/${SHOP}/designs/${SECOND_DESIGN_ID}/second-design-deadbeef.zip`,
    });
    const payload = paidPayload({
      line_items: [
        ...jerseyLines(),
        ...jerseyLines({
          designId: SECOND_DESIGN_ID,
          bundleId: SECOND_BUNDLE_ID,
          variantId: SECOND_VARIANT_ID,
        }),
      ],
    });

    const response = await runtime.handler(await signedRequest(payload));

    expect(response.status).toBe(200);
    const lifecycle = runtime.repository.recordOrderLifecycle.mock.calls[0][0];
    expect(lifecycle.status).toBe('file_error');
    expect(lifecycle.designs).toEqual([
      expect.objectContaining({ designId: DESIGN_ID, errorCode: 'ORDER_FILE_ERROR' }),
      expect.objectContaining({ designId: SECOND_DESIGN_ID, errorCode: 'ORDER_FILE_ERROR' }),
    ]);
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledOnce();
  });

  it('marks corrupt bundle checksum metadata file_error instead of presenting it ready', async () => {
    const runtime = await createRuntime();
    const originalHead = runtime.assets.head.getMockImplementation();
    runtime.assets.head.mockImplementation(async (key) => {
      const head = await originalHead(key);
      if (key !== runtime.drafts[DESIGN_ID].bundleKey) return head;
      return { ...head, checksums: { sha256: hexToArrayBuffer('c'.repeat(64)) } };
    });

    const response = await runtime.handler(await signedRequest(paidPayload()));

    expect(response.status).toBe(200);
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'file_error',
      designs: [expect.objectContaining({ errorCode: 'ORDER_FILE_ERROR' })],
    }));
  });

  it.each([
    ['orders/cancelled', 'cancelled', () => cancelledPayload(), ORDER_GID],
    ['refunds/create', 'refunded', () => refundPayload(), ORDER_GID],
  ])('reads real %s line properties and preserves the original order identity', async (
    topic,
    status,
    payloadFactory,
    orderGid,
  ) => {
    const runtime = await createRuntime();
    const response = await runtime.handler(await signedRequest(payloadFactory(), { topic }));

    expect(response.status).toBe(200);
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledWith({
      delivery: expect.objectContaining({ topic, orderGid, shop: SHOP }),
      designs: [{ designId: DESIGN_ID, updatedAt: NOW }],
      status,
    });
    expect(runtime.repository.getDesign).not.toHaveBeenCalled();
    expect(runtime.assets.head).not.toHaveBeenCalled();
    expect(runtime.assets.delete).not.toHaveBeenCalled();
  });

  it('uses the lossless refund order_id and ignores a deleted variant on terminal events', async () => {
    const runtime = await createRuntime();
    const payload = refundPayload();
    payload.order_id = '__ORDER_ID__';
    payload.refund_line_items[0].line_item.variant_id = null;
    const rawJson = JSON.stringify(payload).replace('"__ORDER_ID__"', LARGE_ORDER_ID);

    const response = await runtime.handler(await signedJsonText(rawJson, { topic: 'refunds/create' }));

    expect(response.status).toBe(200);
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      delivery: expect.objectContaining({
        orderGid: `gid://shopify/Order/${LARGE_ORDER_ID}`,
      }),
      designs: [{ designId: DESIGN_ID, updatedAt: NOW }],
      status: 'refunded',
    }));
  });

  it('ignores buyer-facing property values while extracting terminal design IDs', async () => {
    const runtime = await createRuntime();
    const payload = cancelledPayload();
    payload.line_items[0].properties.push({ name: 'Bundle File', value: { forged: true } });

    const response = await runtime.handler(await signedRequest(payload, { topic: 'orders/cancelled' }));

    expect(response.status).toBe(200);
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      designs: [{ designId: DESIGN_ID, updatedAt: NOW }],
      status: 'cancelled',
    }));
  });

  it('returns 200 for duplicate delivery and event identities before loading designs or R2', async () => {
    for (const repositoryOverrides of [
      { hasWebhookDelivery: vi.fn(async () => true) },
      {
        hasWebhookDelivery: vi.fn(async () => false),
        hasWebhookEvent: vi.fn(async () => true),
      },
    ]) {
      const runtime = await createRuntime({ repositoryOverrides });
      const response = await runtime.handler(await signedRequest(paidPayload()));

      expect(response.status).toBe(200);
      expect(runtime.repository.getDesign).not.toHaveBeenCalled();
      expect(runtime.repository.recordOrderLifecycle).not.toHaveBeenCalled();
      expect(runtime.assets.head).not.toHaveBeenCalled();
    }
  });

  it('turns an atomic receipt race into duplicate success without replaying files', async () => {
    const conflict = Object.assign(new Error('repository details'), {
      code: 'production-repository-conflict',
    });
    const hasWebhookDelivery = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const runtime = await createRuntime({
      repositoryOverrides: {
        hasWebhookDelivery,
        recordOrderLifecycle: vi.fn(async () => { throw conflict; }),
      },
    });

    const response = await runtime.handler(await signedRequest(paidPayload()));

    expect(response.status).toBe(200);
    expect(hasWebhookDelivery).toHaveBeenCalledTimes(2);
    expect(runtime.repository.recordOrderLifecycle).toHaveBeenCalledOnce();
  });

  it('rejects authentication, header and body-format failures before any D1 or R2 operation', async () => {
    const invalidCases = [
      () => new Request('https://worker.example/webhooks/shopify/orders', { method: 'GET' }),
      () => signedRequest(paidPayload(), { omitHmac: true }),
      () => signedRequest(paidPayload(), { hmac: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }),
      () => signedRequest(paidPayload(), { shop: 'evil.example.com' }),
      () => signedRequest(paidPayload(), { webhookId: null }),
      () => signedRequest(paidPayload(), { topic: 'orders/create' }),
      () => signedRequest(paidPayload(), { contentType: 'text/plain' }),
      () => signedRequest(paidPayload(), { contentLength: String(1024 * 1024 + 1) }),
      () => signedRawRequest(new Uint8Array([0xc3, 0x28])),
      () => signedRawRequest(new TextEncoder().encode('{not-json')),
      () => signedRawRequest(new Uint8Array(1024 * 1024 + 1)),
    ];

    for (const createRequest of invalidCases) {
      const runtime = await createRuntime();
      const response = await runtime.handler(await createRequest());

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(runtime.repository.hasWebhookDelivery).not.toHaveBeenCalled();
      expect(runtime.repository.hasWebhookEvent).not.toHaveBeenCalled();
      expect(runtime.repository.getDesign).not.toHaveBeenCalled();
      expect(runtime.repository.recordOrderLifecycle).not.toHaveBeenCalled();
      expect(runtime.assets.head).not.toHaveBeenCalled();
      expect(runtime.assets.get).not.toHaveBeenCalled();
    }
  });

  it('authenticates original bytes before attempting strict JSON parsing', async () => {
    const invalidJson = new TextEncoder().encode('{not-json');
    const runtime = await createRuntime();

    const unauthenticated = await runtime.handler(await signedRawRequest(invalidJson, {
      hmac: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    }));
    const authenticated = await runtime.handler(await signedRawRequest(invalidJson));

    expect(unauthenticated.status).toBe(401);
    expect(authenticated.status).toBe(400);
    expect(runtime.repository.hasWebhookDelivery).not.toHaveBeenCalled();
    expect(runtime.assets.head).not.toHaveBeenCalled();
  });

  it('uses one raw byte read for both HMAC and fatal UTF-8 JSON decoding', async () => {
    let starts = 0;
    const bytes = new TextEncoder().encode(JSON.stringify(paidPayload()));
    const body = new ReadableStream({
      start(controller) {
        starts += 1;
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const runtime = await createRuntime();
    const request = await signedRawRequest(bytes, { body });

    const response = await runtime.handler(request);

    expect(response.status).toBe(200);
    expect(starts).toBe(1);
    expect(request.bodyUsed).toBe(true);
  });

  it('does not convert transient R2 failures into a permanent file_error', async () => {
    const runtime = await createRuntime();
    runtime.assets.head.mockRejectedValueOnce(new Error('private object details'));

    const response = await runtime.handler(await signedRequest(paidPayload()));

    expect(response.status).toBe(503);
    expect(runtime.repository.recordOrderLifecycle).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toMatch(/private object|shops\//iu);
  });
});

async function createRuntime({ drafts, missingKey, repositoryOverrides = {} } = {}) {
  const manifestHash = await sha256Hex(MANIFEST_BYTES);
  const storedDrafts = drafts ?? { [DESIGN_ID]: draft({ manifestSha256: manifestHash }) };
  for (const stored of Object.values(storedDrafts)) {
    if (stored.manifestSha256 === 'a'.repeat(64)) stored.manifestSha256 = manifestHash;
  }
  const repository = {
    hasWebhookDelivery: vi.fn(async () => false),
    hasWebhookEvent: vi.fn(async () => false),
    getDesign: vi.fn(async (_shop, designId) => storedDrafts[designId] ?? null),
    recordOrderLifecycle: vi.fn(async () => ({ status: 'stored' })),
    ...repositoryOverrides,
  };
  const assets = createAssets(storedDrafts, manifestHash, missingKey);
  const env = {
    SHOPIFY_API_SECRET: SECRET,
    PRODUCTION_DB: { prepare: vi.fn(), batch: vi.fn() },
    PRODUCTION_ASSETS: assets,
  };
  const handler = createOrderLifecycleWebhooksHandler(env, {
    createProductionRepository: vi.fn(() => repository),
    now: () => NOW,
    logger: { error: vi.fn() },
  });
  return { assets, drafts: storedDrafts, env, handler, repository };
}

function createAssets(drafts, manifestHash, missingKey) {
  const byKey = new Map();
  for (const stored of Object.values(drafts)) {
    byKey.set(stored.manifestKey, objectHead(stored, stored.manifestKey, manifestHash, 'application/json', MANIFEST_BYTES.length));
    byKey.set(stored.bundleKey, objectHead(stored, stored.bundleKey, BUNDLE_HASH, 'application/zip', 4096, true));
  }
  if (missingKey) byKey.delete(missingKey);
  return {
    head: vi.fn(async (key) => byKey.get(key) ?? null),
    get: vi.fn(async (key) => {
      if (!byKey.has(key)) return null;
      return { ...byKey.get(key), arrayBuffer: async () => MANIFEST_BYTES.slice().buffer };
    }),
    delete: vi.fn(),
  };
}

function objectHead(stored, key, sha256, contentType, size, includeNativeChecksum = false) {
  return {
    key,
    size,
    etag: 'etag',
    uploaded: new Date('2023-11-14T22:13:20.000Z'),
    httpEtag: '"etag"',
    version: 'version',
    httpMetadata: { contentType },
    customMetadata: {
      designFingerprint: stored.designFingerprint,
      productId: stored.productId,
      variantId: stored.variantId,
      size: stored.size,
      sha256,
      ...(contentType === 'application/zip' ? { contentLength: String(size) } : {}),
    },
    checksums: includeNativeChecksum ? { sha256: hexToArrayBuffer(sha256) } : {},
  };
}

function draft(overrides = {}) {
  return {
    designId: DESIGN_ID,
    shop: SHOP,
    status: 'cart_draft',
    bundleId: BUNDLE_ID,
    variantId: VARIANT_ID,
    productId: 'fn8788-jersey',
    size: 'xl',
    designFingerprint: 'deadbeef',
    manifestSha256: 'a'.repeat(64),
    manifestKey: `shops/${SHOP}/designs/${DESIGN_ID}/manifest.json`,
    bundleKey: `shops/${SHOP}/designs/${DESIGN_ID}/fn8788-jersey-design-deadbeef.zip`,
    bundleFilename: 'fn8788-jersey-design-deadbeef.zip',
    ...overrides,
  };
}

function paidPayload(overrides = {}) {
  return {
    id: Number(ORDER_ID),
    admin_graphql_api_id: ORDER_GID,
    name: '#1001',
    processed_at: '2023-11-14T22:13:20.000Z',
    line_items: jerseyLines(),
    customer: { id: 9988, email: 'buyer@example.com' },
    ...overrides,
  };
}

function cancelledPayload() {
  return {
    id: Number(ORDER_ID),
    admin_graphql_api_id: ORDER_GID,
    name: '#1001',
    cancelled_at: '2023-11-14T22:14:00.000Z',
    line_items: jerseyLines(),
  };
}

function refundPayload() {
  return {
    id: 991122,
    order_id: Number(ORDER_ID),
    admin_graphql_api_id: 'gid://shopify/Refund/991122',
    created_at: '2023-11-14T22:15:00.000Z',
    refund_line_items: jerseyLines().map((line_item) => ({
      id: line_item.id + 100,
      quantity: 1,
      line_item,
    })),
  };
}

function jerseyLines({
  designId = DESIGN_ID,
  bundleId = BUNDLE_ID,
  variantId = VARIANT_ID,
  variantValue = Number(variantId),
  component = 'base',
} = {}) {
  return [{
    id: 7001,
    admin_graphql_api_id: 'gid://shopify/LineItem/7001',
    variant_id: variantValue,
    admin_graphql_api_product_id: 'gid://shopify/Product/999',
    quantity: 1,
    properties: [
      { name: '_jersey_design_id', value: designId },
      { name: '_jersey_bundle_id', value: bundleId },
      { name: '_jersey_component', value: component },
      { name: 'Production Files', value: 'Cloud package ready' },
      { name: 'Bundle File', value: 'buyer-facing.zip' },
    ],
  }];
}

function mergedJerseyLine({
  bundleId = BUNDLE_ID,
  components = JSON.stringify([['b', VARIANT_ID, 1], ['s', '42', 1]]),
  designId = DESIGN_ID,
  variantId = VARIANT_ID,
} = {}) {
  return {
    id: 8001,
    admin_graphql_api_id: 'gid://shopify/LineItem/8001',
    variant_id: Number(variantId),
    quantity: 1,
    properties: [
      { name: '_jersey_design_id', value: designId },
      { name: '_jersey_bundle_id', value: bundleId },
      { name: '_jersey_components', value: components },
      { name: 'Production Files', value: 'Cloud package ready' },
      { name: 'Bundle File', value: 'fn8788-jersey-design-deadbeef.zip' },
    ],
  };
}

async function signedRequest(payload, options = {}) {
  return signedRawRequest(new TextEncoder().encode(JSON.stringify(payload)), options);
}

async function signedJsonText(text, options = {}) {
  return signedRawRequest(new TextEncoder().encode(text), options);
}

async function signedRawRequest(bytes, {
  body = bytes,
  contentLength,
  contentType = 'application/json',
  eventId = '01HXABCDEFGHIJKLMNOPQRSTUV',
  hmac,
  omitHmac = false,
  shop = SHOP,
  topic = 'orders/paid',
  webhookId = '12345678-1234-1234-1234-123456789abc',
} = {}) {
  const headers = new Headers();
  if (contentType !== null) headers.set('Content-Type', contentType);
  if (contentLength !== undefined) headers.set('Content-Length', contentLength);
  if (shop !== null) headers.set('X-Shopify-Shop-Domain', shop);
  if (topic !== null) headers.set('X-Shopify-Topic', topic);
  if (webhookId !== null) headers.set('X-Shopify-Webhook-Id', webhookId);
  if (eventId !== null) headers.set('X-Shopify-Event-Id', eventId);
  if (!omitHmac) headers.set('X-Shopify-Hmac-Sha256', hmac ?? await webhookHmac(bytes));
  return new Request('https://worker.example/webhooks/shopify/orders', {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  });
}

async function webhookHmac(bytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes)));
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function sha256Hex(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function hexToArrayBuffer(hex) {
  return Uint8Array.from(hex.match(/../gu), (byte) => Number.parseInt(byte, 16)).buffer;
}
