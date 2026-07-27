import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import { calculateQuote } from '../../src/features/configurator/config/pricing.js';
import {
  findSurchargeCombination,
  MAX_SURCHARGE_TOTAL,
} from '../../src/features/configurator/shopify/cartHandoff.js';
import { normalizeDesignState } from './designNormalizer.js';

const LAYOUT_IDS = jerseyProduct.options.layout.map((option) => option.id);
const LAYOUT_ID_SET = new Set(LAYOUT_IDS);
const UINT64_MAX_DECIMAL = '18446744073709551615';

export function calculateTrustedComponents({ state, storeConfig } = {}) {
  const normalizedState = normalizeDesignState(state);
  const validatedConfig = validateStoreConfig(storeConfig);

  const jerseyVariantId = validatedConfig.jerseyVariants[normalizedState.layout];

  const quote = calculateQuote(jerseyProduct, normalizedState);
  const surchargeItems = findSurchargeCombination(
    validatedConfig.surchargeVariants,
    quote.customizationTotal,
  );
  if (surchargeItems === null) {
    throw new Error(
      `Store pricing configuration cannot represent surcharge ${quote.customizationTotal} ${quote.currency}.`,
    );
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

  const jerseyVariants = validateJerseyVariants(storeConfig.jerseyVariants);
  const surchargeVariants = validateSurchargeVariants(
    storeConfig.surchargeVariants,
    new Set(Object.values(jerseyVariants)),
  );
  return { jerseyVariants, surchargeVariants };
}

function validateJerseyVariants(variantMap) {
  for (const size of Object.keys(variantMap)) {
    if (!LAYOUT_ID_SET.has(size)) {
      throw new Error(`Store pricing configuration has unknown jersey size "${size}".`);
    }
  }

  const normalized = {};
  const usedVariantIds = new Set();
  for (const size of LAYOUT_IDS) {
    if (!Object.hasOwn(variantMap, size)) {
      throw new Error(`Store pricing configuration has no jersey variant for size "${size}".`);
    }
    const variantId = normalizePositiveVariantId(
      variantMap[size],
      `Store pricing configuration has invalid jersey variant for size "${size}".`,
    );
    if (usedVariantIds.has(variantId)) {
      throw new Error(`Store pricing configuration reuses jersey variant "${variantId}".`);
    }
    usedVariantIds.add(variantId);
    normalized[size] = variantId;
  }
  return normalized;
}

function validateSurchargeVariants(variantMap, jerseyVariantIds) {
  const normalized = {};
  const amountByVariantId = new Map();
  for (const [rawAmount, rawVariantId] of Object.entries(variantMap)) {
    if (!/^[1-9][0-9]*$/.test(rawAmount)) {
      throw new Error(`Store pricing configuration has invalid surcharge amount "${rawAmount}".`);
    }
    const amount = Number(rawAmount);
    if (!Number.isSafeInteger(amount) || amount > MAX_SURCHARGE_TOTAL) {
      throw new Error(`Store pricing configuration has invalid surcharge amount "${rawAmount}".`);
    }
    const variantId = normalizePositiveVariantId(
      rawVariantId,
      `Store pricing configuration has invalid surcharge variant for amount "${rawAmount}".`,
    );
    const previousAmount = amountByVariantId.get(variantId);
    if (previousAmount !== undefined && previousAmount !== amount) {
      throw new Error(
        `Store pricing configuration maps surcharge variant "${variantId}" to multiple amounts.`,
      );
    }
    if (jerseyVariantIds.has(variantId)) {
      throw new Error(
        `Store pricing configuration surcharge variant "${variantId}" conflicts with a jersey variant.`,
      );
    }
    amountByVariantId.set(variantId, amount);
    normalized[amount] = variantId;
  }
  return normalized;
}

function normalizePositiveVariantId(value, invalidMessage) {
  if (typeof value === 'string' && isCanonicalUint64(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new TypeError(invalidMessage);
}

function isCanonicalUint64(value) {
  if (!/^[1-9][0-9]*$/.test(value)) return false;
  if (value.length !== UINT64_MAX_DECIMAL.length) {
    return value.length < UINT64_MAX_DECIMAL.length;
  }
  return value <= UINT64_MAX_DECIMAL;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
