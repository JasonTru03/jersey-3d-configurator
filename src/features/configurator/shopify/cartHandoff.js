const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function parseShopifyLaunch(search) {
  const params = new URLSearchParams(search);
  const shop = params.get('shop')?.toLowerCase();
  const variantMap = parseVariantMap(params.get('variantMap'));
  const returnPath = params.get('returnPath') ?? '';

  if (!SHOP_DOMAIN_PATTERN.test(shop ?? '') || !variantMap || (returnPath && !isInternalReturnPath(returnPath))) return null;

  return {
    shop,
    productHandle: params.get('productHandle') ?? '',
    returnPath,
    variantId: params.get('variantId') ?? '',
    variantMap,
  };
}

export function createCartUrl({ context, state, selected }) {
  const layout = state?.layout;
  const variantId = context?.variantMap?.[layout];

  if (!isNumericId(variantId)) {
    throw new Error('No Shopify variant exists for the selected size.');
  }

  const properties = createProperties({ state, selected });
  const query = new URLSearchParams({
    properties: encodeBase64Url(JSON.stringify(properties)),
    storefront: 'true',
  });

  return `https://${context.shop}/cart/${variantId}:1?${query}`;
}

function isInternalReturnPath(path) {
  return path.startsWith('/') && !path.startsWith('//');
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

function createProperties({ state, selected }) {
  const appearance = state?.overrides?.appearance;
  const colors = appearance?.colors ?? {};
  const decorations = state?.overrides?.decorations ?? [];

  return {
    Size: String(state?.layout ?? '').toUpperCase(),
    Template: appearance?.template ?? 'solid',
    'Body Color': colors.body ?? '',
    'Sleeves Color': colors.sleeves ?? '',
    'Shoulder and Side Color': colors.shoulderSide ?? '',
    'Collar Color': colors.collar ?? '',
    'Pattern Color': colors.pattern ?? '',
    'Number Color': colors.number ?? '',
    'Print Name': state?.overrides?.printName ?? '',
    'Print Number': state?.overrides?.printNumber ?? '',
    'Print Type': selected?.lighting?.shortLabel ?? 'None',
    Extras: joinLabels(selected?.extras),
    Artwork: joinLabels(decorations),
    '_3D Configuration Version': '1',
  };
}

function joinLabels(items) {
  const labels = (items ?? []).map((item) => item?.label).filter(Boolean);
  return labels.join(', ') || 'None';
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
