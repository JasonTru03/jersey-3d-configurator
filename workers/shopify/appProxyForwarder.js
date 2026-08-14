import { verifyAppProxySignature } from './appProxy.js';

const CART_HANDOFF_PATH = '/apps/jersey-configurator/cart-handoff';

export function createAppProxyForwardingHandler(env) {
  const upstreamOrigin = readUpstreamOrigin(env?.APP_PROXY_UPSTREAM_ORIGIN);

  return async function forwardAppProxyRequest(request) {
    const incomingUrl = new URL(request.url);
    if (request.method !== 'GET' || incomingUrl.pathname !== CART_HANDOFF_PATH) {
      return new Response('Not found', { status: 404 });
    }
    if (!upstreamOrigin) return new Response('Service unavailable', { status: 503 });

    const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, upstreamOrigin);
    try {
      const signatureValid = await verifyForwardedSignature(incomingUrl, env?.SHOPIFY_API_SECRET);
      const response = await fetch(new Request(upstreamUrl, request), { redirect: 'manual' });
      console.log(JSON.stringify({
        event: 'APP_PROXY_FORWARD',
        parameterNames: [...new Set(incomingUrl.searchParams.keys())].sort(),
        signatureValid,
        upstreamStatus: response.status,
      }));
      return response;
    } catch {
      return new Response('Bad gateway', { status: 502 });
    }
  };
}

async function verifyForwardedSignature(url, secret) {
  try {
    return await verifyAppProxySignature(url, secret);
  } catch {
    return false;
  }
}

function readUpstreamOrigin(value) {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
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
