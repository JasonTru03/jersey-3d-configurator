import { describe, expect, it } from 'vitest';
import { createTokenVault } from './tokenVault.js';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const SHOP = 'vault-test.myshopify.com';
const TOKEN = 'shpat_test_token_value_1234567890';

describe('Shopify token vault', () => {
  it('round trips a token without exposing plaintext', async () => {
    const vault = createTokenVault(KEY);
    const encrypted = await vault.encrypt(SHOP, TOKEN);

    expect(encrypted).toMatchObject({ keyVersion: 1 });
    expect(encrypted.ciphertext).not.toContain(TOKEN);
    await expect(vault.decrypt(SHOP, encrypted)).resolves.toBe(TOKEN);
  });

  it('binds ciphertext to the shop and rejects tampering', async () => {
    const vault = createTokenVault(KEY);
    const encrypted = await vault.encrypt(SHOP, TOKEN);

    await expect(vault.decrypt('other.myshopify.com', encrypted)).rejects.toThrow('authentication');
    await expect(vault.decrypt(SHOP, {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -4)}AAAA`,
    })).rejects.toThrow('authentication');
  });

  it('cryptographically separates offline tokens from function signing secrets', async () => {
    const signingVault = createTokenVault(KEY, { purpose: 'shopify-function-signing-secret' });
    const encrypted = await signingVault.encrypt(SHOP, TOKEN);

    await expect(createTokenVault(KEY).decrypt(SHOP, encrypted)).rejects.toThrow('authentication');
    await expect(signingVault.decrypt(SHOP, encrypted)).resolves.toBe(TOKEN);
  });

  it('rejects malformed keys and tokens', async () => {
    expect(() => createTokenVault('short')).toThrow();
    const vault = createTokenVault(KEY);
    await expect(vault.encrypt(SHOP, 'short')).rejects.toThrow();
  });
});
