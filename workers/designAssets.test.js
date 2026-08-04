import { describe, expect, it, vi } from 'vitest';
import { createDesignAssetsHandler } from './designAssets.js';

const DESIGN_ID = 'dsg_11111111-1111-4111-8111-111111111111';

describe('legacy design asset compatibility', () => {
  it('retires the old POST upload route without reading the body or writing DESIGN_ASSETS', async () => {
    let bodyReads = 0;
    const designAssets = { put: vi.fn(), get: vi.fn() };
    const handler = createDesignAssetsHandler({ DESIGN_ASSETS: designAssets });
    const request = {
      method: 'POST',
      url: 'https://example.workers.dev/api/design-assets',
      headers: new Headers({ 'content-type': 'multipart/form-data; boundary=old' }),
      formData: vi.fn(),
    };
    Object.defineProperty(request, 'body', { get() { bodyReads += 1; return null; } });

    const response = await handler(request);

    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Legacy design asset uploads are no longer available.' });
    expect(request.formData).not.toHaveBeenCalled();
    expect(bodyReads).toBe(0);
    expect(designAssets.put).not.toHaveBeenCalled();
  });

  it('preserves read-only access to an exact historical atlas ID when the binding exists', async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.close(); } });
    const designAssets = {
      get: vi.fn(async () => ({
        body,
        httpMetadata: { contentType: 'image/png' },
      })),
    };
    const handler = createDesignAssetsHandler({ DESIGN_ASSETS: designAssets });

    const response = await handler(new Request(
      `https://example.workers.dev/api/design-assets/${DESIGN_ID}/atlas.png`,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(designAssets.get).toHaveBeenCalledWith(`design-assets/${DESIGN_ID}/atlas.png`);
  });

  it('returns 404 for a missing historical object or missing read binding', async () => {
    const missingObject = createDesignAssetsHandler({
      DESIGN_ASSETS: { get: vi.fn(async () => null) },
    });
    const missingBinding = createDesignAssetsHandler({});

    expect((await missingObject(new Request(
      `https://example.workers.dev/api/design-assets/${DESIGN_ID}/atlas.png`,
    ))).status).toBe(404);
    expect((await missingBinding(new Request(
      `https://example.workers.dev/api/design-assets/${DESIGN_ID}/atlas.png`,
    ))).status).toBe(404);
  });

  it.each([
    '/api/design-assets/../secret/atlas.png',
    '/api/design-assets/dsg_short/atlas.png',
    `/api/design-assets/${DESIGN_ID}/atlas.png/extra`,
    `/api/design-assets/${encodeURIComponent('../secret')}/atlas.png`,
  ])('does not turn unsafe or non-exact historical paths into R2 keys: %s', async (pathname) => {
    const assetsResponse = new Response('static fallback');
    const env = {
      DESIGN_ASSETS: { get: vi.fn() },
      ASSETS: { fetch: vi.fn(() => assetsResponse) },
    };
    const handler = createDesignAssetsHandler(env);
    const response = await handler(new Request(`https://example.workers.dev${pathname}`));

    expect(response).toBe(assetsResponse);
    expect(env.DESIGN_ASSETS.get).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/api/design-assets/config'],
    ['GET', '/api/design-assets'],
    ['POST', '/api/design-assets/extra'],
    ['PUT', `/api/design-assets/${DESIGN_ID}/atlas.png`],
    ['GET', '/assets/app.js'],
  ])('keeps static ASSETS.fetch as the final fallback for %s %s', async (method, pathname) => {
    const assetsResponse = new Response('static fallback');
    const env = { ASSETS: { fetch: vi.fn(() => assetsResponse) } };
    const handler = createDesignAssetsHandler(env);
    const request = new Request(`https://example.workers.dev${pathname}`, { method });

    expect(await handler(request)).toBe(assetsResponse);
    expect(env.ASSETS.fetch).toHaveBeenCalledWith(request);
  });

  it('returns a plain 404 when no static binding handles the final fallback', async () => {
    const response = await createDesignAssetsHandler({})(
      new Request('https://example.workers.dev/favicon.ico'),
    );
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('Not found');
  });

  it('does not disable historical reads merely because new production uploads are local-only', async () => {
    const env = {
      LOCAL_PRODUCTION_FILES: 'true',
      DESIGN_ASSETS: {
        get: vi.fn(async () => ({ body: 'png', httpMetadata: { contentType: 'image/png' } })),
      },
    };
    const response = await createDesignAssetsHandler(env)(new Request(
      `https://example.workers.dev/api/design-assets/${DESIGN_ID}/atlas.png`,
    ));
    expect(response.status).toBe(200);
  });
});
