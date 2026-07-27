import { createDesignAssetsHandler } from './designAssets.js';
import { createAppProxyHandler } from './shopify/appProxy.js';
import { createCartQuotesHandler } from './shopify/cartQuotes.js';

const CART_QUOTES_PATH = '/api/cart-quotes';
const CART_HANDOFF_PATH = '/apps/jersey-configurator/cart-handoff';

export function createWorkerHandler(env, dependencies = {}) {
  const cartQuotesHandler = resolveHandler(
    dependencies.cartQuotesHandler,
    dependencies.createCartQuotesHandler,
    createCartQuotesHandler,
    env,
  );
  const appProxyHandler = resolveHandler(
    dependencies.appProxyHandler,
    dependencies.createAppProxyHandler,
    createAppProxyHandler,
    env,
  );
  const designAssetsHandler = resolveHandler(
    dependencies.designAssetsHandler,
    dependencies.createDesignAssetsHandler,
    createDesignAssetsHandler,
    env,
  );

  return function handleWorkerRequest(request) {
    const pathname = new URL(request.url).pathname;
    if (request.method === 'POST' && pathname === CART_QUOTES_PATH) return cartQuotesHandler(request);
    if (request.method === 'GET' && pathname === CART_HANDOFF_PATH) return appProxyHandler(request);
    return designAssetsHandler(request);
  };
}

function resolveHandler(handler, factory, defaultFactory, env) {
  if (handler !== undefined) return handler;
  return (factory ?? defaultFactory)(env);
}
