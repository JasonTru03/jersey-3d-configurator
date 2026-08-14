import { createDesignAssetsHandler } from './designAssets.js';
import { createProductionDraftsHandler } from './production/productionDrafts.js';
import { createAppProxyHandler } from './shopify/appProxy.js';
import { createAppProxyForwardingHandler } from './shopify/appProxyForwarder.js';
import { createAppProxyLaunchHandler } from './shopify/appProxyLaunch.js';
import { createAppLifecycleWebhooksHandler } from './shopify/appLifecycleWebhooks.js';
import { createCartQuotesHandler } from './shopify/cartQuotes.js';
import { createMerchantAppHandler } from './shopify/merchantApp.js';
import { createOAuthHandler } from './shopify/oauth.js';
import { createOrderLifecycleWebhooksHandler } from './shopify/orderLifecycleWebhooks.js';
import { createPrivacyWebhooksHandler } from './shopify/privacyWebhooks.js';

const CART_QUOTES_PATH = '/api/cart-quotes';
const CART_HANDOFF_PATH = '/apps/jersey-configurator/cart-handoff';
const CONFIGURATOR_LAUNCH_PATH = '/apps/jersey-configurator/launch';
const ORDER_LIFECYCLE_WEBHOOKS_PATH = '/webhooks/shopify/orders';
const APP_LIFECYCLE_WEBHOOKS_PATH = '/webhooks/shopify/app-lifecycle';
const PRIVACY_WEBHOOKS_PATH = '/webhooks/shopify/privacy';
const PRODUCTION_DRAFTS_PATH = '/api/production-drafts';
const PRODUCTION_DRAFTS_CONFIG_PATH = '/api/production-drafts/config';
const PRODUCTION_DRAFT_UPLOAD_PATH_PATTERN = /^\/api\/production-drafts\/dsg_[A-Za-z0-9_-]{16,64}\/(?:manifest|bundle)$/u;

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
    env.APP_PROXY_UPSTREAM_ORIGIN === undefined
      ? createAppProxyHandler
      : createAppProxyForwardingHandler,
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
  const appProxyLaunchHandler = resolveHandler(
    dependencies.appProxyLaunchHandler,
    dependencies.createAppProxyLaunchHandler,
    createAppProxyLaunchHandler,
    env,
  );
  const privacyWebhooksHandler = resolveHandler(
    dependencies.privacyWebhooksHandler,
    dependencies.createPrivacyWebhooksHandler,
    createPrivacyWebhooksHandler,
    env,
  );
  const appLifecycleWebhooksHandler = resolveHandler(
    dependencies.appLifecycleWebhooksHandler,
    dependencies.createAppLifecycleWebhooksHandler,
    createAppLifecycleWebhooksHandler,
    env,
  );
  const oauthHandler = resolveHandler(
    dependencies.oauthHandler,
    dependencies.createOAuthHandler,
    createOAuthHandler,
    env,
  );
  const merchantAppHandler = resolveHandler(
    dependencies.merchantAppHandler,
    dependencies.createMerchantAppHandler,
    createMerchantAppHandler,
    env,
  );

  return function handleWorkerRequest(request) {
    const pathname = new URL(request.url).pathname;
    if (request.method === 'POST' && pathname === CART_QUOTES_PATH) return cartQuotesHandler(request);
    if (request.method === 'GET' && pathname === CART_HANDOFF_PATH) return appProxyHandler(request);
    if (request.method === 'GET' && pathname === CONFIGURATOR_LAUNCH_PATH) {
      return appProxyLaunchHandler(request);
    }
    if (request.method === 'POST' && pathname === ORDER_LIFECYCLE_WEBHOOKS_PATH) {
      return orderLifecycleWebhooksHandler(request);
    }
    if (request.method === 'POST' && pathname === PRIVACY_WEBHOOKS_PATH) {
      return privacyWebhooksHandler(request);
    }
    if (request.method === 'POST' && pathname === APP_LIFECYCLE_WEBHOOKS_PATH) {
      return appLifecycleWebhooksHandler(request);
    }
    if (pathname === '/auth' || pathname === '/auth/callback') {
      return oauthHandler(request);
    }
    if (pathname === '/app') return merchantAppHandler(request);
    if (pathname === PRODUCTION_DRAFTS_PATH
      || pathname === PRODUCTION_DRAFTS_CONFIG_PATH
      || PRODUCTION_DRAFT_UPLOAD_PATH_PATTERN.test(pathname)) {
      return productionDraftsHandler(request);
    }
    return designAssetsHandler(request);
  };
}

function resolveHandler(handler, factory, defaultFactory, env) {
  if (handler !== undefined) return handler;
  return (factory ?? defaultFactory)(env);
}
