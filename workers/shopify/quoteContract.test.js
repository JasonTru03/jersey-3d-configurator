import { describe, expect, it } from 'vitest';
import {
  canonicalizeQuoteComponents,
  createShopFingerprint,
  decodeQuoteHeader,
  MAX_QUOTE_TOKEN_LENGTH,
  QUOTE_SCHEMA_VERSION,
  signQuoteContract,
  verifyQuoteContract,
} from './quoteContract.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000_000;

function validContract(overrides = {}) {
  return {
    version: QUOTE_SCHEMA_VERSION,
    shopFingerprint: 'shop_Fj3mQ2x9AbCd',
    bundleId: 'bun_0123456789abcdef',
    designId: 'dsg_0123456789abcdef',
    totalMinor: 12_345,
    currency: 'USD',
    issuedAt: NOW - 1_000,
    expiresAt: NOW + 60_000,
    components: [
      { role: 'surcharge', variantId: '9007199254740992', quantity: 2 },
      { role: 'base', variantId: '18446744073709551615', quantity: 1 },
    ],
    ...overrides,
  };
}

function encodeBase64Url(text) {
  return encodeBytesBase64Url(new TextEncoder().encode(text));
}

function encodeBytesBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function decodeBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)));
}

function mutateHeader(token, mutate) {
  const [encodedHeader, signature] = token.split('.');
  const compactHeader = JSON.parse(decodeBase64Url(encodedHeader));
  mutate(compactHeader);
  return `${encodeBase64Url(JSON.stringify(compactHeader))}.${signature}`;
}

async function authenticateCompactHeader(compactHeader, components) {
  const encodedHeader = encodeBase64Url(JSON.stringify(compactHeader));
  const compactComponents = canonicalizeQuoteComponents(components).map((component) => [
    component.role === 'base' ? 'b' : 's',
    component.variantId,
    component.quantity,
  ]);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = `q${QUOTE_SCHEMA_VERSION}\n${encodedHeader}\n${JSON.stringify(compactComponents)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
  );
  return `${encodedHeader}.${encodeBytesBase64Url(signature)}`;
}

describe('Shopify quote contract', () => {
  it('creates a stable short fingerprint from a canonical Shopify domain', async () => {
    const lower = await createShopFingerprint('example-store.myshopify.com');

    expect(await createShopFingerprint('  EXAMPLE-STORE.MYSHOPIFY.COM  ')).toBe(lower);
    expect(lower).toMatch(/^shop_[A-Za-z0-9_-]{12}$/u);
    await expect(createShopFingerprint('example.com')).rejects.toThrow('Shop domain');
  });

  it('signs and verifies a compact URL-safe contract without embedding components', async () => {
    const contract = validContract();
    const token = await signQuoteContract(contract, SECRET);
    const header = await verifyQuoteContract(token, contract.components, SECRET, {
      now: NOW,
      expectedShopFingerprint: contract.shopFingerprint,
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(token.length).toBeLessThanOrEqual(MAX_QUOTE_TOKEN_LENGTH);
    expect(decodeBase64Url(token.split('.')[0])).not.toContain('variantId');
    expect(header).toEqual({
      version: contract.version,
      shopFingerprint: contract.shopFingerprint,
      bundleId: contract.bundleId,
      designId: contract.designId,
      totalMinor: contract.totalMinor,
      currency: contract.currency,
      issuedAt: contract.issuedAt,
      expiresAt: contract.expiresAt,
    });
    expect(header).not.toHaveProperty('components');
  });

  it('canonicalizes object fields and component order deterministically', async () => {
    const contract = validContract();
    const reversedFields = {
      components: contract.components.map(({ role, variantId, quantity }) => ({ quantity, variantId, role })).reverse(),
      expiresAt: contract.expiresAt,
      issuedAt: contract.issuedAt,
      currency: contract.currency,
      totalMinor: contract.totalMinor,
      designId: contract.designId,
      bundleId: contract.bundleId,
      shopFingerprint: contract.shopFingerprint,
      version: contract.version,
    };

    expect(await signQuoteContract(reversedFields, SECRET)).toBe(await signQuoteContract(contract, SECRET));
    expect(canonicalizeQuoteComponents(contract.components)).toEqual([
      { role: 'base', variantId: '18446744073709551615', quantity: 1 },
      { role: 'surcharge', variantId: '9007199254740992', quantity: 2 },
    ]);
  });

  it('rejects tampered headers and every meaningful component mutation', async () => {
    const contract = validContract();
    const token = await signQuoteContract(contract, SECRET);
    const headerMutations = [
      (header) => { header[1] = 'shop_AbCdEf123456'; },
      (header) => { header[2] = 'bun_fedcba9876543210'; },
      (header) => { header[3] = 'dsg_fedcba9876543210'; },
      (header) => { header[4] += 1; },
      (header) => { header[5] = 'EUR'; },
      (header) => { header[6] -= 1; },
      (header) => { header[7] += 1; },
    ];
    for (const mutate of headerMutations) {
      await expect(verifyQuoteContract(mutateHeader(token, mutate), contract.components, SECRET, { now: NOW }))
        .rejects.toThrow('Quote signature is invalid');
    }

    const componentMutations = [
      contract.components.slice(1),
      contract.components.map((component, index) => index === 0 ? { ...component, variantId: '1234' } : component),
      contract.components.map((component, index) => index === 0 ? { ...component, quantity: 3 } : component),
      contract.components.map((component, index) => index === 0 ? { ...component, role: 'base' } : { ...component, role: 'surcharge' }),
    ];
    for (const components of componentMutations) {
      await expect(verifyQuoteContract(token, components, SECRET, { now: NOW }))
        .rejects.toThrow(/Quote (signature is invalid|components must contain exactly one base)/u);
    }
  });

  it('authenticates the raw header before checking schema, shop binding, and expiry', async () => {
    const contract = validContract();
    const token = await signQuoteContract(contract, SECRET);

    await expect(verifyQuoteContract(token, contract.components, SECRET, {
      now: NOW,
      expectedShopFingerprint: 'shop_AbCdEf123456',
    })).rejects.toThrow('Quote shop fingerprint does not match');
    await expect(verifyQuoteContract(token, contract.components, SECRET, { now: contract.expiresAt }))
      .rejects.toThrow('Quote has expired');
    await expect(verifyQuoteContract(mutateHeader(token, (header) => { header[0] = 2; }), contract.components, SECRET, { now: NOW }))
      .rejects.toThrow('Quote signature is invalid');

    const compactHeader = JSON.parse(decodeBase64Url(token.split('.')[0]));
    compactHeader[0] = 2;
    const authenticatedUnknownSchema = await authenticateCompactHeader(compactHeader, contract.components);
    await expect(verifyQuoteContract(authenticatedUnknownSchema, contract.components, SECRET, { now: NOW }))
      .rejects.toThrow('Unsupported quote schema version');
  });

  it('rejects an authenticated quote before its issuedAt time', async () => {
    const contract = validContract({ issuedAt: NOW + 1_000, expiresAt: NOW + 60_000 });
    const token = await signQuoteContract(contract, SECRET);

    await expect(verifyQuoteContract(token, contract.components, SECRET, { now: NOW }))
      .rejects.toThrow('Quote is not yet valid');
  });

  it('strictly rejects malformed, non-canonical, segmented, and oversized tokens', async () => {
    const contract = validContract();
    const token = await signQuoteContract(contract, SECRET);
    const [, signature] = token.split('.');
    const malformed = [
      '', '.', `${token}.extra`, `.${signature}`, `${token.split('.')[0]}.`,
      `abc*.${signature}`, `YWJj=.${signature}`, `A.${signature}`,
      `${encodeBase64Url('{bad json')}.${signature}`,
      `${encodeBase64Url('{}')}.${signature}`,
      'a'.repeat(MAX_QUOTE_TOKEN_LENGTH + 1),
    ];

    for (const candidate of malformed) {
      await expect(verifyQuoteContract(candidate, contract.components, SECRET, { now: NOW }))
        .rejects.toThrow();
    }
  });

  it('requires secrets with at least 32 UTF-8 bytes', async () => {
    await expect(signQuoteContract(validContract(), 'short')).rejects.toThrow('at least 32 UTF-8 bytes');
    const token = await signQuoteContract(validContract(), SECRET);
    await expect(verifyQuoteContract(token, validContract().components, 'é'.repeat(15), { now: NOW }))
      .rejects.toThrow('at least 32 UTF-8 bytes');
  });

  it('fails explicitly when valid metadata would create an oversized token', async () => {
    await expect(signQuoteContract(validContract({
      bundleId: `bun_${'a'.repeat(64)}`,
      designId: `dsg_${'b'.repeat(64)}`,
    }), SECRET)).rejects.toThrow(`exceeds ${MAX_QUOTE_TOKEN_LENGTH} characters`);
  });

  it('rejects invalid IDs, currency, totals, times, and schema fields', async () => {
    const cases = [
      [{ version: 2 }, 'schema version'],
      [{ shopFingerprint: 'bad' }, 'shopFingerprint'],
      [{ bundleId: 'bundle_123' }, 'bundleId'],
      [{ designId: 'design_123' }, 'designId'],
      [{ totalMinor: -1 }, 'totalMinor'],
      [{ totalMinor: Number.MAX_SAFE_INTEGER + 1 }, 'totalMinor'],
      [{ currency: 'usd' }, 'currency'],
      [{ issuedAt: 1.5 }, 'issuedAt'],
      [{ expiresAt: NOW - 2_000 }, 'issuedAt must be earlier than expiresAt'],
    ];
    for (const [override, message] of cases) {
      await expect(signQuoteContract(validContract(override), SECRET)).rejects.toThrow(message);
    }
  });

  it('requires an exact contract and component object schema', async () => {
    await expect(signQuoteContract(validContract({ unexpected: true }), SECRET))
      .rejects.toThrow('Quote contract has unexpected field "unexpected"');

    const componentWithExtra = [
      { role: 'base', variantId: '1', quantity: 1, amount: 100 },
    ];
    expect(() => canonicalizeQuoteComponents(componentWithExtra))
      .toThrow('Quote component 0 has unexpected field "amount"');
    await expect(signQuoteContract(validContract({ components: componentWithExtra }), SECRET))
      .rejects.toThrow('Quote component 0 has unexpected field "amount"');

    const componentMissingQuantity = [{ role: 'base', variantId: '1' }];
    expect(() => canonicalizeQuoteComponents(componentMissingQuantity))
      .toThrow('Quote component 0 is missing required field "quantity"');
  });

  it('requires unique uint64 variants, positive quantities, and exactly one base', async () => {
    const invalidComponents = [
      [[{ role: 'surcharge', variantId: '1', quantity: 1 }], 'exactly one base'],
      [[{ role: 'base', variantId: '1', quantity: 1 }, { role: 'base', variantId: '2', quantity: 1 }], 'exactly one base'],
      [[{ role: 'base', variantId: '1', quantity: 1 }, { role: 'surcharge', variantId: '1', quantity: 1 }], 'duplicate variantId'],
      [[{ role: 'base', variantId: '0', quantity: 1 }], 'variantId'],
      [[{ role: 'base', variantId: '01', quantity: 1 }], 'variantId'],
      [[{ role: 'base', variantId: '18446744073709551616', quantity: 1 }], 'variantId'],
      [[{ role: 'base', variantId: '1', quantity: 0 }], 'quantity'],
      [[{ role: 'base', variantId: '1', quantity: Number.MAX_SAFE_INTEGER + 1 }], 'quantity'],
      [[{ role: 'fee', variantId: '1', quantity: 1 }], 'role'],
    ];
    for (const [components, message] of invalidComponents) {
      expect(() => canonicalizeQuoteComponents(components)).toThrow(message);
      await expect(signQuoteContract(validContract({ components }), SECRET)).rejects.toThrow(message);
    }
  });

  it('preserves canonical uint64 variant strings beyond JavaScript safe integers', async () => {
    const contract = validContract({
      components: [{ role: 'base', variantId: '18446744073709551615', quantity: 1 }],
    });
    const token = await signQuoteContract(contract, SECRET);

    await expect(verifyQuoteContract(token, contract.components, SECRET, { now: NOW })).resolves.toMatchObject({
      designId: contract.designId,
    });
  });

  it('decodeQuoteHeader only parses a fresh strict header object and does not authenticate', async () => {
    const contract = validContract();
    const token = await signQuoteContract(contract, SECRET);
    const decoded = decodeQuoteHeader(token);
    const forged = mutateHeader(token, (header) => { header[4] += 500; });

    expect(decoded).toEqual(expect.objectContaining({ designId: contract.designId }));
    expect(decoded).not.toHaveProperty('verified');
    expect(decodeQuoteHeader(forged).totalMinor).toBe(contract.totalMinor + 500);
    await expect(verifyQuoteContract(forged, contract.components, SECRET, { now: NOW }))
      .rejects.toThrow('Quote signature is invalid');
    expect(() => decodeQuoteHeader(`${token}.extra`)).toThrow('exactly two segments');
  });
});
