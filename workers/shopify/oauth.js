import { createOAuthRepository } from './oauthRepository.js';
import {
  readOAuthShop,
  readOAuthTimestamp,
  sha256Hex,
  verifyOAuthQuery,
} from './oauthSecurity.js';
import { createTokenVault } from './tokenVault.js';
import {
  APP_SESSION_TTL_MS,
  createAppSession,
  createAppSessionCookie,
  readAppSessionCookie,
  verifyAppSession,
} from './appSession.js';

const STATE_COOKIE = '__Host-shopify_oauth_state';
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CODE_PATTERN = /^[A-Za-z0-9_-]{8,512}$/u;
const API_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const SESSION_TTL_MS = 10 * 60 * 1000;
const TOKEN_RESPONSE_LIMIT = 64 * 1024;
export const REQUESTED_SHOPIFY_SCOPES = Object.freeze([
  'read_cart_transforms',
  'read_orders',
  'read_products',
  'read_validations',
  'write_app_proxy',
  'write_cart_transforms',
  'write_validations',
]);
export const REQUIRED_SHOPIFY_SCOPES = Object.freeze([
  'read_orders',
  'read_products',
  'write_app_proxy',
  'write_cart_transforms',
  'write_validations',
]);

export function createOAuthHandler(env, dependencies = {}) {
  const createRepository = dependencies.createOAuthRepository ?? createOAuthRepository;
  const createVault = dependencies.createTokenVault ?? createTokenVault;
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const randomBytes = dependencies.randomBytes ?? secureRandomBytes;
  const logger = dependencies.logger ?? console;

  return async function handleOAuth(request) {
    const url = new URL(request.url);
    try {
      const bindings = validateBindings(env, createRepository, createVault);
      if (request.method !== 'GET') return jsonError(405, 'Method must be GET.', { Allow: 'GET' });
      if (url.pathname === '/auth') {
        return await beginAuthorization(request, url, bindings, { now, randomBytes });
      }
      if (url.pathname === '/auth/callback') {
        return await finishAuthorization(request, url, bindings, { fetchImpl, now });
      }
      if (url.pathname === '/app') {
        return await authenticatedAppHome(request, url, bindings, { now });
      }
      return jsonError(404, 'Not found.');
    } catch (error) {
      if (error instanceof OAuthRequestError) {
        return jsonError(error.status, error.publicMessage, error.headers);
      }
      logger.error?.('SHOPIFY_OAUTH_FAILED');
      return jsonError(503, 'Shopify installation is temporarily unavailable.');
    }
  };
}

async function beginAuthorization(request, url, bindings, dependencies) {
  const currentTime = readNow(dependencies.now);
  if (!await verifyOAuthQuery(url, bindings.secret)) throw invalidRequest();
  const shop = readShop(url.searchParams.get('shop'));
  readTimestamp(url.searchParams.get('timestamp'), currentTime);
  const installation = await bindings.repository.getInstallation(shop);
  if (installation?.status === 'active'
    && REQUIRED_SHOPIFY_SCOPES.every((scope) => installation.scopes.includes(scope))) {
    return redirectToApp({
      bindings,
      currentTime,
      host: readOptionalHost(url.searchParams.get('host')),
      shop,
    });
  }
  const state = encodeBase64Url(dependencies.randomBytes(32));
  if (!STATE_PATTERN.test(state)) throw new Error('Invalid random state.');
  await bindings.repository.createSession({
    stateHash: await sha256Hex(state),
    shop,
    createdAt: currentTime,
    expiresAt: currentTime + SESSION_TTL_MS,
  });
  const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
  authorize.searchParams.set('client_id', bindings.apiKey);
  authorize.searchParams.set('redirect_uri', `${bindings.publicOrigin}/auth/callback`);
  authorize.searchParams.set('scope', REQUESTED_SHOPIFY_SCOPES.join(','));
  authorize.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      'Cache-Control': 'no-store',
      Location: authorize.href,
      'Set-Cookie': stateCookie(state, SESSION_TTL_MS / 1000),
    },
  });
}

async function finishAuthorization(request, url, bindings, dependencies) {
  const currentTime = readNow(dependencies.now);
  if (!await verifyOAuthQuery(url, bindings.secret)) throw invalidRequest(401);
  const shop = readShop(url.searchParams.get('shop'));
  readTimestamp(url.searchParams.get('timestamp'), currentTime);
  const state = requirePattern(url.searchParams.get('state'), STATE_PATTERN);
  const code = requirePattern(url.searchParams.get('code'), CODE_PATTERN);
  const host = readHost(url.searchParams.get('host'));
  const cookieState = readCookie(request.headers.get('Cookie'), STATE_COOKIE);
  if (!constantTimeStringEqual(state, cookieState)) throw invalidRequest(401);
  await bindings.repository.consumeSession({
    stateHash: await sha256Hex(state),
    shop,
    consumedAt: currentTime,
  });
  const token = await exchangeCode(shop, code, bindings, dependencies.fetchImpl);
  const encrypted = await bindings.vault.encrypt(shop, token.accessToken);
  const scopesValid = REQUIRED_SHOPIFY_SCOPES.every((scope) => token.scopes.includes(scope));
  await bindings.repository.saveInstallation({
    shop,
    status: scopesValid ? 'active' : 'scope_invalid',
    ...encrypted,
    scopes: token.scopes,
    installedAt: currentTime,
  });
  if (!scopesValid) {
    throw new OAuthRequestError(403, 'The app was installed without all required permissions.', {
      'Set-Cookie': clearStateCookie(),
    });
  }
  return redirectToApp({ bindings, currentTime, host, shop });
}

async function redirectToApp({ bindings, currentTime, host, shop }) {
  const appSession = await createAppSession(
    shop,
    currentTime + APP_SESSION_TTL_MS,
    bindings.secret,
  );
  const location = new URL('/app', bindings.publicOrigin);
  location.searchParams.set('shop', shop);
  if (host !== null) location.searchParams.set('host', host);
  return new Response(null, {
    status: 302,
    headers: {
      'Cache-Control': 'no-store',
      Location: location.href,
      'Set-Cookie': createAppSessionCookie(appSession),
    },
  });
}

async function authenticatedAppHome(request, url, bindings, dependencies) {
  const shop = readShop(url.searchParams.get('shop'));
  const session = readAppSessionCookie(request.headers.get('Cookie'));
  if (!await verifyAppSession(session, shop, readNow(dependencies.now), bindings.secret)) {
    throw invalidRequest(401);
  }
  const installation = await bindings.repository.getInstallation(shop);
  if (!installation || installation.status !== 'active') throw invalidRequest(401);
  return appHome(shop, installation.scopes);
}

async function exchangeCode(shop, code, bindings, fetchImpl) {
  const body = new URLSearchParams({
    client_id: bindings.apiKey,
    client_secret: bindings.secret,
    code,
  });
  let response;
  try {
    response = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      redirect: 'error',
    });
  } catch {
    throw new Error('Token exchange failed.');
  }
  const text = await response.text();
  if (!response.ok || new TextEncoder().encode(text).length > TOKEN_RESPONSE_LIMIT) {
    throw new Error('Token exchange failed.');
  }
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Token exchange failed.'); }
  if (!isPlainObject(payload)) throw new Error('Token exchange failed.');
  const accessToken = requirePattern(payload.access_token, /^[\u0021-\u007e]{16,1024}$/u);
  if (typeof payload.scope !== 'string' || payload.scope.length > 8192) {
    throw new Error('Token exchange failed.');
  }
  const scopes = payload.scope.split(',').map((scope) => scope.trim()).filter(Boolean).sort();
  if (scopes.length === 0 || scopes.length > 100
    || new Set(scopes).size !== scopes.length
    || scopes.some((scope) => !/^[a-z][a-z0-9_]{1,79}$/u.test(scope))) {
    throw new Error('Token exchange failed.');
  }
  return { accessToken, scopes };
}

function validateBindings(env, createRepository, createVault) {
  if (!env || !API_KEY_PATTERN.test(env.SHOPIFY_API_KEY ?? '')
    || typeof env.SHOPIFY_API_SECRET !== 'string'
    || new TextEncoder().encode(env.SHOPIFY_API_SECRET).length < 16
    || !env.PRODUCTION_DB) throw new Error('Invalid OAuth bindings.');
  const publicOrigin = readPublicOrigin(env.PUBLIC_ORIGIN);
  const repository = createRepository(env.PRODUCTION_DB);
  const vault = createVault(env.SHOPIFY_TOKEN_ENCRYPTION_KEY);
  for (const method of [
    'createSession', 'consumeSession', 'getInstallation', 'saveInstallation',
  ]) if (typeof repository?.[method] !== 'function') throw new Error('Invalid OAuth repository.');
  if (typeof vault?.encrypt !== 'function') throw new Error('Invalid token vault.');
  return {
    apiKey: env.SHOPIFY_API_KEY,
    publicOrigin,
    repository,
    secret: env.SHOPIFY_API_SECRET,
    vault,
  };
}

function appHome(shop, scopes) {
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Secure Jersey Configurator</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f5f1;color:#17261d;font-family:Inter,"Noto Sans SC",system-ui,sans-serif}main{width:min(720px,calc(100% - 32px));margin:10vh auto;border:1px solid #dfe4dd;border-radius:22px;padding:36px;background:#fff;box-shadow:0 18px 60px #1d34281a}.eyebrow{margin:0 0 10px;color:#1d6247;font-size:12px;font-weight:800;letter-spacing:.16em}h1{margin:0;font-size:clamp(28px,5vw,44px)}.status{display:inline-flex;margin-top:26px;border-radius:999px;padding:9px 13px;color:#176044;background:#e6f4ec;font-weight:800}.shop{margin:18px 0 0;color:#55635a;word-break:break-word}.meta{margin:8px 0 0;color:#78827b;font-size:14px}</style></head><body><main><p class="eyebrow">SECURE JERSEY · v1.0.0</p><h1>3D 球衣定制管理</h1><div class="status">店铺已连接</div><p class="shop">${escapeHtml(shop)}</p><p class="meta">已安全授权 ${scopes.length} 项权限。</p></main></body></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  });
}

function stateCookie(value, maxAge) {
  return `${STATE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function clearStateCookie() {
  return `${STATE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(header, name) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const matches = header.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  return matches[0].slice(name.length + 1);
}

function readPublicOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid public origin.'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.pathname !== '/') {
    throw new Error('Invalid public origin.');
  }
  return url.origin;
}

function readHost(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,512}$/u.test(value)) throw invalidRequest();
  try {
    const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    );
    if (!/^(?:admin\.shopify\.com\/store\/[a-z0-9-]{1,80}|[a-z0-9-]{1,63}\.myshopify\.com\/admin)$/u.test(decoded)) {
      throw invalidRequest();
    }
    return value;
  } catch (error) {
    if (error instanceof OAuthRequestError) throw error;
    throw invalidRequest();
  }
}

function readOptionalHost(value) {
  return value === null ? null : readHost(value);
}

function readShop(value) {
  try { return readOAuthShop(value); } catch { throw invalidRequest(); }
}

function readTimestamp(value, currentTime) {
  try { return readOAuthTimestamp(value, currentTime); } catch { throw invalidRequest(); }
}

function readNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid clock.');
  return value;
}

function secureRandomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function constantTimeStringEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function requirePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalidRequest();
  return value;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function jsonError(status, message, extra = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

function invalidRequest(status = 400) {
  return new OAuthRequestError(
    status,
    status === 401 ? 'Shopify request authentication failed.' : 'Shopify request is invalid.',
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class OAuthRequestError extends Error {
  constructor(status, publicMessage, headers = {}) {
    super('Shopify OAuth request failed.');
    this.status = status;
    this.publicMessage = publicMessage;
    this.headers = headers;
  }
}
