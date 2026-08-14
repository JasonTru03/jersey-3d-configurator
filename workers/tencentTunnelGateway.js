import { connect } from 'cloudflare:sockets';

const TCP_WRITE_CHUNK_BYTES = 64 * 1024;

export default {
  async fetch(request, env) {
    const origin = readUpstreamOrigin(env.TENCENT_ORIGIN);
    const gatewaySecret = readGatewaySecret(env.TENCENT_GATEWAY_SECRET);
    if (!origin || !gatewaySecret) {
      return new Response('Service unavailable', { status: 503 });
    }

    const incomingUrl = new URL(request.url);
    const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, origin);
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.set('x-forwarded-host', incomingUrl.host);
    headers.set('x-forwarded-proto', incomingUrl.protocol.slice(0, -1));
    headers.set('x-jersey-gateway-secret', gatewaySecret);
    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }

    try {
      const response = isPinnedTcpOrigin(origin)
        ? await fetchOverTcp(request, upstreamUrl, headers, gatewaySecret, env)
        : await fetch(new Request(upstreamUrl, init));
      return rewriteUpstreamRedirect(response, origin, incomingUrl.origin);
    } catch (error) {
      console.error('Tencent gateway request failed', error instanceof Error ? error.message : 'unknown');
      return new Response('Bad gateway', { status: 502 });
    }
  },
};

function readUpstreamOrigin(value) {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value);
    const isSecureOrigin = url.protocol === 'https:';
    const isPinnedHttpOrigin = url.protocol === 'http:'
      && url.hostname === '139.199.202.173'
      && url.port === '8080';
    if (
      (!isSecureOrigin && !isPinnedHttpOrigin)
      || url.origin !== value
      || url.pathname !== '/'
      || url.username
      || url.password
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isPinnedTcpOrigin(origin) {
  return origin === 'http://139.199.202.173:8080';
}

async function fetchOverTcp(request, upstreamUrl, forwardedHeaders, gatewaySecret, env) {
  const connector = env.__CONNECT ?? connect;
  const socket = connector(
    { hostname: '139.199.202.173', port: 8080 },
    { secureTransport: 'off', allowHalfOpen: true },
  );
  await socket.opened;

  const headers = new Headers(forwardedHeaders);
  for (const name of ['connection', 'host', 'keep-alive', 'proxy-connection', 'te', 'trailer',
    'transfer-encoding', 'upgrade']) headers.delete(name);
  headers.set('host', '139.199.202.173');
  headers.set('connection', 'close');
  headers.set('x-jersey-gateway-secret', gatewaySecret);

  let body = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = new Uint8Array(await request.arrayBuffer());
    headers.set('content-length', String(body.byteLength));
  } else {
    headers.delete('content-length');
  }

  const requestHead = [
    `${request.method} ${upstreamUrl.pathname}${upstreamUrl.search} HTTP/1.0`,
    ...Array.from(headers, ([name, value]) => `${name}: ${value}`),
    '',
    '',
  ].join('\r\n');
  const writer = socket.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(requestHead));
    for (let offset = 0; offset < (body?.byteLength ?? 0); offset += TCP_WRITE_CHUNK_BYTES) {
      await writer.write(body.subarray(offset, offset + TCP_WRITE_CHUNK_BYTES));
    }
  } finally {
    writer.releaseLock();
  }

  return readHttpResponse(socket, request.method);
}

async function readHttpResponse(socket, requestMethod) {
  const reader = socket.readable.getReader();
  let buffered = new Uint8Array();
  let headerEnd = -1;
  while (headerEnd < 0) {
    const { done, value } = await reader.read();
    if (done) throw new Error('Upstream closed before sending response headers.');
    buffered = concatBytes(buffered, value);
    if (buffered.byteLength > 64 * 1024) throw new Error('Upstream headers are too large.');
    headerEnd = findHeaderEnd(buffered);
  }

  const headerText = new TextDecoder().decode(buffered.subarray(0, headerEnd));
  const [statusLine, ...headerLines] = headerText.split('\r\n');
  const statusMatch = /^HTTP\/1\.[01] ([1-5][0-9]{2})(?: (.*))?$/u.exec(statusLine ?? '');
  if (!statusMatch) throw new Error('Upstream returned an invalid status line.');
  const status = Number(statusMatch[1]);
  const responseHeaders = new Headers();
  for (const line of headerLines) {
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error('Upstream returned an invalid header.');
    responseHeaders.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  for (const name of ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'trailer', 'transfer-encoding', 'upgrade']) responseHeaders.delete(name);

  const hasBody = requestMethod !== 'HEAD' && status !== 204 && status !== 304;
  const initialBody = buffered.subarray(headerEnd + 4);
  const responseBody = hasBody ? new ReadableStream({
    start(controller) {
      if (initialBody.byteLength) controller.enqueue(initialBody);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        await socket.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await socket.close();
    },
  }) : null;
  if (!hasBody) {
    await reader.cancel();
    await socket.close();
  }
  return new Response(responseBody, {
    status,
    statusText: statusMatch[2] ?? '',
    headers: responseHeaders,
  });
}

function concatBytes(left, right) {
  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left);
  combined.set(right, left.byteLength);
  return combined;
}

function findHeaderEnd(bytes) {
  for (let index = 0; index <= bytes.byteLength - 4; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10
      && bytes[index + 2] === 13 && bytes[index + 3] === 10) return index;
  }
  return -1;
}

function readGatewaySecret(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 256) return null;
  return value;
}

function rewriteUpstreamRedirect(response, upstreamOrigin, publicOrigin) {
  const location = response.headers.get('Location');
  if (!location) return response;

  let target;
  try {
    target = new URL(location, upstreamOrigin);
  } catch {
    return response;
  }
  if (target.origin !== upstreamOrigin) return response;

  const headers = new Headers(response.headers);
  headers.set('Location', `${publicOrigin}${target.pathname}${target.search}${target.hash}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
