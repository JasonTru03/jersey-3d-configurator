const SHOP_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
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
