import { createProductionRepository } from '../production/productionRepository.js';
import {
  MAX_PRODUCTION_PACKAGE_BYTES,
  PRODUCTION_PACKAGE_FILE_CONTRACT,
} from '../../src/features/configurator/designs/productionManifest.js';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_DESIGNS = 250;
const MAX_LINES = 1000;
const MANIFEST_MAX_BYTES = PRODUCTION_PACKAGE_FILE_CONTRACT.at(-1).maxBytes;
const BUNDLE_MAX_BYTES = MAX_PRODUCTION_PACKAGE_BYTES + 64 * 1024;
const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const BUNDLE_ID_PATTERN = /^bun_[A-Za-z0-9_-]{16,64}$/u;
const VARIANT_ID_PATTERN = /^[1-9][0-9]{0,31}$/u;
const WEBHOOK_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const ORDER_GID_PATTERN = /^gid:\/\/shopify\/Order\/([1-9][0-9]{0,31})$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
const HMAC_PATTERN = /^[A-Za-z0-9+/]{43}=$/u;
const TOPICS = new Set(['orders/paid', 'orders/cancelled', 'refunds/create']);
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

class WebhookError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

class InfrastructureError extends Error {}

export function createOrderLifecycleWebhooksHandler(env, dependencies = {}) {
  const createRepository = dependencies.createProductionRepository ?? createProductionRepository;
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? console;

  return async function handleOrderLifecycleWebhook(request) {
    if (request.method !== 'POST') {
      return errorResponse(405, 'Method must be POST.', { Allow: 'POST' });
    }

    try {
      const bindings = validateBindings(env, createRepository);
      const headers = validateHeaders(request.headers);
      const rawBody = await readRawBody(request);
      await authenticateRawBody(rawBody, headers.hmac, bindings.secret);
      const payload = parsePayload(rawBody);
      const order = parseOrder(payload, headers.topic);
      const groups = headers.topic === 'orders/paid'
        ? collectPaidJerseyGroups(order.lines)
        : collectTerminalDesigns(order.lines);
      const receivedAt = readNow(now);
      const repository = bindings.repository;
      const delivery = {
        webhookId: headers.webhookId,
        eventId: headers.eventId,
        shop: headers.shop,
        topic: headers.topic,
        orderGid: order.orderGid,
        receivedAt,
      };

      if (await isDuplicate(repository, delivery)) return successResponse();
      if (groups.length === 0) return successResponse();

      const lifecycle = headers.topic === 'orders/paid'
        ? await createPaidLifecycle({
          assets: bindings.assets,
          groups,
          order,
          receivedAt,
          repository,
          shop: headers.shop,
        })
        : createTerminalLifecycle(groups, headers.topic, receivedAt);

      try {
        await repository.recordOrderLifecycle({
          delivery,
          designs: lifecycle.designs,
          status: lifecycle.status,
        });
      } catch (error) {
        if (error?.code === 'production-repository-conflict'
          && await isDuplicate(repository, delivery)) return successResponse();
        if (error?.code === 'production-repository-conflict') {
          throw new WebhookError(409, 'ORDER_LIFECYCLE_CONFLICT');
        }
        throw new InfrastructureError();
      }
      return successResponse();
    } catch (error) {
      if (error instanceof WebhookError) return errorResponse(error.status, responseMessage(error.status));
      logger.error?.('SHOPIFY_ORDER_WEBHOOK_FAILED');
      return errorResponse(503, 'Order lifecycle processing is temporarily unavailable.');
    }
  };
}

function validateBindings(env, createRepository) {
  if (!env || typeof env !== 'object') throw new InfrastructureError();
  if (typeof env.SHOPIFY_API_SECRET !== 'string'
    || encoder.encode(env.SHOPIFY_API_SECRET).length < 16) throw new InfrastructureError();
  if (!env.PRODUCTION_DB
    || typeof env.PRODUCTION_DB.prepare !== 'function'
    || typeof env.PRODUCTION_DB.batch !== 'function') throw new InfrastructureError();
  if (!env.PRODUCTION_ASSETS
    || typeof env.PRODUCTION_ASSETS.head !== 'function'
    || typeof env.PRODUCTION_ASSETS.get !== 'function') throw new InfrastructureError();
  let repository;
  try {
    repository = createRepository(env.PRODUCTION_DB);
  } catch {
    throw new InfrastructureError();
  }
  for (const method of [
    'hasWebhookDelivery', 'hasWebhookEvent', 'getDesign', 'recordOrderLifecycle',
  ]) {
    if (typeof repository?.[method] !== 'function') throw new InfrastructureError();
  }
  return { assets: env.PRODUCTION_ASSETS, repository, secret: env.SHOPIFY_API_SECRET };
}

function validateHeaders(headers) {
  const hmac = headers.get('X-Shopify-Hmac-Sha256');
  const shop = headers.get('X-Shopify-Shop-Domain');
  const topic = headers.get('X-Shopify-Topic');
  const webhookId = headers.get('X-Shopify-Webhook-Id');
  const eventId = headers.get('X-Shopify-Event-Id');
  const contentType = headers.get('Content-Type');
  const contentLength = headers.get('Content-Length');
  if (!SHOP_PATTERN.test(shop ?? '')
    || !TOPICS.has(topic)
    || !WEBHOOK_ID_PATTERN.test(webhookId ?? '')
    || (eventId !== null && !EVENT_ID_PATTERN.test(eventId))
    || !CONTENT_TYPE_PATTERN.test(contentType ?? '')) {
    throw new WebhookError(400, 'WEBHOOK_HEADERS_INVALID');
  }
  if (hmac === null) throw new WebhookError(401, 'WEBHOOK_HMAC_INVALID');
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]{0,15})$/u.test(contentLength)) {
      throw new WebhookError(400, 'WEBHOOK_CONTENT_LENGTH_INVALID');
    }
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length)) throw new WebhookError(400, 'WEBHOOK_CONTENT_LENGTH_INVALID');
    if (length > MAX_BODY_BYTES) throw new WebhookError(413, 'WEBHOOK_BODY_TOO_LARGE');
  }
  return { contentLength, eventId, hmac, shop, topic, webhookId };
}

async function readRawBody(request) {
  if (!request.body || typeof request.body.getReader !== 'function') {
    throw new WebhookError(400, 'WEBHOOK_BODY_INVALID');
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = toUint8Array(value);
      if (!chunk) throw new WebhookError(400, 'WEBHOOK_BODY_INVALID');
      total += chunk.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new WebhookError(413, 'WEBHOOK_BODY_TOO_LARGE');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof WebhookError) throw error;
    throw new WebhookError(400, 'WEBHOOK_BODY_INVALID');
  }
  const declared = request.headers.get('Content-Length');
  if (declared !== null && Number(declared) !== total) {
    throw new WebhookError(400, 'WEBHOOK_CONTENT_LENGTH_INVALID');
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function authenticateRawBody(rawBody, providedValue, secret) {
  const provided = decodeBase64Signature(providedValue);
  let expected;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody));
  } catch {
    throw new InfrastructureError();
  }
  if (!provided || !constantTimeEqual(expected, provided)) {
    throw new WebhookError(401, 'WEBHOOK_HMAC_INVALID');
  }
}

function decodeBase64Signature(value) {
  if (!HMAC_PATTERN.test(value)) return null;
  try {
    const binary = atob(value);
    if (binary.length !== 32) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(first, second) {
  if (first.byteLength !== second.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < first.byteLength; index += 1) {
    difference |= first[index] ^ second[index];
  }
  return difference === 0;
}

function parsePayload(rawBody) {
  let text;
  let value;
  try {
    text = fatalDecoder.decode(rawBody);
    JSON.parse(text);
    value = JSON.parse(preserveUnsafeJsonIntegers(text));
  } catch {
    throw new WebhookError(400, 'WEBHOOK_JSON_INVALID');
  }
  if (!isPlainObject(value)) throw new WebhookError(400, 'WEBHOOK_JSON_INVALID');
  return value;
}

function preserveUnsafeJsonIntegers(text) {
  let result = '';
  let index = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
  while (index < text.length) {
    if (text[index] === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      result += text.slice(start, index);
      continue;
    }
    if (text[index] === '-' || /[0-9]/u.test(text[index])) {
      numberPattern.lastIndex = index;
      const token = numberPattern.exec(text)?.[0] ?? null;
      if (token) {
        result += isUnsafeIntegerToken(token) ? JSON.stringify(token) : token;
        index += token.length;
        continue;
      }
    }
    result += text[index];
    index += 1;
  }
  return result;
}

function isUnsafeIntegerToken(value) {
  if (/[.eE]/u.test(value)) return false;
  try {
    const number = BigInt(value);
    return number > MAX_SAFE_INTEGER_BIGINT || number < MIN_SAFE_INTEGER_BIGINT;
  } catch {
    return false;
  }
}

function parseOrder(payload, topic) {
  if (topic === 'refunds/create') {
    const orderId = readDecimalId(payload.order_id);
    const refundLines = readArray(payload.refund_line_items, MAX_LINES);
    if (!orderId || !refundLines) throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
    const lines = refundLines.map((entry) => {
      if (!isPlainObject(entry) || !isPlainObject(entry.line_item)) {
        throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
      }
      return entry.line_item;
    });
    return { lines, orderGid: `gid://shopify/Order/${orderId}`, orderName: null, paidAt: null };
  }

  const match = ORDER_GID_PATTERN.exec(payload.admin_graphql_api_id ?? '');
  const lines = readArray(payload.line_items, MAX_LINES);
  if (!match || !lines) throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
  const orderId = readDecimalId(payload.id);
  if (orderId && orderId !== match[1]) throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
  if (topic === 'orders/cancelled') {
    return { lines, orderGid: payload.admin_graphql_api_id, orderName: null, paidAt: null };
  }
  const orderName = readOrderName(payload.name);
  const paidAt = readIsoTimestamp(payload.processed_at);
  if (!orderName || paidAt === null) throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
  return { lines, orderGid: payload.admin_graphql_api_id, orderName, paidAt };
}

function collectPaidJerseyGroups(lines) {
  const groups = new Map();
  for (const line of lines) {
    if (!isPlainObject(line)) throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
    const properties = readLineProperties(line.properties);
    const designId = properties.get('_jersey_design_id');
    if (designId === undefined) continue;
    const bundleId = properties.get('_jersey_bundle_id');
    const component = properties.get('_jersey_component');
    const componentsJson = properties.get('_jersey_components');
    if (!DESIGN_ID_PATTERN.test(designId)
      || !BUNDLE_ID_PATTERN.test(bundleId ?? '')
      || (component === undefined) === (componentsJson === undefined)) {
      throw new WebhookError(422, 'ORDER_LINE_INVALID');
    }
    let evidence;
    if (component !== undefined) {
      if (component !== 'base' && component !== 'surcharge') {
        throw new WebhookError(422, 'ORDER_LINE_INVALID');
      }
      evidence = { mode: 'raw', component, variantId: readLineVariantId(line) };
    } else {
      const baseVariantId = parseMergedComponents(componentsJson);
      if (readLineVariantId(line) !== baseVariantId) {
        throw new WebhookError(422, 'ORDER_LINE_INVALID');
      }
      evidence = { mode: 'merged', baseVariantId };
    }
    const existing = groups.get(designId);
    if (existing && (existing.bundleId !== bundleId || existing.mode !== evidence.mode)) {
      throw new WebhookError(422, 'ORDER_LINE_INVALID');
    }
    const group = existing ?? { designId, bundleId, mode: evidence.mode, lines: [] };
    group.lines.push(evidence);
    groups.set(designId, group);
  }
  if (groups.size > MAX_DESIGNS) throw new WebhookError(422, 'ORDER_LINE_INVALID');
  const result = [...groups.values()];
  if (result.some((group) => group.mode === 'merged' && group.lines.length !== 1)) {
    throw new WebhookError(422, 'ORDER_LINE_INVALID');
  }
  return result;
}

function collectTerminalDesigns(lines) {
  const designIds = new Set();
  for (const line of lines) {
    if (!isPlainObject(line)) throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
    const designId = readTerminalDesignId(line.properties);
    if (designId === null) continue;
    if (!DESIGN_ID_PATTERN.test(designId)) throw new WebhookError(422, 'ORDER_LINE_INVALID');
    designIds.add(designId);
  }
  if (designIds.size > MAX_DESIGNS) throw new WebhookError(422, 'ORDER_LINE_INVALID');
  return [...designIds].map((designId) => ({ designId }));
}

function readTerminalDesignId(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length > 100) {
    throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
  }
  let designId = null;
  for (const property of value) {
    if (!isPlainObject(property)
      || typeof property.name !== 'string') {
      throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
    }
    if (property.name !== '_jersey_design_id') continue;
    if (typeof property.value !== 'string') throw new WebhookError(422, 'ORDER_LINE_INVALID');
    if (designId !== null) throw new WebhookError(422, 'ORDER_LINE_INVALID');
    designId = property.value;
  }
  return designId;
}

function readLineProperties(value) {
  if (value === null || value === undefined) return new Map();
  if (!Array.isArray(value) || value.length > 100) {
    throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
  }
  const relevant = new Map();
  for (const property of value) {
    if (!isPlainObject(property)
      || typeof property.name !== 'string'
      || typeof property.value !== 'string') {
      throw new WebhookError(400, 'WEBHOOK_PAYLOAD_INVALID');
    }
    if (![
      '_jersey_design_id', '_jersey_bundle_id', '_jersey_component', '_jersey_components',
    ].includes(property.name)) {
      continue;
    }
    if (relevant.has(property.name)) throw new WebhookError(422, 'ORDER_LINE_INVALID');
    relevant.set(property.name, property.value);
  }
  return relevant;
}

function parseMergedComponents(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new WebhookError(422, 'ORDER_LINE_INVALID');
  }
  if (!Array.isArray(parsed)
    || parsed.length === 0
    || parsed.length > 32
    || JSON.stringify(parsed) !== value) {
    throw new WebhookError(422, 'ORDER_LINE_INVALID');
  }
  let baseVariantId = null;
  const variantIds = new Set();
  let previousSurchargeId = null;
  for (let index = 0; index < parsed.length; index += 1) {
    const component = parsed[index];
    if (!Array.isArray(component)
      || component.length !== 3
      || (component[0] !== 'b' && component[0] !== 's')
      || typeof component[1] !== 'string'
      || !isCanonicalUint64(component[1])
      || !Number.isSafeInteger(component[2])
      || component[2] <= 0) {
      throw new WebhookError(422, 'ORDER_LINE_INVALID');
    }
    if (variantIds.has(component[1])) throw new WebhookError(422, 'ORDER_LINE_INVALID');
    variantIds.add(component[1]);
    if (component[0] === 'b') {
      if (index !== 0 || baseVariantId !== null) throw new WebhookError(422, 'ORDER_LINE_INVALID');
      baseVariantId = component[1];
    } else {
      if (baseVariantId === null
        || (previousSurchargeId !== null
          && compareCanonicalIds(previousSurchargeId, component[1]) >= 0)) {
        throw new WebhookError(422, 'ORDER_LINE_INVALID');
      }
      previousSurchargeId = component[1];
    }
  }
  if (baseVariantId === null) throw new WebhookError(422, 'ORDER_LINE_INVALID');
  return baseVariantId;
}

function readLineVariantId(line) {
  const variantId = readDecimalId(line.variant_id);
  if (!variantId || !isCanonicalUint64(variantId)) {
    throw new WebhookError(422, 'ORDER_LINE_INVALID');
  }
  return variantId;
}

async function createPaidLifecycle({ assets, groups, order, receivedAt, repository, shop }) {
  let drafts;
  try {
    drafts = await Promise.all(groups.map((group) => repository.getDesign(shop, group.designId)));
  } catch {
    throw new InfrastructureError();
  }
  groups.forEach((group, index) => assertPaidGroup(group, drafts[index], shop, order.orderGid));

  let fileChecks;
  try {
    fileChecks = await Promise.all(drafts.map((draft) => verifyProductionFiles(assets, draft)));
  } catch (error) {
    if (error instanceof InfrastructureError) throw error;
    throw new InfrastructureError();
  }
  // The repository records one status and one receipt atomically. If any design is
  // incomplete, conservatively hold the entire order in file_error so no partial
  // order can be presented to production as ready.
  const filesReady = fileChecks.every(Boolean);
  const status = filesReady ? 'paid_pending_production' : 'file_error';
  const updatedAt = Math.max(receivedAt, order.paidAt);
  return {
    status,
    designs: groups.map((group) => ({
      designId: group.designId,
      bundleId: group.bundleId,
      orderName: order.orderName,
      paidAt: order.paidAt,
      updatedAt,
      errorCode: filesReady ? null : 'ORDER_FILE_ERROR',
    })),
  };
}

function assertPaidGroup(group, draft, shop, orderGid) {
  const baseLines = group.mode === 'raw'
    ? group.lines.filter((line) => line.component === 'base')
    : group.lines;
  const baseVariantId = group.mode === 'raw'
    ? baseLines[0]?.variantId
    : baseLines[0]?.baseVariantId;
  if (!isPlainObject(draft)
    || draft.shop !== shop
    || draft.designId !== group.designId
    || draft.bundleId !== group.bundleId
    || !['cart_draft', 'paid_pending_production', 'file_error'].includes(draft.status)
    || (draft.shopifyOrderGid !== null
      && draft.shopifyOrderGid !== undefined
      && draft.shopifyOrderGid !== orderGid)
    || !isCanonicalUint64(draft.variantId ?? '')
    || baseLines.length !== 1
    || baseVariantId !== draft.variantId) {
    throw new WebhookError(422, 'ORDER_LINE_INVALID');
  }
}

function createTerminalLifecycle(groups, topic, receivedAt) {
  return {
    status: topic === 'orders/cancelled' ? 'cancelled' : 'refunded',
    designs: groups.map((group) => ({ designId: group.designId, updatedAt: receivedAt })),
  };
}

async function verifyProductionFiles(assets, draft) {
  let manifestHead;
  let bundleHead;
  try {
    [manifestHead, bundleHead] = await Promise.all([
      assets.head(draft.manifestKey),
      assets.head(draft.bundleKey),
    ]);
  } catch {
    throw new InfrastructureError();
  }
  if (!validateObjectHead(manifestHead, {
    contentType: 'application/json',
    draft,
    expectedHash: draft.manifestSha256,
    expectedKey: draft.manifestKey,
    maximumSize: MANIFEST_MAX_BYTES,
  }) || !validateObjectHead(bundleHead, {
    contentType: 'application/zip',
    draft,
    expectedKey: draft.bundleKey,
    maximumSize: BUNDLE_MAX_BYTES,
    requireContentLength: true,
    requireNativeChecksum: true,
  }) || !hasExpectedObjectKeys(draft)) return false;

  let manifestObject;
  try {
    manifestObject = await assets.get(draft.manifestKey);
  } catch {
    throw new InfrastructureError();
  }
  if (!manifestObject || typeof manifestObject.arrayBuffer !== 'function') return false;
  let buffer;
  try {
    buffer = await manifestObject.arrayBuffer();
  } catch {
    throw new InfrastructureError();
  }
  if (!isArrayBuffer(buffer) || buffer.byteLength !== manifestHead.size) return false;
  return await sha256Hex(buffer) === draft.manifestSha256;
}

function validateObjectHead(value, {
  contentType,
  draft,
  expectedHash,
  expectedKey,
  maximumSize,
  requireContentLength = false,
  requireNativeChecksum = false,
}) {
  const head = readBindingProperties(value, [
    'key', 'size', 'httpMetadata', 'customMetadata', 'checksums',
  ]);
  if (!head
    || head.key !== expectedKey
    || !Number.isSafeInteger(head.size)
    || head.size <= 0
    || head.size > maximumSize) return false;
  const http = readBindingProperties(head.httpMetadata, ['contentType']);
  const metadata = readBindingProperties(head.customMetadata, [
    'designFingerprint', 'productId', 'variantId', 'size', 'sha256',
    ...(requireContentLength ? ['contentLength'] : []),
  ]);
  const nativeChecksum = requireNativeChecksum
    ? bytesToHex(readBindingProperties(head.checksums, ['sha256'])?.sha256)
    : null;
  return http?.contentType === contentType
    && metadata?.designFingerprint === draft.designFingerprint
    && metadata.productId === draft.productId
    && metadata.variantId === draft.variantId
    && metadata.size === draft.size
    && SHA256_PATTERN.test(metadata.sha256 ?? '')
    && (expectedHash === undefined || metadata.sha256 === expectedHash)
    && (!requireNativeChecksum || nativeChecksum === metadata.sha256)
    && (!requireContentLength || metadata.contentLength === String(head.size));
}

function hasExpectedObjectKeys(draft) {
  const manifestSuffix = '/manifest.json';
  const bundleSuffix = `/${draft.bundleFilename}`;
  return typeof draft.manifestKey === 'string'
    && typeof draft.bundleKey === 'string'
    && typeof draft.bundleFilename === 'string'
    && draft.manifestKey.endsWith(manifestSuffix)
    && draft.bundleKey.endsWith(bundleSuffix)
    && draft.manifestKey.slice(0, -manifestSuffix.length)
      === draft.bundleKey.slice(0, -bundleSuffix.length);
}

async function isDuplicate(repository, delivery) {
  try {
    if (await repository.hasWebhookDelivery({
      shop: delivery.shop,
      webhookId: delivery.webhookId,
    })) return true;
    return delivery.eventId !== null && await repository.hasWebhookEvent({
      shop: delivery.shop,
      topic: delivery.topic,
      eventId: delivery.eventId,
    });
  } catch {
    throw new InfrastructureError();
  }
}

function readArray(value, maximumLength) {
  return Array.isArray(value) && value.length <= maximumLength ? [...value] : null;
}

function readDecimalId(value) {
  if (typeof value === 'string' && /^[1-9][0-9]{0,31}$/u.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function isCanonicalUint64(value) {
  if (!VARIANT_ID_PATTERN.test(value)) return false;
  try {
    return BigInt(value) <= 18_446_744_073_709_551_615n;
  } catch {
    return false;
  }
}

function compareCanonicalIds(first, second) {
  if (first.length !== second.length) return first.length - second.length;
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

function readOrderName(value) {
  return typeof value === 'string'
    && value.length > 0
    && [...value].length <= 128
    && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null;
}

function readIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const timestamp = Date.parse(value);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

function readNow(now) {
  let value;
  try {
    value = now();
  } catch {
    throw new InfrastructureError();
  }
  if (!Number.isSafeInteger(value) || value <= 0) throw new InfrastructureError();
  return value;
}

async function sha256Hex(value) {
  let digest;
  try {
    digest = await crypto.subtle.digest('SHA-256', value);
  } catch {
    throw new InfrastructureError();
  }
  return bytesToHex(digest);
}

function bytesToHex(value) {
  if (!isArrayBuffer(value) || value.byteLength !== 32) return null;
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isArrayBuffer(value) {
  try {
    return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
  } catch {
    return false;
  }
}

function toUint8Array(value) {
  try {
    if (Object.prototype.toString.call(value) !== '[object Uint8Array]') return null;
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } catch {
    return null;
  }
}

function readBindingProperties(value, keys) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
  const properties = {};
  try {
    for (const key of keys) properties[key] = value[key];
  } catch {
    return null;
  }
  return properties;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function responseMessage(status) {
  if (status === 401) return 'Webhook authentication failed.';
  if (status === 413) return 'Webhook body is too large.';
  if (status === 422) return 'Order lifecycle data is invalid.';
  if (status === 409) return 'Order lifecycle state conflicts with the stored design.';
  return 'Webhook request is invalid.';
}

function successResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: responseHeaders(),
  });
}

function errorResponse(status, error, extraHeaders = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...responseHeaders(), ...extraHeaders },
  });
}

function responseHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
}
