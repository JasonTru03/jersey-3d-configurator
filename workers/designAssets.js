const LEGACY_ATLAS_PATH = /^\/api\/design-assets\/(dsg_[A-Za-z0-9_-]{16,64})\/atlas\.png$/u;

export function createDesignAssetsHandler(env) {
  return async function handleDesignAssets(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/design-assets') {
      return json(
        { error: 'Legacy design asset uploads are no longer available.' },
        410,
      );
    }
    const historical = request.method === 'GET' ? LEGACY_ATLAS_PATH.exec(url.pathname) : null;
    if (historical) return getHistoricalAtlas(historical[1], env);
    return env.ASSETS?.fetch
      ? env.ASSETS.fetch(request)
      : new Response('Not found', { status: 404 });
  };
}

async function getHistoricalAtlas(designId, env) {
  if (typeof env.DESIGN_ASSETS?.get !== 'function') {
    return new Response('Not found', { status: 404 });
  }
  const object = await env.DESIGN_ASSETS.get(`design-assets/${designId}/atlas.png`);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

function json(value, status) {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
