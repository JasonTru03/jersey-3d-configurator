const MAX_ATLAS_BYTES = 12 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function createDesignAssetsHandler(env) {
  return async function handleDesignAssets(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/design-assets') return uploadDesignAsset(request, env, url);
    if (request.method === 'GET' && /^\/api\/design-assets\/[\w-]+\/atlas\.png$/.test(url.pathname)) return getAtlas(url, env);
    return env.ASSETS.fetch(request);
  };
}

async function uploadDesignAsset(request, env, url) {
  if (!hasWriteAuthorization(request, env)) return json({ error: 'Unauthorized design asset write.' }, 401);
  if (!request.headers.get('content-type')?.includes('multipart/form-data')) return json({ error: 'Expected multipart form data.' }, 415);
  const form = await request.formData();
  const atlas = form.get('atlas');
  const design = form.get('design');
  const metadata = form.get('metadata');
  if (!atlas || !design || typeof atlas.arrayBuffer !== 'function' || typeof atlas.slice !== 'function' || typeof design.text !== 'function' || typeof metadata !== 'string') return json({ error: 'atlas, design, and metadata are required.' }, 400);
  if (atlas.size === 0 || atlas.size > MAX_ATLAS_BYTES || !await isPng(atlas)) return json({ error: 'atlas must be a PNG no larger than 12 MiB.' }, 400);

  let parsedDesign; let parsedMetadata;
  try { parsedDesign = JSON.parse(await design.text()); parsedMetadata = JSON.parse(metadata); } catch { return json({ error: 'design and metadata must be valid JSON.' }, 400); }
  if (!parsedDesign || typeof parsedDesign !== 'object' || !parsedMetadata || typeof parsedMetadata !== 'object') return json({ error: 'design and metadata must be JSON objects.' }, 400);
  if (parsedMetadata.atlasSize !== 2048 || parsedMetadata.projectionVersion !== 1) return json({ error: 'metadata must specify atlasSize 2048 and projectionVersion 1.' }, 400);

  const designId = `dsg_${crypto.randomUUID()}`;
  const bytes = await atlas.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const prefix = `design-assets/${designId}`;
  await env.DESIGN_ASSETS.put(`${prefix}/atlas.png`, bytes, { httpMetadata: { contentType: 'image/png' }, customMetadata: { sha256 } });
  await env.DESIGN_ASSETS.put(`${prefix}/design.json`, JSON.stringify(parsedDesign), { httpMetadata: { contentType: 'application/json' } });
  await env.DESIGN_ASSETS.put(`${prefix}/metadata.json`, JSON.stringify(parsedMetadata), { httpMetadata: { contentType: 'application/json' } });
  const atlasUrl = `${url.origin}/api/design-assets/${designId}/atlas.png`;
  return json({ designId, url: atlasUrl, sha256, size: atlas.size, version: parsedMetadata.projectionVersion }, 201);
}

function hasWriteAuthorization(request, env) {
  const token = env.DESIGN_ASSET_WRITE_TOKEN;
  return typeof token === 'string' && token.length > 0 && request.headers.get('authorization') === `Bearer ${token}`;
}

async function getAtlas(url, env) {
  const designId = url.pathname.split('/')[3];
  const object = await env.DESIGN_ASSETS.get(`design-assets/${designId}/atlas.png`);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/png', 'cache-control': 'public, max-age=31536000, immutable' } });
}

async function isPng(file) {
  if (file.type === 'image/png') return true;
  if (file.type) return false;
  const bytes = new Uint8Array(await file.slice(0, PNG_SIGNATURE.length).arrayBuffer());
  return bytes.length === PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}


async function sha256Hex(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function json(value, status = 200) { return Response.json(value, { status, headers: { 'cache-control': 'no-store' } }); }
