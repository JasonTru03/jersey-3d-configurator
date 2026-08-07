// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  ADMIN_COOKIE_NAME,
  createAdminPasswordHash,
  createAdminSessionCookie,
  verifyAdminPassword,
  verifyAdminSessionCookie,
} from './adminAuth.js';

const SHOP = 'test.myshopify.com';
const SESSION_SECRET = 'session-secret-'.padEnd(40, 's');

describe('independent admin authentication', () => {
  it('uses a salted scrypt hash and rejects an incorrect password', async () => {
    const encoded = await createAdminPasswordHash('Correct horse battery staple', {
      randomBytes: () => Buffer.alloc(16, 7),
    });

    expect(encoded).toMatch(/^scrypt\$16384\$8\$1\$/u);
    await expect(verifyAdminPassword('Correct horse battery staple', encoded)).resolves.toBe(true);
    await expect(verifyAdminPassword('incorrect password', encoded)).resolves.toBe(false);
  });

  it('accepts an untampered session only for its configured shop before expiry', () => {
    const cookie = createAdminSessionCookie({
      now: 1_000,
      randomBytes: () => Buffer.alloc(16, 3),
      secret: SESSION_SECRET,
      shop: SHOP,
      ttlSeconds: 300,
    });

    expect(cookie).toContain(`${ADMIN_COOKIE_NAME}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(verifyAdminSessionCookie(cookie.split(';')[0], {
      now: 300_999,
      secret: SESSION_SECRET,
      shop: SHOP,
    })).toEqual({ shop: SHOP, expiresAt: 301_000 });
    expect(verifyAdminSessionCookie(cookie.split(';')[0], {
      now: 301_000,
      secret: SESSION_SECRET,
      shop: SHOP,
    })).toBeNull();
    expect(verifyAdminSessionCookie(cookie.split(';')[0], {
      now: 2_000,
      secret: SESSION_SECRET,
      shop: 'other.myshopify.com',
    })).toBeNull();
  });

  it('rejects a tampered or malformed session cookie', () => {
    const cookie = createAdminSessionCookie({
      now: 5_000,
      randomBytes: () => Buffer.alloc(16, 9),
      secret: SESSION_SECRET,
      shop: SHOP,
      ttlSeconds: 300,
    }).split(';')[0];
    const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('a') ? 'b' : 'a'}`;

    expect(verifyAdminSessionCookie(tampered, {
      now: 6_000,
      secret: SESSION_SECRET,
      shop: SHOP,
    })).toBeNull();
    expect(verifyAdminSessionCookie('not-a-cookie', {
      now: 6_000,
      secret: SESSION_SECRET,
      shop: SHOP,
    })).toBeNull();
  });
});
