import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearAdminSessionCookie,
  createAdminSessionCookie,
  verifyAdminPassword,
  verifyAdminSessionCookie,
} from './adminAuth.js';

const ADMIN_PREFIX = '/admin';
const LOGIN_PATH = '/admin/api/login';
const LOGOUT_PATH = '/admin/api/logout';
const SESSION_PATH = '/admin/api/session';
const ORDERS_PATH = '/admin/api/orders';
const DOWNLOAD_PATH = /^\/admin\/api\/orders\/(dsg_[A-Za-z0-9_-]{16,64})\/download$/u;
const MAX_LOGIN_BODY_BYTES = 4096;
const BUNDLE_FILENAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}-design-[a-f0-9]{8}\.zip$/u;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const STATIC_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
const STATIC_ASSETS = new Map([
  ['/admin/', loadStatic('admin.html', 'text/html; charset=utf-8')],
  ['/admin/admin.css', loadStatic('admin.css', 'text/css; charset=utf-8')],
  ['/admin/admin.js', loadStatic('admin.js', 'text/javascript; charset=utf-8')],
]);

export function isAdminPath(pathname) {
  return pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
}

export function createAdminPortal({
  assets,
  config,
  loginRateLimit,
  now = Date.now,
  randomBytes,
  repository,
  logger = console,
}) {
  assertDependencies({ assets, config, loginRateLimit, now, repository });

  return async function handleAdminRequest(request) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
      if (!isAdminPath(pathname)) return jsonResponse(404, { error: '未找到页面。' });
      if (pathname === ADMIN_PREFIX) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
        return new Response(null, {
          status: 308,
          headers: { location: '/admin/', 'cache-control': 'no-store' },
        });
      }
      if (STATIC_ASSETS.has(pathname)) return serveStatic(request, pathname);
      if (pathname === LOGIN_PATH) return await handleLogin(request, {
        config,
        loginRateLimit,
        now,
        randomBytes,
      });
      if (pathname === LOGOUT_PATH) return handleLogout(request);
      if (pathname === SESSION_PATH) {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        const session = requireSession(request, config, now);
        return jsonResponse(200, { authenticated: true, shop: session.shop });
      }
      if (pathname === ORDERS_PATH) {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        requireSession(request, config, now);
        return jsonResponse(200, repository.listOrders(readListInput(url, config.adminShop)));
      }
      const download = DOWNLOAD_PATH.exec(pathname);
      if (download) {
        if (request.method !== 'GET') return methodNotAllowed('GET');
        requireSession(request, config, now);
        return await handleDownload({
          assets,
          designId: download[1],
          now,
          repository,
          shop: config.adminShop,
        });
      }
      return jsonResponse(404, { error: '未找到页面。' });
    } catch (error) {
      if (error instanceof AdminHttpError) return jsonResponse(error.status, { error: error.message });
      if (error instanceof TypeError) return jsonResponse(400, { error: '请求参数无效。' });
      logError(logger, error);
      return jsonResponse(500, { error: '后台服务暂时不可用。' });
    }
  };
}

async function handleLogin(request, { config, loginRateLimit, now, randomBytes }) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
  let limited;
  try {
    limited = await loginRateLimit.limit({ key: clientIp });
  } catch {
    throw new AdminHttpError(503, '登录验证暂时不可用。');
  }
  if (limited?.success !== true) {
    return jsonResponse(429, { error: '登录尝试过多，请五分钟后再试。' }, {
      'retry-after': '300',
    });
  }
  const { password } = await readLoginBody(request);
  if (!await verifyAdminPassword(password, config.adminPasswordHash)) {
    throw new AdminHttpError(401, '密码错误。');
  }
  const cookie = createAdminSessionCookie({
    now: readNow(now),
    randomBytes,
    secret: config.adminSessionSecret,
    shop: config.adminShop,
    ttlSeconds: SESSION_TTL_SECONDS,
  });
  return new Response(null, {
    status: 204,
    headers: securityHeaders({ 'set-cookie': cookie }),
  });
}

function handleLogout(request) {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  return new Response(null, {
    status: 204,
    headers: securityHeaders({ 'set-cookie': clearAdminSessionCookie() }),
  });
}

async function handleDownload({ assets, designId, now, repository, shop }) {
  const order = repository.getOrderFile({ shop, designId });
  if (!order) throw new AdminHttpError(404, '没有找到对应的已付款订单设计。');
  const downloadedAt = readNow(now);
  if (order.status === 'file_error') {
    repository.recordDownload({ shop, designId, downloadedAt, outcome: 'invalid' });
    throw new AdminHttpError(409, '该订单的生产文件状态异常，暂不允许下载。');
  }
  let object;
  try {
    object = await assets.get(order.bundleKey);
  } catch {
    throw new AdminHttpError(503, '生产 ZIP 暂时无法读取。');
  }
  if (!object) {
    repository.recordDownload({ shop, designId, downloadedAt, outcome: 'missing' });
    throw new AdminHttpError(409, '生产 ZIP 文件缺失，请检查服务器存储。');
  }
  if (!isValidBundleObject(object, order)) {
    repository.recordDownload({ shop, designId, downloadedAt, outcome: 'invalid' });
    throw new AdminHttpError(409, '生产 ZIP 文件校验异常，请检查服务器存储。');
  }
  repository.recordDownload({ shop, designId, downloadedAt, outcome: 'started' });
  return new Response(object.body, {
    status: 200,
    headers: securityHeaders({
      'content-disposition': `attachment; filename="${order.bundleFilename}"`,
      'content-length': String(order.bundleBytes),
      'content-type': 'application/zip',
    }),
  });
}

function requireSession(request, config, now) {
  const session = verifyAdminSessionCookie(request.headers.get('cookie'), {
    now: readNow(now),
    secret: config.adminSessionSecret,
    shop: config.adminShop,
  });
  if (!session) throw new AdminHttpError(401, '请先登录后台。');
  return session;
}

async function readLoginBody(request) {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    throw new AdminHttpError(415, '登录请求格式无效。');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > MAX_LOGIN_BODY_BYTES)) {
    throw new AdminHttpError(413, '登录请求过大。');
  }
  const bytes = await readLimitedBody(request.body, MAX_LOGIN_BODY_BYTES);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGIN_BODY_BYTES) {
    throw new AdminHttpError(413, '登录请求过大。');
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new AdminHttpError(400, '登录请求格式无效。');
  }
  if (!isPlainObject(value)
    || Reflect.ownKeys(value).length !== 1
    || typeof value.password !== 'string') {
    throw new AdminHttpError(400, '登录请求格式无效。');
  }
  return value;
}

async function readLimitedBody(body, maximum) {
  if (!(body instanceof ReadableStream)) throw new AdminHttpError(400, '登录请求格式无效。');
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      size += chunk.byteLength;
      if (size > maximum) {
        await reader.cancel().catch(() => {});
        throw new AdminHttpError(413, '登录请求过大。');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function readListInput(url, shop) {
  return {
    shop,
    query: url.searchParams.get('q') ?? '',
    status: url.searchParams.get('status') ?? '',
    from: readOptionalInteger(url.searchParams.get('from')),
    to: readOptionalInteger(url.searchParams.get('to')),
    page: readOptionalInteger(url.searchParams.get('page')) ?? 1,
    pageSize: 50,
  };
}

function readOptionalInteger(value) {
  if (value === null || value === '') return null;
  if (!/^[0-9]+$/u.test(value)) throw new TypeError('Admin query number is invalid.');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new TypeError('Admin query number is invalid.');
  return result;
}

function isValidBundleObject(object, order) {
  if (!BUNDLE_FILENAME_PATTERN.test(order.bundleFilename)
    || !Number.isSafeInteger(order.bundleBytes)
    || order.bundleBytes <= 0
    || object.size !== order.bundleBytes
    || !(object.body instanceof ReadableStream)) return false;
  let checksum;
  try {
    checksum = Buffer.from(object.checksums.sha256).toString('hex');
  } catch {
    return false;
  }
  return checksum === order.bundleSha256;
}

function serveStatic(request, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
  const asset = STATIC_ASSETS.get(pathname);
  return new Response(request.method === 'HEAD' ? null : asset.body, {
    status: 200,
    headers: staticSecurityHeaders({ 'content-type': asset.contentType }),
  });
}

function loadStatic(filename, contentType) {
  return Object.freeze({
    body: readFileSync(path.join(STATIC_DIRECTORY, filename)),
    contentType,
  });
}

function methodNotAllowed(allow) {
  return jsonResponse(405, { error: '请求方法不允许。' }, { allow });
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: securityHeaders({
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    }),
  });
}

function securityHeaders(headers = {}) {
  return {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...headers,
  };
}

function staticSecurityHeaders(headers = {}) {
  return securityHeaders({
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    ...headers,
  });
}

function readNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Admin clock is invalid.');
  return value;
}

function assertDependencies({ assets, config, loginRateLimit, now, repository }) {
  if (!assets || typeof assets.get !== 'function'
    || !repository
    || typeof repository.listOrders !== 'function'
    || typeof repository.getOrderFile !== 'function'
    || typeof repository.recordDownload !== 'function'
    || !loginRateLimit || typeof loginRateLimit.limit !== 'function'
    || typeof now !== 'function'
    || !config
    || typeof config.adminShop !== 'string'
    || typeof config.adminPasswordHash !== 'string'
    || typeof config.adminSessionSecret !== 'string') {
    throw new TypeError('Admin portal dependencies are invalid.');
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function logError(logger, error) {
  try {
    logger?.error?.('ADMIN_PORTAL_REQUEST_FAILED', error?.name ?? 'Error');
  } catch {
    // Responses do not depend on logger availability.
  }
}

class AdminHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AdminHttpError';
    this.status = status;
  }
}
