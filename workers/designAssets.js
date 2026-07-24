const MAX_ATLAS_BYTES = 12 * 1024 * 1024;
const MAX_UPLOADS_PER_MINUTE = 10;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function createDesignAssetsHandler(env) {
  return async function handleDesignAssets(request) {
    const url = new URL(request.url);
    if (isLocalProductionFilesMode(env) && url.pathname.startsWith('/api/design-assets')) return localProductionFilesUnavailable();
    if (request.method === 'GET' && url.pathname === '/api/design-assets/config') return publicConfig(env);
    if (request.method === 'POST' && url.pathname === '/api/design-assets') return uploadDesignAsset(request, env, url);
    if (request.method === 'GET' && /^\/api\/design-assets\/[\w-]+\/atlas\.png$/.test(url.pathname)) return getAtlas(url, env);
    return env.ASSETS.fetch(request);
  };
}

function isLocalProductionFilesMode(env) {
  return env.LOCAL_PRODUCTION_FILES === true || env.LOCAL_PRODUCTION_FILES === 'true';
}

function localProductionFilesUnavailable() {
  return json({ error: 'Design asset storage is unavailable in LOCAL_PRODUCTION_FILES mode.' }, 503);
}

async function uploadDesignAsset(request, env, url) {
  if (!env.DESIGN_UPLOAD_RATE_LIMIT) return json({ error: 'Design uploads are temporarily unavailable.' }, 503);
  if (!request.headers.get('content-type')?.includes('multipart/form-data')) return json({ error: 'Expected multipart form data.' }, 415);
  const form = await request.formData();
  const atlas = form.get('atlas'); const design = form.get('design'); const metadata = form.get('metadata'); const turnstileToken = form.get('turnstileToken');
  if (!atlas || !design || typeof atlas.arrayBuffer !== 'function' || typeof atlas.slice !== 'function' || typeof design.text !== 'function' || typeof metadata !== 'string') return json({ error: 'atlas, design, and metadata are required.' }, 400);
  if (atlas.size === 0 || atlas.size > MAX_ATLAS_BYTES || !await isPng(atlas)) return json({ error: 'atlas must be a PNG no larger than 12 MiB.' }, 400);
  if (typeof turnstileToken !== 'string' || turnstileToken.length === 0) return json({ error: 'Turnstile verification is required.' }, 403);
  if (!await verifyTurnstile(turnstileToken, request.headers.get('cf-connecting-ip'), env)) return json({ error: 'Turnstile verification failed.' }, 403);
  if (!await enforceRateLimit(request.headers.get('cf-connecting-ip'), env.DESIGN_UPLOAD_RATE_LIMIT)) return json({ error: 'Upload rate limit exceeded.' }, 429);
  let parsedDesign; let parsedMetadata;
  try { parsedDesign = JSON.parse(await design.text()); parsedMetadata = JSON.parse(metadata); } catch { return json({ error: 'design and metadata must be valid JSON.' }, 400); }
  if (!isConsistentDesignUpload(parsedDesign, parsedMetadata)) return json({ error: 'design and metadata must contain matching bottom-pattern bake fields.' }, 400);
  const designId = `dsg_${crypto.randomUUID()}`; const bytes = await atlas.arrayBuffer(); const sha256 = await sha256Hex(bytes); const prefix = `design-assets/${designId}`;
  await env.DESIGN_ASSETS.put(`${prefix}/atlas.png`, bytes, { httpMetadata: { contentType: 'image/png' }, customMetadata: { sha256 } });
  await env.DESIGN_ASSETS.put(`${prefix}/design.json`, JSON.stringify(parsedDesign), { httpMetadata: { contentType: 'application/json' } });
  await env.DESIGN_ASSETS.put(`${prefix}/metadata.json`, JSON.stringify(parsedMetadata), { httpMetadata: { contentType: 'application/json' } });
  return json({ designId, url: `${url.origin}/api/design-assets/${designId}/atlas.png`, sha256, size: atlas.size, version: parsedMetadata.projectionVersion }, 201);
}

function publicConfig(env) {
  if (typeof env.TURNSTILE_SITE_KEY !== 'string' || env.TURNSTILE_SITE_KEY.length === 0) return json({ error: 'Design uploads are not configured.' }, 503);
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY });
}

async function verifyTurnstile(token, remoteip, env) {
  if (typeof env.TURNSTILE_SECRET_KEY !== 'string' || env.TURNSTILE_SECRET_KEY.length === 0) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }); if (remoteip) body.set('remoteip', remoteip);
  try { const response = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }); return response.ok && (await response.json()).success === true; } catch { return false; }
}

async function enforceRateLimit(ip, rateLimit) {
  if (typeof ip !== 'string' || ip.length === 0) return false;
  const key = `design-upload:${ip}:${Math.floor(Date.now() / 60_000)}`; const count = Number.parseInt(await rateLimit.get(key), 10) || 0;
  if (count >= MAX_UPLOADS_PER_MINUTE) return false;
  await rateLimit.put(key, String(count + 1), { expirationTtl: 120 }); return true;
}

function isConsistentDesignUpload(design, metadata) {
  if (!isPlainObject(design) || design.format !== 'jersey-design' || ![2, 3].includes(design.version) || typeof design.productId !== 'string' || design.productId.length === 0 || !isPlainObject(design.state) || !isValidBakeMetadata(metadata)) return false;
  const pattern = design.state.overrides?.bottomPattern;
  return isPlainObject(pattern) && pattern.enabled === true && isPlainObject(pattern.source) && typeof pattern.source.assetRef === 'string'
    && pattern.source.assetRef === metadata.sourceHash && pattern.projectionVersion === metadata.projectionVersion && pattern.modelProjectionId === metadata.projectionId
    && sameValue(pattern.transform, metadata.transform) && sameValue(pattern.bakeMetadata, metadata);
}

function isValidBakeMetadata(metadata) {
  return isPlainObject(metadata) && metadata.atlasSize === 2048 && metadata.projectionVersion === 1 && typeof metadata.sourceHash === 'string' && metadata.sourceHash.length > 0 && typeof metadata.bakeKey === 'string' && metadata.bakeKey.length > 0 && typeof metadata.projectionId === 'string' && metadata.projectionId.length > 0 && isValidTransform(metadata.transform);
}
function isValidTransform(transform) { return isPlainObject(transform) && isPlainObject(transform.offset) && Number.isFinite(transform.offset.u) && Number.isFinite(transform.offset.v) && Number.isFinite(transform.scale) && Number.isFinite(transform.rotationDeg) && isPlainObject(transform.repeat) && Number.isFinite(transform.repeat.u) && Number.isFinite(transform.repeat.v); }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function sameValue(left, right) { return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right)); }
function canonicalize(value) { if (Array.isArray(value)) return value.map(canonicalize); if (isPlainObject(value)) return Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: canonicalize(value[key]) }), {}); return value; }

async function getAtlas(url, env) {
  const designId = url.pathname.split('/')[3]; const object = await env.DESIGN_ASSETS.get(`design-assets/${designId}/atlas.png`);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'image/png', 'cache-control': 'public, max-age=31536000, immutable' } });
}
async function isPng(file) { if (file.type === 'image/png') return true; if (file.type) return false; const bytes = new Uint8Array(await file.slice(0, PNG_SIGNATURE.length).arrayBuffer()); return bytes.length === PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value); }
async function sha256Hex(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function json(value, status = 200) { return Response.json(value, { status, headers: { 'cache-control': 'no-store' } }); }
