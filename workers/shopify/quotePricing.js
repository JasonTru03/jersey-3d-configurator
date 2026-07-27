import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import { calculateQuote } from '../../src/features/configurator/config/pricing.js';
import { findSurchargeCombination } from '../../src/features/configurator/shopify/cartHandoff.js';
import { normalizeDesignState } from './designNormalizer.js';

export function calculateTrustedComponents({ state, storeConfig } = {}) {
  const normalizedState = normalizeDesignState(state);
  validateStoreConfig(storeConfig);

  const jerseyVariantId = normalizeVariantId(
    storeConfig.jerseyVariants[normalizedState.layout],
    `Invalid jersey variant for layout "${normalizedState.layout}".`,
  );
  if (!jerseyVariantId) {
    throw new Error(
      `Store pricing configuration has no jersey variant for layout "${normalizedState.layout}".`,
    );
  }

  const quote = calculateQuote(jerseyProduct, normalizedState);
  const surchargeItems = findSurchargeCombination(
    storeConfig.surchargeVariants,
    quote.customizationTotal,
  );
  if (surchargeItems === null) {
    throw new Error(
      `Store pricing configuration cannot represent surcharge ${quote.customizationTotal} ${quote.currency}.`,
    );
  }
  if (surchargeItems.some((item) => item.variantId === jerseyVariantId)) {
    throw new Error('Store pricing configuration must not reuse jersey variant as a surcharge variant.');
  }

  return {
    normalizedState,
    quote,
    jerseyVariantId,
    surchargeItems,
  };
}

function validateStoreConfig(storeConfig) {
  if (!isPlainObject(storeConfig)) {
    throw new TypeError('Store pricing configuration must be a plain object.');
  }
  if (storeConfig.currency !== jerseyProduct.currency) {
    throw new Error(
      `Store pricing currency ${String(storeConfig.currency)} does not match product currency ${jerseyProduct.currency}.`,
    );
  }
  if (
    storeConfig.productId !== undefined
    && storeConfig.productId !== jerseyProduct.id
  ) {
    throw new Error(
      `Store pricing product ${String(storeConfig.productId)} does not match ${jerseyProduct.id}.`,
    );
  }
  if (!isPlainObject(storeConfig.jerseyVariants)) {
    throw new TypeError('Store pricing jerseyVariants must be a plain object.');
  }
  if (!isPlainObject(storeConfig.surchargeVariants)) {
    throw new TypeError('Store pricing surchargeVariants must be a plain object.');
  }
}

function normalizeVariantId(value, invalidMessage) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new TypeError(invalidMessage);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
