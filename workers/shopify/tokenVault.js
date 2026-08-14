const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const TOKEN_PATTERN = /^[\u0021-\u007e]{16,1024}$/u;
const KEY_VERSION = 1;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function createTokenVault(encodedKey, { purpose = 'shopify-offline-token' } = {}) {
  const keyBytes = decodeBase64(encodedKey);
  if (keyBytes.byteLength !== 32) throw new TypeError('Token encryption key must be 32 bytes.');
  if (!/^[a-z][a-z0-9-]{2,63}$/u.test(purpose)) throw new TypeError('Invalid encryption purpose.');

  return Object.freeze({
    async encrypt(shopInput, tokenInput) {
      const shop = requireShop(shopInput);
      const token = requireToken(tokenInput);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await importKey(keyBytes, ['encrypt']);
      const ciphertext = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: encoder.encode(aad(purpose, shop)),
        tagLength: 128,
      }, key, encoder.encode(token));
      return Object.freeze({
        ciphertext: encodeBase64(new Uint8Array(ciphertext)),
        iv: encodeBase64(iv),
        keyVersion: KEY_VERSION,
      });
    },
    async decrypt(shopInput, value) {
      const shop = requireShop(shopInput);
      if (!value || value.keyVersion !== KEY_VERSION) throw new TypeError('Unsupported token key version.');
      const ciphertext = decodeBase64(value.ciphertext);
      const iv = decodeBase64(value.iv);
      if (iv.byteLength !== 12 || ciphertext.byteLength < 32) throw new TypeError('Invalid encrypted token.');
      const key = await importKey(keyBytes, ['decrypt']);
      let plaintext;
      try {
        plaintext = await crypto.subtle.decrypt({
          name: 'AES-GCM',
          iv,
          additionalData: encoder.encode(aad(purpose, shop)),
          tagLength: 128,
        }, key, ciphertext);
      } catch {
        throw new TypeError('Encrypted token authentication failed.');
      }
      return requireToken(decoder.decode(plaintext));
    },
  });
}

function aad(purpose, shop) {
  return `${purpose}:v${KEY_VERSION}:${shop}`;
}

function importKey(keyBytes, usages) {
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, usages);
}

function requireShop(value) {
  if (typeof value !== 'string' || !SHOP_PATTERN.test(value)) throw new TypeError('Invalid shop.');
  return value;
}

function requireToken(value) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) throw new TypeError('Invalid token.');
  return value;
}

function encodeBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new TypeError('Invalid base64 value.');
  }
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new TypeError('Invalid base64 value.');
  }
}
