// @vitest-environment node

import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createAdminPasswordHash } from './adminAuth.js';
import { createAdminPortal } from './adminPortal.js';

const SHOP = 'test.myshopify.com';
const SECOND_SHOP = 'second.myshopify.com';
const SESSION_SECRET = 'admin-session-secret-'.padEnd(40, 's');
const PASSWORD = 'Correct horse battery staple';
let passwordHash;

beforeAll(async () => {
  passwordHash = await createAdminPasswordHash(PASSWORD, {
    randomBytes: () => Buffer.alloc(16, 5),
  });
});

describe('independent admin portal', () => {
  it('serves the private portal shell without exposing data and rejects unauthenticated APIs', async () => {
    const portal = createPortal();

    const redirect = await portal(new Request('https://jersey.example/admin'));
    const page = await portal(new Request('https://jersey.example/admin/'));
    const orders = await portal(new Request('https://jersey.example/admin/api/orders'));
    const download = await portal(new Request(
      'https://jersey.example/admin/api/orders/dsg_1234567890abcdef/download',
    ));

    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('/admin/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await page.text()).toContain('球衣定制订单后台');
    expect(await (await portal(new Request('https://jersey.example/admin/admin.js'))).text())
      .toContain("document.querySelector('#shop')");
    expect(orders.status).toBe(401);
    expect(download.status).toBe(401);
  });

  it('logs in with a signed cookie, lists orders and clears the session on logout', async () => {
    const listOrders = vi.fn(() => ({ items: [], total: 0, page: 1, pageSize: 50 }));
    const portal = createPortal({ repository: repository({ listOrders }) });

    const badLogin = await login(portal, 'wrong password');
    const goodLogin = await login(portal, PASSWORD);
    const cookie = goodLogin.headers.get('set-cookie').split(';')[0];
    const session = await portal(new Request('https://jersey.example/admin/api/session', {
      headers: { cookie },
    }));
    const orders = await portal(new Request(
      'https://jersey.example/admin/api/orders?q=1001&status=paid_pending_production&from=1000&to=2000&page=2',
      { headers: { cookie } },
    ));
    const logout = await portal(new Request('https://jersey.example/admin/api/logout', {
      method: 'POST',
      headers: { cookie },
    }));

    expect(badLogin.status).toBe(401);
    expect(goodLogin.status).toBe(204);
    expect(cookie).toMatch(/^__Host-jersey_admin=/u);
    expect(await session.json()).toEqual({
      authenticated: true,
      shop: SHOP,
      shops: [SHOP, SECOND_SHOP],
    });
    expect(orders.status).toBe(200);
    expect(await orders.json()).toEqual({ items: [], total: 0, page: 1, pageSize: 50 });
    expect(listOrders).toHaveBeenCalledWith({
      shop: SHOP,
      query: '1001',
      status: 'paid_pending_production',
      from: 1_000,
      to: 2_000,
      page: 2,
      pageSize: 50,
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('lists only the selected configured shop and rejects unknown shops', async () => {
    const listOrders = vi.fn(() => ({ items: [], total: 0, page: 1, pageSize: 50 }));
    const portal = createPortal({ repository: repository({ listOrders }) });
    const cookie = (await login(portal, PASSWORD)).headers.get('set-cookie').split(';')[0];

    const selected = await portal(new Request(
      `https://jersey.example/admin/api/orders?shop=${SECOND_SHOP}`,
      { headers: { cookie } },
    ));
    const unknown = await portal(new Request(
      'https://jersey.example/admin/api/orders?shop=unknown.myshopify.com',
      { headers: { cookie } },
    ));

    expect(selected.status).toBe(200);
    expect(listOrders).toHaveBeenCalledWith(expect.objectContaining({ shop: SECOND_SHOP }));
    expect(unknown.status).toBe(400);
    expect(listOrders).toHaveBeenCalledTimes(1);
  });

  it('scopes downloads to the selected configured shop', async () => {
    const getOrderFile = vi.fn(() => null);
    const portal = createPortal({ repository: repository({ getOrderFile }) });
    const cookie = (await login(portal, PASSWORD)).headers.get('set-cookie').split(';')[0];

    const selected = await portal(new Request(
      `https://jersey.example/admin/api/orders/dsg_1234567890abcdef/download?shop=${SECOND_SHOP}`,
      { headers: { cookie } },
    ));
    const unknown = await portal(new Request(
      'https://jersey.example/admin/api/orders/dsg_1234567890abcdef/download?shop=unknown.myshopify.com',
      { headers: { cookie } },
    ));

    expect(selected.status).toBe(404);
    expect(getOrderFile).toHaveBeenCalledWith({
      designId: 'dsg_1234567890abcdef',
      shop: SECOND_SHOP,
    });
    expect(unknown.status).toBe(400);
    expect(getOrderFile).toHaveBeenCalledTimes(1);
  });

  it('streams the order ZIP only after authentication and records the download', async () => {
    const body = Buffer.from('test-production-zip');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const checksum = Buffer.from(sha256, 'hex');
    const recordDownload = vi.fn();
    const portal = createPortal({
      assets: {
        get: vi.fn(async () => ({
          size: body.byteLength,
          checksums: {
            sha256: checksum.buffer.slice(
              checksum.byteOffset,
              checksum.byteOffset + checksum.byteLength,
            ),
          },
          body: new Blob([body]).stream(),
        })),
      },
      repository: repository({
        getOrderFile: vi.fn(() => ({
          designId: 'dsg_1234567890abcdef',
          status: 'paid_pending_production',
          orderName: '#1001',
          bundleKey: 'shops/test/design.zip',
          bundleFilename: 'fn8788-jersey-design-12345678.zip',
          bundleBytes: body.byteLength,
          bundleSha256: sha256,
        })),
        recordDownload,
      }),
    });
    const cookie = (await login(portal, PASSWORD)).headers.get('set-cookie').split(';')[0];

    const response = await portal(new Request(
      'https://jersey.example/admin/api/orders/dsg_1234567890abcdef/download',
      { headers: { cookie } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition'))
      .toContain('fn8788-jersey-design-12345678.zip');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
    expect(recordDownload).toHaveBeenCalledWith({
      designId: 'dsg_1234567890abcdef',
      downloadedAt: 10_000,
      outcome: 'started',
      shop: SHOP,
    });
  });

  it('returns a clear conflict and audits a missing order file', async () => {
    const recordDownload = vi.fn();
    const portal = createPortal({
      assets: { get: vi.fn(async () => null) },
      repository: repository({ recordDownload }),
    });
    const cookie = (await login(portal, PASSWORD)).headers.get('set-cookie').split(';')[0];

    const response = await portal(new Request(
      'https://jersey.example/admin/api/orders/dsg_1234567890abcdef/download',
      { headers: { cookie } },
    ));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: '生产 ZIP 文件缺失，请检查服务器存储。' });
    expect(recordDownload).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'missing' }));
  });

  it('does not download an order already marked with a file error', async () => {
    const recordDownload = vi.fn();
    const get = vi.fn(async () => {
      throw new Error('must not read a file-error object');
    });
    const portal = createPortal({
      assets: { get },
      repository: repository({
        getOrderFile: vi.fn(() => ({
          ...repository().getOrderFile(),
          status: 'file_error',
        })),
        recordDownload,
      }),
    });
    const cookie = (await login(portal, PASSWORD)).headers.get('set-cookie').split(';')[0];

    const response = await portal(new Request(
      'https://jersey.example/admin/api/orders/dsg_1234567890abcdef/download',
      { headers: { cookie } },
    ));

    expect(response.status).toBe(409);
    expect(get).not.toHaveBeenCalled();
    expect(recordDownload).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'invalid' }));
  });

  it('rejects and audits an indexed object whose checksum does not match the order', async () => {
    const body = Buffer.from('wrong-production-zip');
    const checksum = createHash('sha256').update(body).digest();
    const recordDownload = vi.fn();
    const portal = createPortal({
      assets: {
        get: vi.fn(async () => ({
          size: body.byteLength,
          checksums: {
            sha256: checksum.buffer.slice(
              checksum.byteOffset,
              checksum.byteOffset + checksum.byteLength,
            ),
          },
          body: new Blob([body]).stream(),
        })),
      },
      repository: repository({
        getOrderFile: vi.fn(() => ({
          ...repository().getOrderFile(),
          bundleBytes: body.byteLength,
          bundleSha256: 'a'.repeat(64),
        })),
        recordDownload,
      }),
    });
    const cookie = (await login(portal, PASSWORD)).headers.get('set-cookie').split(';')[0];

    const response = await portal(new Request(
      'https://jersey.example/admin/api/orders/dsg_1234567890abcdef/download',
      { headers: { cookie } },
    ));

    expect(response.status).toBe(409);
    expect(recordDownload).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'invalid' }));
  });

  it('stops reading an oversized chunked login body', async () => {
    const portal = createPortal();
    const response = await portal(new Request('https://jersey.example/admin/api/login', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '127.0.0.1',
        'content-type': 'application/json',
      },
      body: new Uint8Array(4097),
    }));

    expect(response.status).toBe(413);
  });

  it('rate limits repeated login attempts without failing open', async () => {
    const portal = createPortal({
      rateLimit: { limit: vi.fn(async () => ({ success: false })) },
    });

    const response = await login(portal, PASSWORD);

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('300');
  });
});

function createPortal({
  assets = { get: vi.fn(async () => null) },
  rateLimit = { limit: vi.fn(async () => ({ success: true })) },
  repository: adminRepository = repository(),
} = {}) {
  return createAdminPortal({
    assets,
    config: {
      adminPasswordHash: passwordHash,
      adminSessionSecret: SESSION_SECRET,
      adminShop: SHOP,
      adminShops: [SHOP, SECOND_SHOP],
    },
    loginRateLimit: rateLimit,
    now: () => 10_000,
    randomBytes: () => Buffer.alloc(16, 4),
    repository: adminRepository,
  });
}

function repository(overrides = {}) {
  return {
    listShops: vi.fn((fallback) => [...fallback]),
    listOrders: vi.fn(() => ({ items: [], total: 0, page: 1, pageSize: 50 })),
    getOrderFile: vi.fn(() => ({
      designId: 'dsg_1234567890abcdef',
      status: 'paid_pending_production',
      orderName: '#1001',
      bundleKey: 'shops/test/design.zip',
      bundleFilename: 'fn8788-jersey-design-12345678.zip',
      bundleBytes: 10,
      bundleSha256: 'a'.repeat(64),
    })),
    recordDownload: vi.fn(),
    ...overrides,
  };
}

function login(portal, password) {
  return portal(new Request('https://jersey.example/admin/api/login', {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '127.0.0.1',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password }),
  }));
}
