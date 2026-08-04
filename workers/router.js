import { createDesignAssetsHandler } from './designAssets.js';
import { createProductionDraftsHandler } from './production/productionDrafts.js';
import { createAppProxyHandler } from './shopify/appProxy.js';
import { createCartQuotesHandler } from './shopify/cartQuotes.js';
import { createOrderLifecycleWebhooksHandler } from './shopify/orderLifecycleWebhooks.js';

const CART_QUOTES_PATH = '/api/cart-quotes';
const CART_HANDOFF_PATH = '/apps/jersey-configurator/cart-handoff';
const ORDER_LIFECYCLE_WEBHOOKS_PATH = '/webhooks/shopify/orders';
const PRODUCTION_DRAFTS_PATH = '/api/production-drafts';
const PRODUCTION_DRAFTS_CONFIG_PATH = '/api/production-drafts/config';

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
  const orderLifecycleWebhooksHandler = resolveHandler(
    dependencies.orderLifecycleWebhooksHandler,
    dependencies.createOrderLifecycleWebhooksHandler,
    createOrderLifecycleWebhooksHandler,
    env,
  );
  const productionDraftsHandler = resolveHandler(
    dependencies.productionDraftsHandler,
    dependencies.createProductionDraftsHandler,
    createProductionDraftsHandler,
    env,
  );

  return function handleWorkerRequest(request) {
    const pathname = new URL(request.url).pathname;
    if (request.method === 'POST' && pathname === CART_QUOTES_PATH) return cartQuotesHandler(request);
    if (request.method === 'GET' && pathname === CART_HANDOFF_PATH) return appProxyHandler(request);
    if (request.method === 'POST' && pathname === ORDER_LIFECYCLE_WEBHOOKS_PATH) {
      return orderLifecycleWebhooksHandler(request);
    }
    if (pathname === PRODUCTION_DRAFTS_PATH || pathname === PRODUCTION_DRAFTS_CONFIG_PATH) {
      return productionDraftsHandler(request);
    }
    return designAssetsHandler(request);
  };
}

function resolveHandler(handler, factory, defaultFactory, env) {
  if (handler !== undefined) return handler;
  return (factory ?? defaultFactory)(env);
}
