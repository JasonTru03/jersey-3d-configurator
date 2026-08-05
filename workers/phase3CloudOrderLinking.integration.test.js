// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { jerseyProduct } from '../src/features/configurator/config/productDefinitions.js';
import { selectedOptions } from '../src/features/configurator/config/selectors.js';
import { createProductionPackage } from '../src/features/configurator/designs/productionPackage.js';
import { createProductionDraftsHandler } from './production/productionDrafts.js';
import { createAppProxyHandler } from './shopify/appProxy.js';
import { createCartQuotesHandler } from './shopify/cartQuotes.js';
import { createOrderLifecycleWebhooksHandler } from './shopify/orderLifecycleWebhooks.js';
import { createWorkerHandler } from './router.js';

const SHOP = 'testcsj.myshopify.com';
const NOW = Date.parse('2026-08-04T00:00:00.000Z');
const ORDER_ID = '820982911946154508';
const ORDER_GID = `gid://shopify/Order/${ORDER_ID}`;
const JERSEY_VARIANT_ID = '48039101923479';
const QUOTE_SECRET = 'phase3-quote-secret-that-is-at-least-32-bytes';
const SHOPIFY_API_SECRET = 'phase3-shopify-secret-that-is-at-least-32-bytes';
const PRODUCTION_FILENAMES = [
  'design.json',
  'uv-atlas.png',
  'uv-pattern-pieces.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
  'manifest.json',
];

describe('phase 3 cloud order contract', () => {
  it('keeps one production design linked from upload through paid order and detects bundle corruption', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(await readFile(
        new URL('../migrations/0001_production_designs.sql', import.meta.url),
        'utf8',
      ));
      database.exec(await readFile(
        new URL('../migrations/0002_free_tier_streaming_upload.sql', import.meta.url),
        'utf8',
      ));
      const runtime = createContractRuntime(database);
      const state = structuredClone(jerseyProduct.defaultState);
      const artifact = await createBrowserProductionPackage(state);
      expect(artifact.files.map((file) => file.filename)).toEqual(PRODUCTION_FILENAMES);

      const sessionResponse = await runtime.worker(await uploadSessionRequest(artifact));
      const session = await sessionResponse.json();
      expect(sessionResponse.status, JSON.stringify(session)).toBe(201);
      const manifestResponse = await runtime.worker(uploadBodyRequest(
        session,
        'manifest',
        artifact.files[6].blob,
      ));
      expect(manifestResponse.status).toBe(204);
      const uploadResponse = await runtime.worker(uploadBodyRequest(
        session,
        'bundle',
        artifact.blob,
      ));
      const upload = await uploadResponse.json();
      expect(uploadResponse.status, JSON.stringify(upload)).toBe(201);
      expect(upload.designId).toMatch(/^dsg_[0-9a-f-]{36}$/u);
      expect(runtime.r2.objects).toHaveLength(2);

      runtime.clock.value = NOW + 100;
      const quoteResponse = await runtime.worker(jsonRequest('/api/cart-quotes', {
        designId: upload.designId,
        shop: SHOP,
        state,
      }));
      const quote = await quoteResponse.json();
      expect(quoteResponse.status, JSON.stringify(quote)).toBe(201);
      const storedQuote = JSON.parse(runtime.kv.values.get(upload.designId).value);
      expect(storedQuote.designId).toBe(upload.designId);
      expect(new URL(quote.handoffUrl).searchParams.get('token')).toBeTruthy();

      const proxyResponse = await runtime.worker(await signedAppProxyRequest(quote.handoffUrl));
      const cartItems = decodeCartItems(await proxyResponse.text());
      expect(proxyResponse.status).toBe(200);
      expect(cartItems).not.toHaveLength(0);
      expect(cartItems.every((item) => (
        item.properties._jersey_design_id === upload.designId
      ))).toBe(true);

      runtime.clock.value = NOW + 200;
      const firstPaidResponse = await runtime.worker(await signedPaidWebhook(cartItems, {
        eventId: '01J4PHASE3E2ECONTRACT0001',
        webhookId: '11111111-1111-4111-8111-111111111111',
      }));
      expect(firstPaidResponse.status).toBe(200);
      expect(readDesignRow(database, upload.designId)).toMatchObject({
        design_id: upload.designId,
        error_code: null,
        shopify_order_gid: ORDER_GID,
        shopify_order_name: '#1001',
        status: 'paid_pending_production',
      });

      const bundleKey = readDesignRow(database, upload.designId).bundle_key;
      const bundleBeforeCorruption = await runtime.r2.binding.head(bundleKey);
      await runtime.r2.corruptBodyAndNativeChecksum(bundleKey);
      const bundleAfterCorruption = await runtime.r2.binding.head(bundleKey);
      expect(bundleAfterCorruption.customMetadata.sha256)
        .toBe(bundleBeforeCorruption.customMetadata.sha256);
      expect(nativeSha256Hex(bundleAfterCorruption))
        .not.toBe(nativeSha256Hex(bundleBeforeCorruption));
      runtime.clock.value = NOW + 300;
      const corruptPaidResponse = await runtime.worker(await signedPaidWebhook(cartItems, {
        eventId: '01J4PHASE3E2ECONTRACT0002',
        webhookId: '22222222-2222-4222-8222-222222222222',
      }));
      expect(corruptPaidResponse.status).toBe(200);
      expect(readDesignRow(database, upload.designId)).toMatchObject({
        design_id: upload.designId,
        error_code: 'ORDER_FILE_ERROR',
        shopify_order_gid: ORDER_GID,
        status: 'file_error',
      });
    } finally {
      database.close();
    }
  }, 30_000);
});

function createContractRuntime(database) {
  const clock = { value: NOW };
  const r2 = createMemoryR2();
  const kv = createMemoryKv();
  const databaseBinding = createD1Adapter(database);
  const successfulRateLimit = { limit: async () => ({ success: true }) };
  const storeConfig = {
    productId: jerseyProduct.id,
    currency: jerseyProduct.currency,
    jerseyVariants: {
      s: '48039101890711',
      m: JERSEY_VARIANT_ID,
      l: '48039101956247',
      xl: '48039101989015',
    },
    surchargeVariants: {},
  };
  const env = {
    CART_HANDOFF_RATE_LIMIT: successfulRateLimit,
    CART_QUOTE_RATE_LIMIT: successfulRateLimit,
    CART_QUOTE_SIGNING_SECRET: QUOTE_SECRET,
    DESIGN_QUOTES: kv.binding,
    LOCAL_PRODUCTION_FILES: 'false',
    PRODUCTION_ASSETS: r2.binding,
    PRODUCTION_DB: databaseBinding,
    PRODUCTION_UPLOAD_RATE_LIMIT: successfulRateLimit,
    SHOPIFY_API_SECRET,
    SHOPIFY_STORE_CONFIG_JSON: JSON.stringify({ [SHOP]: storeConfig }),
    TURNSTILE_SECRET_KEY: 'phase3-turnstile-secret',
    TURNSTILE_SITE_KEY: 'phase3-turnstile-site-key',
  };
  const uuids = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ];
  const now = () => clock.value;
  const productionDraftsHandler = createProductionDraftsHandler(env, {
    fetchImpl: async () => Response.json({ action: 'production_draft', success: true }),
    now,
    randomUUID: () => {
      const uuid = uuids.shift();
      if (!uuid) throw new Error('Unexpected UUID request.');
      return uuid;
    },
  });
  const cartQuotesHandler = createCartQuotesHandler(env, {
    now,
    randomBytes: () => new Uint8Array(24).fill(7),
  });
  const appProxyHandler = createAppProxyHandler(env, { now });
  const orderLifecycleWebhooksHandler = createOrderLifecycleWebhooksHandler(env, { now });
  const worker = createWorkerHandler(env, {
    appProxyHandler,
    cartQuotesHandler,
    designAssetsHandler: () => new Response('Not found.', { status: 404 }),
    orderLifecycleWebhooksHandler,
    productionDraftsHandler,
  });
  return { clock, env, kv, r2, worker };
}

async function createBrowserProductionPackage(state) {
  return createProductionPackage({
    artifactProvider: async () => renderedArtifacts(),
    generatedAt: '2026-08-04T00:00:00.000Z',
    product: jerseyProduct,
    selected: selectedOptions(jerseyProduct, state),
    state,
    variantId: JERSEY_VARIANT_ID,
  }, {
    createReferencePdf: async () => ({
      blob: new Blob(['%PDF-1.7\n%%EOF'], { type: 'application/pdf' }),
      pageCount: 2,
      pageSize: { heightMm: 210, widthMm: 297 },
    }),
  });
}

function renderedArtifacts() {
  return {
    atlas: renderedPng('atlas', 4096, 4096),
    legacyBakeMetadata: null,
    pieces: {
      ...renderedPng('pieces', 4096, 4096),
      layoutFingerprint: 'uv-pieces-v1-phase3-e2e',
      outputTransform: { mirrorX: true, rotation: 180 },
      pieces: [pieceMetadata(), pieceMetadata({
        id: 'back',
        label: 'Back',
        meshName: 'Cloth_mesh_4',
        order: 1,
        outputBounds: { height: 3600, width: 1600, x: 2200, y: 192 },
        sourceBounds: { height: 2400, width: 1067, x: 1200, y: 200 },
      })],
    },
    previews: {
      back: renderedPng('back', 1600, 1600),
      front: renderedPng('front', 1600, 1600),
    },
  };
}

function renderedPng(id, width, height) {
  return {
    blob: minimalPng(width, height),
    canvas: { height, id, width },
    colorSpace: 'sRGB',
    height,
    width,
  };
}

function minimalPng(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: 'image/png' });
}

function pieceMetadata({
  id = 'front',
  label = 'Front',
  meshName = 'Cloth_mesh_7',
  order = 0,
  outputBounds = { height: 3600, width: 1600, x: 192, y: 192 },
  sourceBounds = { height: 2400, width: 1067, x: 100, y: 200 },
} = {}) {
  return {
    aliases: [],
    coveragePixels: 840000,
    duplicateGroup: null,
    id,
    islandRefs: [{ meshName }],
    label,
    mappedTriangles: 128,
    mirrorX: false,
    order,
    outputBounds,
    rotation: 0,
    scale: 1.5,
    sourceBounds,
    sourceMeshes: [meshName],
    zone: id,
  };
}

async function uploadSessionRequest(artifact) {
  const manifest = artifact.files[6].blob;
  const body = JSON.stringify({
    shop: SHOP,
    uploadId: 'upl_phase3e2econtract01',
    turnstileToken: 'verified-turnstile-token',
    design: {
      designFingerprint: artifact.manifest.designFingerprint,
      productId: artifact.manifest.productId,
      variantId: artifact.manifest.variantId,
      size: artifact.manifest.size,
      modelId: artifact.manifest.model.id,
      modelVersion: artifact.manifest.model.version,
      uvExportVersion: artifact.manifest.uvExportVersion,
    },
    manifest: { byteLength: manifest.size, sha256: await sha256Blob(manifest) },
    bundle: {
      filename: artifact.filename,
      byteLength: artifact.blob.size,
      sha256: await sha256Blob(artifact.blob),
    },
  });
  const request = new Request('https://worker.example/api/production-drafts', {
    body,
    headers: {
      'CF-Connecting-IP': '203.0.113.42',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  request.headers.set('Content-Length', String(new TextEncoder().encode(body).byteLength));
  return request;
}

function uploadBodyRequest(session, kind, blob) {
  const request = new Request(
    `https://worker.example/api/production-drafts/${session.designId}/${kind}`,
    {
      body: blob,
      headers: {
        'Content-Type': kind === 'manifest' ? 'application/json' : 'application/zip',
        'X-Production-Shop': SHOP,
        'X-Production-Upload-Id': 'upl_phase3e2econtract01',
        'X-Production-Upload-Token': session.uploadToken,
      },
      method: 'PUT',
    },
  );
  request.headers.set('Content-Length', String(blob.size));
  return request;
}

function jsonRequest(pathname, body) {
  return new Request(`https://worker.example${pathname}`, {
    body: JSON.stringify(body),
    headers: {
      'CF-Connecting-IP': '203.0.113.42',
      'Content-Type': 'application/json; charset=utf-8',
    },
    method: 'POST',
  });
}

async function signedAppProxyRequest(handoffUrl) {
  const token = new URL(handoffUrl).searchParams.get('token');
  const parameters = [
    ['shop', SHOP],
    ['timestamp', String(Math.floor(NOW / 1000))],
    ['path_prefix', '/apps/jersey-configurator'],
    ['logged_in_customer_id', ''],
    ['token', token],
  ];
  const message = [...parameters]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('');
  const signature = await hexHmac(message, SHOPIFY_API_SECRET);
  const url = new URL('https://worker.example/apps/jersey-configurator/cart-handoff');
  for (const [key, value] of parameters) url.searchParams.append(key, value);
  url.searchParams.set('signature', signature);
  return new Request(url);
}

function decodeCartItems(html) {
  const encoded = /<script type="application\/json" id="cart-payload">([A-Za-z0-9_-]+)<\/script>/u
    .exec(html)?.[1];
  if (!encoded) throw new Error('App Proxy response has no cart payload.');
  const base64 = encoded.replace(/-/gu, '+').replace(/_/gu, '/')
    + '='.repeat((4 - encoded.length % 4) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)).items;
}

async function signedPaidWebhook(cartItems, { eventId, webhookId }) {
  const base = cartItems.find((item) => item.properties._jersey_component === 'base');
  const compactComponents = cartItems.map((item) => [
    item.properties._jersey_component === 'base' ? 'b' : 's',
    item.id,
    item.quantity,
  ]);
  const mergedProperties = {
    ...base.properties,
    _jersey_components: JSON.stringify(compactComponents),
  };
  delete mergedProperties._jersey_component;
  const payload = {
    id: '__ORDER_ID__',
    admin_graphql_api_id: ORDER_GID,
    line_items: [{
      id: 487817672276298554,
      properties: Object.entries(mergedProperties).map(([name, value]) => ({ name, value })),
      quantity: 1,
      variant_id: Number(base.id),
    }],
    name: '#1001',
    processed_at: new Date(NOW).toISOString(),
  };
  const text = JSON.stringify(payload).replace('"__ORDER_ID__"', ORDER_ID);
  const bytes = new TextEncoder().encode(text);
  return new Request('https://worker.example/webhooks/shopify/orders', {
    body: bytes,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Event-Id': eventId,
      'X-Shopify-Hmac-Sha256': await base64Hmac(bytes, SHOPIFY_API_SECRET),
      'X-Shopify-Shop-Domain': SHOP,
      'X-Shopify-Topic': 'orders/paid',
      'X-Shopify-Webhook-Id': webhookId,
    },
    method: 'POST',
  });
}

async function hexHmac(value, secret) {
  const signature = await hmac(new TextEncoder().encode(value), secret);
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function base64Hmac(value, secret) {
  const signature = await hmac(value, secret);
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, value));
}

function createMemoryKv() {
  const values = new Map();
  return {
    binding: {
      get: async (key) => values.get(key)?.value ?? null,
      put: async (key, value, options) => { values.set(key, { options, value }); },
    },
    values,
  };
}

function createMemoryR2() {
  const objects = new Map();
  return {
    binding: {
      delete: async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
      },
      get: async (key) => {
        const stored = objects.get(key);
        if (!stored) return null;
        return {
          ...objectHead(stored),
          arrayBuffer: async () => stored.bytes.slice().buffer,
        };
      },
      head: async (key) => {
        const stored = objects.get(key);
        return stored ? objectHead(stored) : null;
      },
      put: async (key, value, options = {}) => {
        const bytes = await readBodyBytes(value);
        const digest = await sha256Hex(bytes);
        if (options.sha256 !== undefined && options.sha256 !== digest) {
          throw new Error('R2 native checksum does not match the uploaded body.');
        }
        objects.set(key, {
          bytes,
          customMetadata: { ...(options.customMetadata ?? {}) },
          httpMetadata: { ...(options.httpMetadata ?? {}) },
          key,
          nativeSha256: options.sha256 ?? null,
        });
        return { key, size: bytes.byteLength };
      },
    },
    corruptBodyAndNativeChecksum: async (key) => {
      const stored = objects.get(key);
      if (!stored) throw new Error('Bundle object is missing.');
      stored.bytes = stored.bytes.slice();
      stored.bytes[0] ^= 0xff;
      stored.nativeSha256 = await sha256Hex(stored.bytes);
    },
    get objects() { return [...objects.values()]; },
  };
}

function objectHead(stored) {
  return {
    checksums: stored.nativeSha256
      ? { sha256: hexToArrayBuffer(stored.nativeSha256) }
      : {},
    customMetadata: { ...stored.customMetadata },
    httpMetadata: { ...stored.httpMetadata },
    key: stored.key,
    size: stored.bytes.byteLength,
  };
}

function nativeSha256Hex(head) {
  return [...new Uint8Array(head.checksums.sha256)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readBodyBytes(value) {
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ReadableStream) {
    return new Uint8Array(await new Response(value).arrayBuffer());
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw new TypeError('Unsupported R2 body.');
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Blob(blob) {
  return sha256Hex(new Uint8Array(await blob.arrayBuffer()));
}

function hexToArrayBuffer(value) {
  return Uint8Array.from(value.match(/../gu), (byte) => Number.parseInt(byte, 16)).buffer;
}

function createD1Adapter(database) {
  return {
    prepare: (sql) => new D1StatementAdapter(database, sql),
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => statement.executeBatch());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

class D1StatementAdapter {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    return d1Result({ results: this.database.prepare(this.sql).all(...this.values) });
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values) ?? null;
    return column === undefined ? row : row?.[column] ?? null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return d1Result({ changes: Number(result.changes) });
  }

  executeBatch() {
    if (isWriteSql(this.sql)) {
      const result = this.database.prepare(this.sql).run(...this.values);
      return d1Result({ changes: Number(result.changes) });
    }
    return d1Result({ results: this.database.prepare(this.sql).all(...this.values) });
  }
}

function isWriteSql(sql) {
  return /^\s*(?:INSERT|UPDATE|DELETE)\b/iu.test(sql)
    || /\bUPDATE\s+production_designs\b/iu.test(sql)
    || /\bINSERT\s+OR\s+IGNORE\s+INTO\s+shopify_webhook_deliveries\b/iu.test(sql);
}

function d1Result({ changes = 0, results = [] } = {}) {
  return { meta: { changes }, results, success: true };
}

function readDesignRow(database, designId) {
  return database.prepare(`
    SELECT design_id, bundle_key, error_code, shopify_order_gid,
      shopify_order_name, status
    FROM production_designs
    WHERE design_id = ?
  `).get(designId);
}
