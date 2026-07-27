export const QUOTE_SCHEMA_VERSION = 1;
export const MAX_QUOTE_TOKEN_LENGTH = 255;

const UINT64_MAX_DECIMAL = '18446744073709551615';
const SHOP_FINGERPRINT_PATTERN = /^shop_[A-Za-z0-9_-]{12}$/u;
const BUNDLE_ID_PATTERN = /^bun_[A-Za-z0-9_-]{16,64}$/u;
const DESIGN_ID_PATTERN = /^dsg_[A-Za-z0-9_-]{16,64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export async function createShopFingerprint(shop) {
  if (typeof shop !== 'string') throw new TypeError('Shop domain must be a string.');
  const normalizedShop = shop.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u.test(normalizedShop)) {
    throw new TypeError('Shop domain must be a valid *.myshopify.com domain.');
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(normalizedShop)));
  return `shop_${encodeBase64Url(digest).slice(0, 12)}`;
}

export function canonicalizeQuoteComponents(components) {
  if (!Array.isArray(components) || components.length === 0) {
    throw new TypeError('Quote components must be a non-empty array.');
  }

  const variantIds = new Set();
  let baseCount = 0;
  const normalized = components.map((component, index) => {
    if (!isPlainObject(component)) {
      throw new TypeError(`Quote component ${index} must be a plain object.`);
    }
    if (component.role !== 'base' && component.role !== 'surcharge') {
      throw new TypeError(`Quote component ${index} role must be base or surcharge.`);
    }
    if (!isCanonicalUint64(component.variantId)) {
      throw new TypeError(`Quote component ${index} variantId must be a canonical positive uint64 string.`);
    }
    if (!Number.isSafeInteger(component.quantity) || component.quantity <= 0) {
      throw new TypeError(`Quote component ${index} quantity must be a positive safe integer.`);
    }
    if (variantIds.has(component.variantId)) {
      throw new TypeError(`Quote components contain duplicate variantId "${component.variantId}".`);
    }
    variantIds.add(component.variantId);
    if (component.role === 'base') baseCount += 1;
    return {
      role: component.role,
      variantId: component.variantId,
      quantity: component.quantity,
    };
  });

  if (baseCount !== 1) throw new TypeError('Quote components must contain exactly one base component.');

  return normalized.sort((left, right) => {
    if (left.role !== right.role) return left.role === 'base' ? -1 : 1;
    if (left.variantId.length !== right.variantId.length) {
      return left.variantId.length - right.variantId.length;
    }
    if (left.variantId < right.variantId) return -1;
    if (left.variantId > right.variantId) return 1;
    return 0;
  });
}

export async function signQuoteContract(contract, secret) {
  const header = normalizeContractHeader(contract);
  const components = canonicalizeQuoteComponents(contract.components);
  const secretBytes = normalizeSecret(secret);
  const encodedHeader = encodeHeader(header);
  const signature = await createSignature(encodedHeader, components, secretBytes);
  const token = `${encodedHeader}.${encodeBase64Url(signature)}`;
  if (token.length > MAX_QUOTE_TOKEN_LENGTH) {
    throw new RangeError(`Signed quote token exceeds ${MAX_QUOTE_TOKEN_LENGTH} characters.`);
  }
  return token;
}

export function decodeQuoteHeader(token) {
  return parseToken(token).header;
}

export async function verifyQuoteContract(token, components, secret, options = {}) {
  const parsed = parseToken(token);
  const canonicalComponents = canonicalizeQuoteComponents(components);
  const secretBytes = normalizeSecret(secret);
  const actualSignature = await createSignature(
    parsed.encodedHeader,
    canonicalComponents,
    secretBytes,
  );
  if (!constantTimeEqual(actualSignature, parsed.signature)) {
    throw new Error('Quote signature is invalid.');
  }

  const expectedShopFingerprint = options.expectedShopFingerprint;
  if (expectedShopFingerprint !== undefined) {
    assertShopFingerprint(expectedShopFingerprint);
    if (parsed.header.shopFingerprint !== expectedShopFingerprint) {
      throw new Error('Quote shop fingerprint does not match.');
    }
  }

  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError('Quote verification time must be a non-negative millisecond integer.');
  }
  if (now >= parsed.header.expiresAt) throw new Error('Quote has expired.');
  return { ...parsed.header };
}

function parseToken(token) {
  if (typeof token !== 'string') throw new TypeError('Quote token must be a string.');
  if (token.length > MAX_QUOTE_TOKEN_LENGTH) {
    throw new RangeError(`Quote token exceeds ${MAX_QUOTE_TOKEN_LENGTH} characters.`);
  }
  const segments = token.split('.');
  if (segments.length !== 2) throw new TypeError('Quote token must contain exactly two segments.');
  if (segments[0].length === 0 || segments[1].length === 0) {
    throw new TypeError('Quote token segments must not be empty.');
  }

  const headerBytes = decodeCanonicalBase64Url(segments[0], 'Quote header');
  const signature = decodeCanonicalBase64Url(segments[1], 'Quote signature');
  if (signature.length !== 32) throw new TypeError('Quote signature must contain exactly 32 bytes.');

  let compactHeader;
  try {
    compactHeader = JSON.parse(decoder.decode(headerBytes));
  } catch {
    throw new TypeError('Quote header must contain valid UTF-8 JSON.');
  }
  const header = normalizeCompactHeader(compactHeader);
  const canonicalHeader = encodeHeader(header);
  if (segments[0] !== canonicalHeader) {
    throw new TypeError('Quote header encoding is not canonical.');
  }
  return { encodedHeader: segments[0], signature, header };
}

function normalizeContractHeader(contract) {
  if (!isPlainObject(contract)) throw new TypeError('Quote contract must be a plain object.');
  return validateHeader({
    version: contract.version,
    shopFingerprint: contract.shopFingerprint,
    bundleId: contract.bundleId,
    designId: contract.designId,
    totalMinor: contract.totalMinor,
    currency: contract.currency,
    issuedAt: contract.issuedAt,
    expiresAt: contract.expiresAt,
  });
}

function normalizeCompactHeader(value) {
  if (!Array.isArray(value) || value.length !== 8) {
    throw new TypeError('Quote header must contain exactly eight fields.');
  }
  return validateHeader({
    version: value[0],
    shopFingerprint: value[1],
    bundleId: value[2],
    designId: value[3],
    totalMinor: value[4],
    currency: value[5],
    issuedAt: value[6],
    expiresAt: value[7],
  });
}

function validateHeader(header) {
  if (header.version !== QUOTE_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported quote schema version; expected ${QUOTE_SCHEMA_VERSION}.`);
  }
  assertShopFingerprint(header.shopFingerprint);
  if (typeof header.bundleId !== 'string' || !BUNDLE_ID_PATTERN.test(header.bundleId)) {
    throw new TypeError('Quote bundleId must use bun_ followed by 16-64 URL-safe random characters.');
  }
  if (typeof header.designId !== 'string' || !DESIGN_ID_PATTERN.test(header.designId)) {
    throw new TypeError('Quote designId must use dsg_ followed by 16-64 URL-safe random characters.');
  }
  if (!Number.isSafeInteger(header.totalMinor) || header.totalMinor < 0) {
    throw new TypeError('Quote totalMinor must be a non-negative safe integer.');
  }
  if (typeof header.currency !== 'string' || !/^[A-Z]{3}$/u.test(header.currency)) {
    throw new TypeError('Quote currency must be a three-letter uppercase code.');
  }
  if (!Number.isSafeInteger(header.issuedAt) || header.issuedAt < 0) {
    throw new TypeError('Quote issuedAt must be a non-negative millisecond integer.');
  }
  if (!Number.isSafeInteger(header.expiresAt) || header.expiresAt < 0) {
    throw new TypeError('Quote expiresAt must be a non-negative millisecond integer.');
  }
  if (header.issuedAt >= header.expiresAt) {
    throw new TypeError('Quote issuedAt must be earlier than expiresAt.');
  }
  return { ...header };
}

function assertShopFingerprint(value) {
  if (typeof value !== 'string' || !SHOP_FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError('Quote shopFingerprint must be a canonical shop_ fingerprint.');
  }
}

function encodeHeader(header) {
  return encodeBase64Url(encoder.encode(JSON.stringify([
    header.version,
    header.shopFingerprint,
    header.bundleId,
    header.designId,
    header.totalMinor,
    header.currency,
    header.issuedAt,
    header.expiresAt,
  ])));
}

async function createSignature(encodedHeader, components, secretBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const compactComponents = components.map((component) => [
    component.role === 'base' ? 'b' : 's',
    component.variantId,
    component.quantity,
  ]);
  const message = `q${QUOTE_SCHEMA_VERSION}\n${encodedHeader}\n${JSON.stringify(compactComponents)}`;
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function normalizeSecret(secret) {
  if (typeof secret !== 'string') throw new TypeError('Quote secret must be a string.');
  const bytes = encoder.encode(secret);
  if (bytes.length < 32) throw new TypeError('Quote secret must contain at least 32 UTF-8 bytes.');
  return bytes;
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeCanonicalBase64Url(value, field) {
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new TypeError(`${field} must use unpadded base64url encoding.`);
  }
  let binary;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    binary = atob(padded);
  } catch {
    throw new TypeError(`${field} must use valid base64url encoding.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) {
    throw new TypeError(`${field} base64url encoding is not canonical.`);
  }
  return bytes;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function isCanonicalUint64(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) return false;
  if (value.length !== UINT64_MAX_DECIMAL.length) return value.length < UINT64_MAX_DECIMAL.length;
  return value <= UINT64_MAX_DECIMAL;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
