const COOKIE_NAME = '__Host-shopify_app_session';
const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const SESSION_PATTERN = /^([A-Za-z0-9_-]{8,256})\.([1-9][0-9]{12,15})\.([a-f0-9]{64})$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const APP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export async function createAppSession(shop, expiresAt, secret) {
  validateShop(shop);
  validateExpiry(expiresAt);
  const payload = `${encodeBase64Url(encoder.encode(shop))}.${expiresAt}`;
  return `${payload}.${await hmacHex(payload, secret)}`;
}

export async function verifyAppSession(value, expectedShop, currentTime, secret) {
  if (typeof value !== 'string' || value.length > 1024 || !SHOP_PATTERN.test(expectedShop)) return false;
  const match = SESSION_PATTERN.exec(value);
  if (!match) return false;
  let shop;
  try { shop = decoder.decode(decodeBase64Url(match[1])); } catch { return false; }
  const expiresAt = Number(match[2]);
  if (shop !== expectedShop || !Number.isSafeInteger(expiresAt)
    || expiresAt < currentTime || expiresAt - currentTime > APP_SESSION_TTL_MS) return false;
  return constantTimeEqual(match[3], await hmacHex(`${match[1]}.${match[2]}`, secret));
}

export function readAppSessionCookie(header) {
  return readCookie(header, COOKIE_NAME);
}

export function createAppSessionCookie(value, maxAgeSeconds = APP_SESSION_TTL_MS / 1000) {
  if (typeof value !== 'string' || !SESSION_PATTERN.test(value)
    || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) {
    throw new TypeError('Invalid app session cookie.');
  }
  return `${COOKIE_NAME}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export async function createCsrfToken(session, secret) {
  if (typeof session !== 'string' || !SESSION_PATTERN.test(session)) {
    throw new TypeError('Invalid app session.');
  }
  return hmacHex(`merchant-csrf:v1:${session}`, secret);
}

export async function verifyCsrfToken(provided, session, secret) {
  if (typeof provided !== 'string' || !/^[a-f0-9]{64}$/u.test(provided)) return false;
  return constantTimeEqual(provided, await createCsrfToken(session, secret));
}

function readCookie(header, name) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const matches = header.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

async function hmacHex(value, secret) {
  if (typeof secret !== 'string' || encoder.encode(secret).length < 16) {
    throw new TypeError('Invalid session secret.');
  }
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function validateShop(value) {
  if (typeof value !== 'string' || !SHOP_PATTERN.test(value)) throw new TypeError('Invalid shop.');
}

function validateExpiry(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Invalid expiry.');
}
