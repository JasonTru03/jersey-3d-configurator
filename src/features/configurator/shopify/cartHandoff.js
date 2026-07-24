import {
  getBillableCustomTextItems,
  getCustomTextItems,
} from '../config/customTextItems.js';

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const EXPIRED_PRICING_MESSAGE = 'Pricing for this configurator launch has expired. Reopen it from the Shopify product page.';

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
  if (!Number.isSafeInteger(target) || target < 0) return null;
  if (target === 0) return [];

  const entries = Object.entries(variantMap ?? {})
    .map(([amount, variantId]) => ({
      amount: Number(amount),
      variantId: String(variantId),
    }))
    .filter(({ amount, variantId }) => (
      Number.isSafeInteger(amount)
      && amount > 0
      && amount <= target
      && isNumericId(variantId)
    ))
    .sort(compareSurchargeEntries);

  if (!entries.length) return null;

  let bestBySubtotal = Array(target + 1).fill(null);
  bestBySubtotal[0] = [];

  for (const entry of entries) {
    const nextBestBySubtotal = [...bestBySubtotal];
    for (let subtotal = 0; subtotal <= target; subtotal += 1) {
      const previous = bestBySubtotal[subtotal];
      if (!previous) continue;

      const maximumQuantity = Math.floor((target - subtotal) / entry.amount);
      for (let quantity = 1; quantity <= maximumQuantity; quantity += 1) {
        const nextSubtotal = subtotal + (entry.amount * quantity);
        const candidate = [...previous, { ...entry, quantity }];
        const current = nextBestBySubtotal[nextSubtotal];
        if (!current || compareCombinations(candidate, current) < 0) {
          nextBestBySubtotal[nextSubtotal] = candidate;
        }
      }
    }
    bestBySubtotal = nextBestBySubtotal;
  }

  return bestBySubtotal[target];
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

function compareCombinations(first, second) {
  const firstUnits = first.reduce((total, item) => total + item.quantity, 0);
  const secondUnits = second.reduce((total, item) => total + item.quantity, 0);
  if (firstUnits !== secondUnits) return firstUnits - secondUnits;

  const firstKinds = first.length;
  const secondKinds = second.length;
  if (firstKinds !== secondKinds) return firstKinds - secondKinds;

  const amounts = [...new Set([
    ...first.map((item) => item.amount),
    ...second.map((item) => item.amount),
  ])].sort((firstAmount, secondAmount) => secondAmount - firstAmount);
  for (const amount of amounts) {
    const firstQuantity = first.find((item) => item.amount === amount)?.quantity ?? 0;
    const secondQuantity = second.find((item) => item.amount === amount)?.quantity ?? 0;
    if (firstQuantity !== secondQuantity) return secondQuantity - firstQuantity;
  }

  const firstIds = first.map((item) => item.variantId).sort();
  const secondIds = second.map((item) => item.variantId).sort();
  return firstIds.join('|').localeCompare(secondIds.join('|'), 'en', { numeric: true });
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
