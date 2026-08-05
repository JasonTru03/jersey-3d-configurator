import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export function createNodeHttpServer({ handler, publicOrigin, trustProxy = false, logger = console }) {
  if (typeof handler !== 'function') throw new TypeError('Fetch handler is required.');
  const origin = normalizeOrigin(publicOrigin);
  if (typeof trustProxy !== 'boolean') throw new TypeError('Trust proxy setting is invalid.');

  const server = createServer((incoming, outgoing) => {
    void handleIncoming({ handler, incoming, logger, origin, outgoing, trustProxy });
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 5 * 60_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;
  return server;
}

async function handleIncoming({ handler, incoming, logger, origin, outgoing, trustProxy }) {
  if (incoming.url === '/healthz' && incoming.method === 'GET') {
    writeJson(outgoing, 200, { ok: true });
    return;
  }
  try {
    const headers = requestHeaders(incoming);
    const clientIp = readClientIp(incoming, trustProxy);
    if (clientIp) headers.set('cf-connecting-ip', clientIp);
    const method = incoming.method ?? 'GET';
    const init = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = Readable.toWeb(incoming);
      init.duplex = 'half';
    }
    const request = new Request(new URL(incoming.url ?? '/', origin), init);
    const response = await handler(request);
    await writeResponse(outgoing, response);
  } catch (error) {
    logError(logger, error);
    if (!outgoing.headersSent) writeJson(outgoing, 500, { error: 'Internal server error.' });
    else outgoing.destroy();
  }
}

function requestHeaders(incoming) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

function readClientIp(incoming, trustProxy) {
  if (trustProxy) {
    const forwarded = incoming.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first && isIP(first)) return first;
  }
  const remote = incoming.socket.remoteAddress ?? '';
  const normalized = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
  return isIP(normalized) ? normalized : null;
}

async function writeResponse(outgoing, response) {
  if (!(response instanceof Response)) throw new TypeError('Fetch handler returned an invalid response.');
  outgoing.statusCode = response.status;
  for (const [name, value] of response.headers) outgoing.setHeader(name, value);
  if (!response.body) {
    outgoing.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const stream = Readable.fromWeb(response.body);
    stream.once('error', reject);
    outgoing.once('error', reject);
    outgoing.once('finish', resolve);
    stream.pipe(outgoing);
  });
}

function writeJson(response, status, body) {
  const value = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(value),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(value);
}

function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Public origin is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) {
    throw new TypeError('Public origin must contain only scheme and host.');
  }
  return url.origin;
}

function logError(logger, error) {
  try {
    logger?.error?.('SERVER_REQUEST_FAILED', error?.name ?? 'Error');
  } catch {
    // Request responses do not depend on logger availability.
  }
}
