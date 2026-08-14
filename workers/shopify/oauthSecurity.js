const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const HEX_HMAC_PATTERN = /^[a-f0-9]{64}$/u;
const encoder = new TextEncoder();

export async function verifyOAuthQuery(urlInput, secretInput) {
  const url = urlInput instanceof URL ? urlInput : new URL(urlInput);
  const secret = requireSecret(secretInput);
  const hmacValues = url.searchParams.getAll('hmac');
  if (hmacValues.length !== 1 || !HEX_HMAC_PATTERN.test(hmacValues[0])) return false;
  const entries = [];
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (key === 'hmac') continue;
    if (key === 'signature' || seen.has(key)) return false;
    seen.add(key);
    entries.push(`${key}=${value}`);
  }
  const canonical = entries.sort().join('&');
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, encoder.encode(canonical),
  ));
  return constantTimeEqual(expected, decodeHex(hmacValues[0]));
}

export function readOAuthShop(value) {
  if (typeof value !== 'string' || !SHOP_PATTERN.test(value)) {
    throw new TypeError('Invalid Shopify shop domain.');
  }
  return value;
}

export function readOAuthTimestamp(value, now, maximumAgeMs = 10 * 60 * 1000) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,12}$/u.test(value)) {
    throw new TypeError('Invalid OAuth timestamp.');
  }
  const milliseconds = Number(value) * 1000;
  if (!Number.isSafeInteger(milliseconds)
    || Math.abs(now - milliseconds) > maximumAgeMs) throw new TypeError('Expired OAuth request.');
  return milliseconds;
}

export async function sha256Hex(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 512) {
    throw new TypeError('Invalid hash input.');
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireSecret(value) {
  if (typeof value !== 'string' || encoder.encode(value).length < 16) {
    throw new TypeError('Invalid Shopify secret.');
  }
  return value;
}

function decodeHex(value) {
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    result[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return result;
}

function constantTimeEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
