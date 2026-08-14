import { describe, expect, it, vi } from 'vitest';
import {
  createOAuthHandler,
  REQUESTED_SHOPIFY_SCOPES,
  REQUIRED_SHOPIFY_SCOPES,
} from './oauth.js';

const SHOP = 'oauth-test.myshopify.com';
const SECRET = 'oauth-test-secret-that-is-at-least-32';
const API_KEY = 'public-app-client-id';
const NOW = 1_700_000_000_000;
const STATE = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
  .replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
const TOKEN = 'shpat_offline_test_token_1234567890';
const HOST = 'YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvb2F1dGgtdGVzdA';

describe('Shopify OAuth authorization code flow', () => {
  it('verifies a signed install request and creates a bound offline authorization redirect', async () => {
    const runtime = createRuntime();
    const request = new Request(await signedUrl('/auth', {
      shop: SHOP,
      timestamp: String(NOW / 1000),
    }));

    const response = await runtime.handler(request);
    const location = new URL(response.headers.get('Location'));

    expect(response.status).toBe(302);
    expect(location.origin).toBe(`https://${SHOP}`);
    expect(location.pathname).toBe('/admin/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe(API_KEY);
    expect(location.searchParams.get('redirect_uri')).toBe('https://public.example/auth/callback');
    expect(location.searchParams.get('state')).toBe(STATE);
    expect(location.searchParams.get('scope')).toBe(REQUESTED_SHOPIFY_SCOPES.join(','));
    expect(REQUESTED_SHOPIFY_SCOPES).toEqual(expect.arrayContaining([
      'read_cart_transforms', 'read_validations',
    ]));
    expect(REQUIRED_SHOPIFY_SCOPES).not.toContain('read_cart_transforms');
    expect(REQUIRED_SHOPIFY_SCOPES).not.toContain('read_validations');
    expect(response.headers.get('Set-Cookie')).toContain('__Host-shopify_oauth_state=');
    expect(runtime.repository.createSession).toHaveBeenCalledWith(expect.objectContaining({
      shop: SHOP, createdAt: NOW, expiresAt: NOW + 600_000,
    }));
  });

  it('accepts Shopify canonical grants when write scopes imply the redundant read scopes', async () => {
    const runtime = createRuntime({ installation: {
      status: 'active', scopes: [...REQUIRED_SHOPIFY_SCOPES],
    } });
    const request = new Request(await signedUrl('/auth/callback', {
      code: 'authorization_code_1234',
      host: HOST,
      shop: SHOP,
      state: STATE,
      timestamp: String(NOW / 1000),
    }), {
      headers: { Cookie: `__Host-shopify_oauth_state=${STATE}` },
    });

    const response = await runtime.handler(request);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      `https://public.example/app?shop=${SHOP}&host=${HOST}`,
    );
    expect(runtime.repository.consumeSession).toHaveBeenCalledWith(expect.objectContaining({ shop: SHOP }));
    expect(runtime.fetch).toHaveBeenCalledWith(
      `https://${SHOP}/admin/oauth/access_token`,
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
    expect(runtime.vault.encrypt).toHaveBeenCalledWith(SHOP, TOKEN);
    expect(runtime.repository.saveInstallation).toHaveBeenCalledWith({
      shop: SHOP,
      status: 'active',
      ciphertext: 'encrypted-token-value-AAAAAAAAAAAA',
      iv: 'AAAAAAAAAAAAAAAA',
      keyVersion: 1,
      scopes: [...REQUIRED_SHOPIFY_SCOPES],
      installedAt: NOW,
    });
    expect(JSON.stringify(runtime.repository.saveInstallation.mock.calls)).not.toContain(TOKEN);
    expect(response.headers.get('Set-Cookie')).toContain('__Host-shopify_app_session=');

    const sessionCookie = response.headers.get('Set-Cookie').split(';')[0];
    const appResponse = await runtime.handler(new Request(response.headers.get('Location'), {
      headers: { Cookie: sessionCookie },
    }));
    expect(appResponse.status).toBe(200);
    const appHtml = await appResponse.text();
    expect(appHtml).toContain('3D 球衣定制管理');
    expect(appHtml).toContain('v1.0.0');
    expect(appHtml).toContain(SHOP);

    const tamperedCookie = `${sessionCookie.slice(0, -1)}0`;
    const rejected = await runtime.handler(new Request(response.headers.get('Location'), {
      headers: { Cookie: tamperedCookie },
    }));
    expect(rejected.status).toBe(401);
  });

  it('stores but blocks an installation missing required scopes', async () => {
    const runtime = createRuntime({ scopes: ['read_orders'] });
    const response = await runtime.handler(new Request(await signedUrl('/auth/callback', {
      code: 'authorization_code_1234', host: HOST, shop: SHOP, state: STATE,
      timestamp: String(NOW / 1000),
    }), { headers: { Cookie: `__Host-shopify_oauth_state=${STATE}` } }));

    expect(response.status).toBe(403);
    expect(runtime.repository.saveInstallation).toHaveBeenCalledWith(expect.objectContaining({
      status: 'scope_invalid', scopes: ['read_orders'],
    }));
  });

  it('rejects forged HMAC, stale timestamps and mismatched state before token exchange', async () => {
    const requests = [
      new Request(`https://public.example/auth?shop=${SHOP}&timestamp=${NOW / 1000}&hmac=${'0'.repeat(64)}`),
      new Request(await signedUrl('/auth', { shop: SHOP, timestamp: String(NOW / 1000 - 601) })),
      new Request(await signedUrl('/auth/callback', {
        code: 'authorization_code_1234', host: HOST, shop: SHOP, state: STATE,
        timestamp: String(NOW / 1000),
      }), { headers: { Cookie: '__Host-shopify_oauth_state=different-state-value-12345678901234567890' } }),
    ];
    for (const request of requests) {
      const runtime = createRuntime();
      const response = await runtime.handler(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(runtime.fetch).not.toHaveBeenCalled();
      expect(runtime.repository.saveInstallation).not.toHaveBeenCalled();
    }
  });

  it('creates an app session and redirects an already active installation to the merchant console', async () => {
    const runtime = createRuntime({ installation: {
      status: 'active', scopes: [...REQUIRED_SHOPIFY_SCOPES],
    } });
    const response = await runtime.handler(new Request(await signedUrl('/auth', {
      host: HOST, shop: SHOP, timestamp: String(NOW / 1000),
    })));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      `https://public.example/app?shop=${SHOP}&host=${HOST}`,
    );
    expect(response.headers.get('Set-Cookie')).toContain('__Host-shopify_app_session=');
    expect(runtime.repository.createSession).not.toHaveBeenCalled();
  });
});

function createRuntime({ scopes = [...REQUIRED_SHOPIFY_SCOPES], installation = null } = {}) {
  const repository = {
    createSession: vi.fn(async () => undefined),
    consumeSession: vi.fn(async () => undefined),
    getInstallation: vi.fn(async () => installation),
    saveInstallation: vi.fn(async () => undefined),
  };
  const vault = {
    encrypt: vi.fn(async () => ({
      ciphertext: 'encrypted-token-value-AAAAAAAAAAAA',
      iv: 'AAAAAAAAAAAAAAAA',
      keyVersion: 1,
    })),
  };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    access_token: TOKEN,
    scope: scopes.join(','),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const handler = createOAuthHandler({
    SHOPIFY_API_KEY: API_KEY,
    SHOPIFY_API_SECRET: SECRET,
    SHOPIFY_TOKEN_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
    PUBLIC_ORIGIN: 'https://public.example',
    PRODUCTION_DB: {},
  }, {
    createOAuthRepository: () => repository,
    createTokenVault: () => vault,
    fetch: fetchMock,
    now: () => NOW,
    randomBytes: () => new Uint8Array(32).fill(7),
    logger: { error: vi.fn() },
  });
  return { fetch: fetchMock, handler, repository, vault };
}

async function signedUrl(pathname, params) {
  const url = new URL(pathname, 'https://public.example');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const canonical = [...url.searchParams].map(([key, value]) => `${key}=${value}`).sort().join('&');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(canonical),
  ));
  url.searchParams.set('hmac', [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  return url.href;
}
