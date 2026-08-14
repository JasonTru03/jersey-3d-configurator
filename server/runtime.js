import path from 'node:path';
import { createWorkerHandler } from '../workers/router.js';
import { createFileObjectStore } from './adapters/fileObjectStore.js';
import { createFixedWindowRateLimiter } from './adapters/fixedWindowRateLimit.js';
import { openServerDatabase } from './adapters/sqliteD1.js';
import { createSqliteKv } from './adapters/sqliteKv.js';
import { createAdminOrderRepository } from './admin/adminOrderRepository.js';
import { createAdminPortal, isAdminPath } from './admin/adminPortal.js';
import { createStaticAssetsBinding } from './staticAssets.js';

export function createServerRuntime({ config, now = Date.now } = {}) {
  assertConfig(config);
  const opened = openServerDatabase({
    databasePath: path.join(config.dataDirectory, 'jersey.sqlite'),
    projectRoot: config.projectRoot,
  });
  try {
    const productionAssets = createFileObjectStore({
      database: opened.database,
      rootDirectory: path.join(config.dataDirectory, 'objects'),
      now,
    });
    const adminPortal = createAdminPortal({
      assets: productionAssets,
      config,
      loginRateLimit: createFixedWindowRateLimiter({
        database: opened.database,
        namespace: 'admin_login',
        limit: 5,
        periodSeconds: 300,
        now,
      }),
      now,
      repository: createAdminOrderRepository(opened.database),
    });
    const env = Object.freeze({
      ASSETS: createStaticAssetsBinding(config.distDirectory),
      CART_HANDOFF_RATE_LIMIT: createFixedWindowRateLimiter({
        database: opened.database,
        namespace: 'cart_handoff',
        limit: 300,
        periodSeconds: 60,
        now,
      }),
      CART_QUOTE_RATE_LIMIT: createFixedWindowRateLimiter({
        database: opened.database,
        namespace: 'cart_quote',
        limit: 10,
        periodSeconds: 60,
        now,
      }),
      CART_QUOTE_SIGNING_SECRET: config.cartQuoteSigningSecret,
      DESIGN_ASSETS: productionAssets,
      DESIGN_QUOTES: createSqliteKv({
        database: opened.database,
        namespace: 'design_quotes',
        now,
      }),
      LOCAL_PRODUCTION_FILES: config.localProductionFiles,
      PRODUCTION_ASSETS: productionAssets,
      PRODUCTION_DB: opened.binding,
      PRODUCTION_UPLOAD_RATE_LIMIT: createFixedWindowRateLimiter({
        database: opened.database,
        namespace: 'production_upload',
        limit: 10,
        periodSeconds: 60,
        now,
      }),
      SHOPIFY_API_SECRET: config.shopifyApiSecret,
      SHOPIFY_API_KEY: config.shopifyApiKey,
      SHOPIFY_TOKEN_ENCRYPTION_KEY: config.shopifyTokenEncryptionKey,
      PUBLIC_ORIGIN: config.publicOrigin,
      SHOPIFY_STORE_CONFIG_JSON: config.shopifyStoreConfigJson,
      TURNSTILE_SECRET_KEY: config.turnstileSecretKey,
      TURNSTILE_SITE_KEY: config.turnstileSiteKey,
    });
    const workerHandler = createWorkerHandler(env);
    return Object.freeze({
      env,
      handler(request) {
        return isAdminPath(new URL(request.url).pathname)
          ? adminPortal(request)
          : workerHandler(request);
      },
      close: opened.close,
    });
  } catch (error) {
    opened.close();
    throw error;
  }
}

function assertConfig(config) {
  const directoryKeys = ['dataDirectory', 'distDirectory', 'projectRoot'];
  const stringKeys = [
    'adminPasswordHash',
    'adminSessionSecret',
    'adminShop',
    'cartQuoteSigningSecret',
    'localProductionFiles',
    'shopifyApiSecret',
    'shopifyApiKey',
    'shopifyTokenEncryptionKey',
    'shopifyStoreConfigJson',
    'turnstileSecretKey',
    'turnstileSiteKey',
  ];
  if (!config
    || directoryKeys.some((key) => typeof config[key] !== 'string' || !path.isAbsolute(config[key]))
    || stringKeys.some((key) => typeof config[key] !== 'string' || config[key].length === 0)
    || !Array.isArray(config.adminShops)
    || config.adminShops.length === 0
    || !config.adminShops.includes(config.adminShop)) {
    throw new TypeError('Server runtime configuration is invalid.');
  }
}
