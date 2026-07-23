const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

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
    const surchargeVariantId = context?.surchargeVariantMap?.[String(customizationTotal)];
    if (!isNumericId(surchargeVariantId)) {
      throw new Error(`No Shopify surcharge variant exists for the $${customizationTotal} customization.`);
    }
    cartItems.push(`${surchargeVariantId}:1`);
  }

  const properties = createProperties(state, productionFiles);
  const query = new URLSearchParams({
    properties: encodeBase64Url(JSON.stringify(properties)),
    storefront: 'true',
  });

  return `https://${shop}/cart/${cartItems.join(',')}?${query}`;
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
  const properties = {
    Size: state?.layout ?? '',
    Template: appearance.template ?? '',
    Colors: JSON.stringify(appearance.colors ?? {}),
    Print: print,
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

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
