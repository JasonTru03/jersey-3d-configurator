import {
  getBillableCustomTextItems,
  getCustomTextItems,
} from '../config/customTextItems.js';

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const EXPIRED_PRICING_MESSAGE = 'Pricing for this configurator launch has expired. Reopen it from the Shopify product page.';
export const MAX_SURCHARGE_TOTAL = 10000;
const PREFERENCE_BASE = BigInt(MAX_SURCHARGE_TOTAL + 1);

export function parseShopifyLaunch(search) {
  const params = new URLSearchParams(search);
  const shop = normalizeShop(params.get('shop'));
  const variantMap = parseVariantMap(params.get('variantMap'));
  const surchargeVariantMap = parseVariantMap(params.get('surchargeVariantMap'));
  const variantId = params.get('variantId') ?? '';
  const returnPath = params.get('returnPath') ?? '';

  if (!shop || !variantMap) return null;

  const base = new URL(`https://${shop}`);
  if (returnPath && !isInternalReturnPath(returnPath, base)) return null;

  return {
    shop,
    productHandle: params.get('productHandle') ?? '',
    returnPath,
    surchargeVariantMap,
    variantId,
    variantMap,
    initialLayout: Object.entries(variantMap).find(([, mappedVariantId]) => mappedVariantId === variantId)?.[0],
  };
}

export function createCartUrl({ context, quote, state, productionFiles }) {
  const shop = normalizeShop(context?.shop);
  if (!shop) throw new Error('Invalid Shopify shop host.');

  const variantId = context?.variantMap?.[state?.layout];

  if (!isNumericId(variantId)) {
    throw new Error('No Shopify variant exists for the selected size.');
  }

  const customizationTotal = quote?.customizationTotal;
  if (!Number.isSafeInteger(customizationTotal) || customizationTotal < 0) {
    throw new Error('Invalid configurator quote.');
  }

  const cartItems = [`${variantId}:1`];
  if (customizationTotal > 0) {
    const surchargeItems = findSurchargeCombination(
      context?.surchargeVariantMap,
      customizationTotal,
    );
    if (!surchargeItems) {
      throw new Error(EXPIRED_PRICING_MESSAGE);
    }
    if (surchargeItems.some((item) => item.variantId === String(variantId))) {
      throw new Error(EXPIRED_PRICING_MESSAGE);
    }
    surchargeItems.forEach(({ variantId: surchargeVariantId, quantity }) => {
      cartItems.push(`${surchargeVariantId}:${quantity}`);
    });
  }

  const properties = createProperties(state, productionFiles);
  const query = new URLSearchParams({
    properties: encodeBase64Url(JSON.stringify(properties)),
    storefront: 'true',
  });

  return `https://${shop}/cart/${cartItems.join(',')}?${query}`;
}

export function findSurchargeCombination(variantMap, target) {
  if (
    !Number.isSafeInteger(target)
    || target < 0
    || target > MAX_SURCHARGE_TOTAL
  ) return null;
  if (target === 0) return [];

  const entries = normalizeSurchargeEntries(variantMap);
  if (!entries?.length) return null;

  const exact = entries.find((entry) => entry.amount === target);
  if (exact) return [{ ...exact, quantity: 1 }];

  let bestBySubtotal = Array(target + 1).fill(null);
  bestBySubtotal[0] = createInitialCombinationState();

  for (const entry of entries.filter((item) => item.amount < target)) {
    const nextBestBySubtotal = Array(target + 1).fill(null);
    const maximumRemainder = Math.min(entry.amount - 1, target);

    for (let remainder = 0; remainder <= maximumRemainder; remainder += 1) {
      let bestSource = null;
      let index = 0;

      for (
        let subtotal = remainder;
        subtotal <= target;
        subtotal += entry.amount
      ) {
        const previous = bestBySubtotal[subtotal];
        if (previous) {
          nextBestBySubtotal[subtotal] = advanceCombinationState(
            previous,
            entry,
            0,
          );
        }

        if (index > 0) {
          const sourceState = bestBySubtotal[subtotal - entry.amount];
          if (sourceState) {
            const source = { index: index - 1, state: sourceState };
            if (!bestSource || compareCombinationSources(source, bestSource) < 0) {
              bestSource = source;
            }
          }
        }

        if (bestSource) {
          const quantity = index - bestSource.index;
          const withEntry = advanceCombinationState(
            bestSource.state,
            entry,
            quantity,
          );
          const current = nextBestBySubtotal[subtotal];
          if (!current || compareCombinationStates(withEntry, current) < 0) {
            nextBestBySubtotal[subtotal] = withEntry;
          }
        }

        index += 1;
      }
    }

    bestBySubtotal = nextBestBySubtotal;
  }

  return buildSurchargeItems(bestBySubtotal[target]);
}

function normalizeShop(value) {
  const shop = value?.toLowerCase();
  return SHOP_DOMAIN_PATTERN.test(shop ?? '') ? shop : null;
}

function isInternalReturnPath(path, base) {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\x00-\x1F\x7F]/.test(path)) {
    return false;
  }

  const parsed = new URL(path, base);
  return parsed.origin === base.origin && parsed.pathname.startsWith('/');
}

function parseVariantMap(rawVariantMap) {
  if (!rawVariantMap) return null;

  try {
    const variantMap = JSON.parse(rawVariantMap);
    if (!variantMap || Array.isArray(variantMap) || typeof variantMap !== 'object') return null;

    const entries = Object.entries(variantMap);
    if (entries.length === 0 || entries.some(([, variantId]) => !isNumericId(variantId))) return null;

    return Object.fromEntries(entries.map(([size, variantId]) => [size, String(variantId)]));
  } catch {
    return null;
  }
}

function createProperties(state, productionFiles) {
  const appearance = state?.overrides?.appearance ?? {};
  const print = state?.overrides?.printName || state?.overrides?.printNumber
    ? `${state.overrides.printName ?? ''}${state.overrides.printNumber ? ` #${state.overrides.printNumber}` : ''}`.trim()
    : '';
  const customText = getBillableCustomTextItems(
    getCustomTextItems(state?.overrides),
  ).map((item) => item.text.trim()).join(' | ');
  const properties = {
    Size: state?.layout ?? '',
    Template: appearance.template ?? '',
    Colors: JSON.stringify(appearance.colors ?? {}),
    Print: print,
    'Custom Text': customText,
    Extras: Object.entries(state?.extras ?? {}).filter(([, enabled]) => enabled).map(([id]) => id).join(', '),
    Artwork: (state?.overrides?.decorations ?? []).map((item) => item.name ?? item.id).join(', '),
  };
  if (!state?.overrides?.bottomPattern?.enabled) return properties;
  if (!productionFiles?.bundleFilename || !productionFiles?.designFilename || !productionFiles?.atlasSha256) throw new Error('Local production files are not ready.');
  return {
    ...properties,
    'Production Files': 'Local ZIP download',
    'Bundle File': productionFiles.bundleFilename,
    'Design File': productionFiles.designFilename,
    'UV Atlas SHA-256': productionFiles.atlasSha256,
  };
}

function isNumericId(value) {
  return (typeof value === 'string' && /^[0-9]+$/.test(value))
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function normalizeSurchargeEntries(variantMap) {
  const entries = Object.entries(variantMap ?? {})
    .map(([amount, variantId]) => ({
      amount: Number(amount),
      originalVariantId: variantId,
    }))
    .filter(({ amount, originalVariantId }) => (
      Number.isSafeInteger(amount)
      && amount > 0
      && isNumericId(originalVariantId)
    ))
    .map(({ amount, originalVariantId }) => ({
      amount,
      variantId: String(originalVariantId),
    }))
    .sort(compareSurchargeEntries);

  const amountByVariantId = new Map();
  const uniqueEntries = [];
  for (const entry of entries) {
    const mappedAmount = amountByVariantId.get(entry.variantId);
    if (mappedAmount !== undefined && mappedAmount !== entry.amount) return null;
    if (mappedAmount === entry.amount) continue;
    amountByVariantId.set(entry.variantId, entry.amount);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}

function createInitialCombinationState() {
  return {
    entry: null,
    lines: 0,
    preferenceCode: 0n,
    previous: null,
    quantity: 0,
    units: 0,
  };
}

function advanceCombinationState(previous, entry, quantity) {
  return {
    entry,
    lines: previous.lines + (quantity > 0 ? 1 : 0),
    preferenceCode: (previous.preferenceCode * PREFERENCE_BASE) + BigInt(quantity),
    previous,
    quantity,
    units: previous.units + quantity,
  };
}

function compareCombinationStates(first, second) {
  if (first.units !== second.units) return first.units - second.units;
  if (first.lines !== second.lines) return first.lines - second.lines;
  if (first.preferenceCode !== second.preferenceCode) {
    return first.preferenceCode > second.preferenceCode ? -1 : 1;
  }
  return 0;
}

function compareCombinationSources(first, second) {
  const firstUnits = first.state.units - first.index;
  const secondUnits = second.state.units - second.index;
  if (firstUnits !== secondUnits) return firstUnits - secondUnits;
  if (first.state.lines !== second.state.lines) {
    return first.state.lines - second.state.lines;
  }

  const firstPreference = (first.state.preferenceCode * PREFERENCE_BASE)
    - BigInt(first.index);
  const secondPreference = (second.state.preferenceCode * PREFERENCE_BASE)
    - BigInt(second.index);
  if (firstPreference !== secondPreference) {
    return firstPreference > secondPreference ? -1 : 1;
  }
  return 0;
}

function buildSurchargeItems(state) {
  if (!state) return null;

  const items = [];
  let current = state;
  while (current.previous) {
    if (current.quantity > 0) {
      items.push({
        ...current.entry,
        quantity: current.quantity,
      });
    }
    current = current.previous;
  }
  return items.reverse();
}

function compareSurchargeEntries(first, second) {
  if (first.amount !== second.amount) return second.amount - first.amount;
  return first.variantId.localeCompare(second.variantId, 'en', { numeric: true });
}

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
