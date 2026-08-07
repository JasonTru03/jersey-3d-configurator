import {
  createHmac,
  randomBytes as secureRandomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

export const ADMIN_COOKIE_NAME = '__Host-jersey_admin';

const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const MAX_PASSWORD_BYTES = 1024;
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 4096;
const MIN_SESSION_SECONDS = 5 * 60;
const MAX_SESSION_SECONDS = 24 * 60 * 60;
const scrypt = promisify(scryptCallback);

export async function createAdminPasswordHash(password, {
  randomBytes = secureRandomBytes,
} = {}) {
  const passwordBytes = readPassword(password);
  const salt = readRandomBytes(randomBytes, 16);
  const derived = await derivePassword(passwordBytes, salt);
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('hex'),
    derived.toString('hex'),
  ].join('$');
}

export async function verifyAdminPassword(password, encodedHash) {
  let passwordBytes;
  let parsed;
  try {
    passwordBytes = readPassword(password);
    parsed = parsePasswordHash(encodedHash);
  } catch {
    return false;
  }
  const actual = await derivePassword(passwordBytes, parsed.salt);
  return actual.byteLength === parsed.hash.byteLength && timingSafeEqual(actual, parsed.hash);
}

export function isAdminPasswordHash(value) {
  try {
    parsePasswordHash(value);
    return true;
  } catch {
    return false;
  }
}

export function createAdminSessionCookie({
  now = Date.now(),
  randomBytes = secureRandomBytes,
  secret,
  shop,
  ttlSeconds = 8 * 60 * 60,
}) {
  const currentTime = readTimestamp(now);
  const normalizedShop = readShop(shop);
  const signingSecret = readSecret(secret);
  if (!Number.isSafeInteger(ttlSeconds)
    || ttlSeconds < MIN_SESSION_SECONDS
    || ttlSeconds > MAX_SESSION_SECONDS) {
    throw new TypeError('Admin session duration is invalid.');
  }
  const expiresAt = currentTime + ttlSeconds * 1000;
  if (!Number.isSafeInteger(expiresAt)) throw new TypeError('Admin session expiry is invalid.');
  const payload = encodeBase64Url(JSON.stringify({
    v: 1,
    shop: normalizedShop,
    expiresAt,
    nonce: readRandomBytes(randomBytes, 16).toString('base64url'),
  }));
  const signature = signPayload(payload, signingSecret);
  return [
    `${ADMIN_COOKIE_NAME}=${payload}.${signature}`,
    'Path=/',
    `Max-Age=${ttlSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
}

export function clearAdminSessionCookie() {
  return [
    `${ADMIN_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
}

export function verifyAdminSessionCookie(cookieHeader, {
  now = Date.now(),
  secret,
  shop,
}) {
  try {
    const currentTime = readTimestamp(now);
    const normalizedShop = readShop(shop);
    const signingSecret = readSecret(secret);
    const token = readCookie(cookieHeader, ADMIN_COOKIE_NAME);
    if (!token || token.length > 2048) return null;
    const segments = token.split('.');
    if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) return null;
    const [payload, signature] = segments;
    const expected = signPayload(payload, signingSecret);
    const actualBytes = Buffer.from(signature, 'base64url');
    const expectedBytes = Buffer.from(expected, 'base64url');
    if (actualBytes.byteLength !== expectedBytes.byteLength
      || !timingSafeEqual(actualBytes, expectedBytes)) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!isPlainObject(parsed)
      || Reflect.ownKeys(parsed).length !== 4
      || parsed.v !== 1
      || parsed.shop !== normalizedShop
      || !Number.isSafeInteger(parsed.expiresAt)
      || parsed.expiresAt <= currentTime
      || typeof parsed.nonce !== 'string'
      || !/^[A-Za-z0-9_-]{22}$/u.test(parsed.nonce)) return null;
    return Object.freeze({ shop: normalizedShop, expiresAt: parsed.expiresAt });
  } catch {
    return null;
  }
}

async function derivePassword(password, salt) {
  return scrypt(password, salt, SCRYPT_KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY,
  });
}

function parsePasswordHash(value) {
  if (typeof value !== 'string' || value.length > 512) {
    throw new TypeError('Admin password hash is invalid.');
  }
  const [algorithm, n, r, p, saltHex, hashHex, ...extra] = value.split('$');
  if (algorithm !== 'scrypt'
    || n !== String(SCRYPT_N)
    || r !== String(SCRYPT_R)
    || p !== String(SCRYPT_P)
    || extra.length !== 0
    || !/^[a-f0-9]{32}$/u.test(saltHex ?? '')
    || !/^[a-f0-9]{64}$/u.test(hashHex ?? '')) {
    throw new TypeError('Admin password hash is invalid.');
  }
  return Object.freeze({
    salt: Buffer.from(saltHex, 'hex'),
    hash: Buffer.from(hashHex, 'hex'),
  });
}

function readPassword(value) {
  if (typeof value !== 'string') throw new TypeError('Admin password is invalid.');
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PASSWORD_BYTES) {
    throw new TypeError('Admin password is invalid.');
  }
  return bytes;
}

function readRandomBytes(randomBytes, length) {
  if (typeof randomBytes !== 'function') throw new TypeError('Secure random source is invalid.');
  const value = randomBytes(length);
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  if (bytes.byteLength !== length) throw new TypeError('Secure random source is invalid.');
  return bytes;
}

function readSecret(value) {
  if (typeof value !== 'string') throw new TypeError('Admin session secret is invalid.');
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength < MIN_SECRET_BYTES || bytes.byteLength > MAX_SECRET_BYTES) {
    throw new TypeError('Admin session secret is invalid.');
  }
  return bytes;
}

function readShop(value) {
  if (typeof value !== 'string' || !SHOP_PATTERN.test(value)) {
    throw new TypeError('Admin shop is invalid.');
  }
  return value;
}

function readTimestamp(value) {
  const result = typeof value === 'function' ? value() : value;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new TypeError('Admin session clock is invalid.');
  }
  return result;
}

function readCookie(header, name) {
  if (typeof header !== 'string' || header.length === 0 || header.length > 8192) return null;
  for (const entry of header.split(';')) {
    const index = entry.indexOf('=');
    if (index < 0 || entry.slice(0, index).trim() !== name) continue;
    return entry.slice(index + 1).trim();
  }
  return null;
}

function signPayload(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
