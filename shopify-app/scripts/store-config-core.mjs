import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const ADMIN_API_VERSION = '2026-07';
export const CONFIG_NAMESPACE = '$app:secure_jersey';
export const CONFIG_KEY = 'config';
export const TRANSFORM_HANDLE = 'secure-jersey-transform';
export const VALIDATION_HANDLE = 'secure-jersey-validation';
export const VALIDATION_TITLE = 'Secure jersey bundle validation';

const UINT64_MAX = '18446744073709551615';
const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const TOKEN_PATTERN = new RegExp(
  `^${'sh'}(?:${'pat_'}|${'pua_'}|${'pca_'})[A-Za-z0-9_-]{20,}$`,
  'u',
);
const FINGERPRINT_PATTERN = /^shop_[A-Za-z0-9_-]{12}$/u;
const EXPECTED_PRODUCT_ID = 'fn8788-jersey';
const STORE_CONFIG_KEYS = [
  'schema',
  'shopFingerprint',
  'signingSecret',
  'productId',
  'currency',
  'jerseyVariants',
  'surchargeVariants',
];
const JERSEY_SIZES = ['s', 'm', 'l', 'xl'];
const MAX_SURCHARGE_TOTAL = 10_000;

export const OPERATIONS = Object.freeze({
  DiscoverSecureJerseyRegistrations: `
    query DiscoverSecureJerseyRegistrations($first: Int!) {
      shopifyFunctions(first: $first) {
        nodes { id handle }
        pageInfo { hasNextPage }
      }
      cartTransforms(first: $first) {
        nodes {
          id
          functionId
          blockOnFailure
          config: metafield(namespace: "$app:secure_jersey", key: "config") {
            id
            type
            value
            compareDigest
          }
        }
        pageInfo { hasNextPage }
      }
      validations(first: $first) {
        nodes {
          id
          title
          enabled
          blockOnFailure
          shopifyFunction { id handle }
          config: metafield(namespace: "$app:secure_jersey", key: "config") {
            id
            type
            value
            compareDigest
          }
        }
        pageInfo { hasNextPage }
      }
    }
  `,
  CreateSecureJerseyCartTransform: `
    mutation CreateSecureJerseyCartTransform(
      $functionHandle: String!,
      $blockOnFailure: Boolean!,
      $metafields: [MetafieldInput!]!
    ) {
      cartTransformCreate(
        functionHandle: $functionHandle,
        blockOnFailure: $blockOnFailure,
        metafields: $metafields
      ) {
        cartTransform { id }
        userErrors { field message code }
      }
    }
  `,
  UpdateSecureJerseyOwnerConfigs: `
    mutation UpdateSecureJerseyOwnerConfigs($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message code }
      }
    }
  `,
  CreateSecureJerseyValidation: `
    mutation CreateSecureJerseyValidation($validation: ValidationCreateInput!) {
      validationCreate(validation: $validation) {
        validation { id }
        userErrors { field message code }
      }
    }
  `,
  UpdateSecureJerseyValidation: `
    mutation UpdateSecureJerseyValidation(
      $id: ID!,
      $validation: ValidationUpdateInput!
    ) {
      validationUpdate(id: $id, validation: $validation) {
        validation { id }
        userErrors { field message code }
      }
    }
  `,
});

export function normalizeInstallInput(value) {
  assertPlainObject(value, 'Store installation input must be an object.');
  assertExactKeys(value, ['shop', 'adminAccessToken', 'storeConfig'], 'Store installation input');
  if (typeof value.shop !== 'string' || !SHOP_PATTERN.test(value.shop)) {
    throw new TypeError('Shop domain must be a lowercase *.myshopify.com domain.');
  }
  if (typeof value.adminAccessToken !== 'string' || !TOKEN_PATTERN.test(value.adminAccessToken)) {
    throw new TypeError('Admin access token must use the Shopify Admin token format.');
  }
  const storeConfig = normalizeStoreConfig(value.storeConfig);
  if (storeConfig.shopFingerprint !== shopFingerprint(value.shop)) {
    throw new TypeError('storeConfig.shopFingerprint does not match the shop domain.');
  }
  return {
    shop: value.shop,
    adminAccessToken: value.adminAccessToken,
    storeConfig,
  };
}

export function normalizeStoreConfig(value) {
  assertPlainObject(value, 'storeConfig must be an object.');
  assertExactKeys(value, STORE_CONFIG_KEYS, 'storeConfig');
  if (value.schema !== 1) throw new TypeError('storeConfig.schema must equal 1.');
  if (
    typeof value.shopFingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(value.shopFingerprint)
  ) {
    throw new TypeError('storeConfig.shopFingerprint is invalid.');
  }
  if (
    typeof value.signingSecret !== 'string'
    || Buffer.byteLength(value.signingSecret, 'utf8') < 32
    || Buffer.byteLength(value.signingSecret, 'utf8') > 256
  ) {
    throw new TypeError('storeConfig.signingSecret must contain 32 to 256 UTF-8 bytes.');
  }
  if (value.productId !== EXPECTED_PRODUCT_ID) {
    throw new TypeError(`storeConfig.productId must equal ${EXPECTED_PRODUCT_ID}.`);
  }
  if (value.currency !== 'USD') throw new TypeError('storeConfig.currency must equal USD.');

  const jerseyVariants = normalizeJerseyVariants(value.jerseyVariants);
  const jerseyIds = new Set(Object.values(jerseyVariants));
  const surchargeVariants = normalizeSurchargeVariants(value.surchargeVariants, jerseyIds);
  return {
    schema: 1,
    shopFingerprint: value.shopFingerprint,
    signingSecret: value.signingSecret,
    productId: EXPECTED_PRODUCT_ID,
    currency: 'USD',
    jerseyVariants,
    surchargeVariants,
  };
}

export function createMetafield(storeConfig, ownerId, compareDigest) {
  const metafield = {
    namespace: CONFIG_NAMESPACE,
    key: CONFIG_KEY,
    type: 'json',
    value: JSON.stringify(normalizeStoreConfig(storeConfig)),
  };
  if (ownerId !== undefined) {
    assertGid(ownerId, 'Shopify owner ID');
    if (
      compareDigest !== undefined
      && compareDigest !== null
      && (typeof compareDigest !== 'string' || compareDigest.length === 0)
    ) {
      throw new TypeError('Shopify metafield compareDigest is invalid.');
    }
    return compareDigest === undefined
      ? { ownerId, ...metafield }
      : { ownerId, ...metafield, compareDigest };
  }
  return metafield;
}

export function createRedactedSummary(input, registrations = {}) {
  const normalized = normalizeInstallInput(input);
  return {
    shop: normalized.shop,
    schema: normalized.storeConfig.schema,
    shopFingerprint: normalized.storeConfig.shopFingerprint,
    signingSecretSha256: sha256(normalized.storeConfig.signingSecret),
    productId: normalized.storeConfig.productId,
    currency: normalized.storeConfig.currency,
    jerseyVariants: normalized.storeConfig.jerseyVariants,
    surchargeVariants: normalized.storeConfig.surchargeVariants,
    transform: {
      functionHandle: TRANSFORM_HANDLE,
      registrationId: registrations.transformId ?? null,
    },
    validation: {
      functionHandle: VALIDATION_HANDLE,
      registrationId: registrations.validationId ?? null,
    },
  };
}

export function createAdminGraphqlClient({
  shop,
  adminAccessToken,
  storeConfig,
  sensitiveValues = [],
  fetchImpl = fetch,
}) {
  if (typeof shop !== 'string' || !SHOP_PATTERN.test(shop)) {
    throw new TypeError('Shop domain must be a lowercase *.myshopify.com domain.');
  }
  if (typeof adminAccessToken !== 'string' || !TOKEN_PATTERN.test(adminAccessToken)) {
    throw new TypeError('Admin access token must use the Shopify Admin token format.');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');
  if (!Array.isArray(sensitiveValues)) {
    throw new TypeError('sensitiveValues must be an array.');
  }
  const redactions = [
    adminAccessToken,
    typeof storeConfig?.signingSecret === 'string' ? storeConfig.signingSecret : null,
    isPlainObject(storeConfig) ? JSON.stringify(storeConfig) : null,
    ...sensitiveValues,
  ];
  const endpoint = `https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`;

  return async function graphql(operationName, variables = {}) {
    const query = OPERATIONS[operationName];
    if (!query) throw new Error(`Unknown Shopify Admin operation ${operationName}.`);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': adminAccessToken,
        },
        body: JSON.stringify({ query, variables, operationName }),
      });
    } catch {
      throw new Error(`Shopify Admin GraphQL ${operationName} request failed.`);
    }
    if (!response || typeof response.ok !== 'boolean') {
      throw new Error(`Shopify Admin GraphQL ${operationName} returned an invalid response.`);
    }
    if (!response.ok) {
      throw new Error(`Shopify Admin GraphQL ${operationName} HTTP ${response.status}.`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Shopify Admin GraphQL ${operationName} returned invalid JSON.`);
    }
    if (!isPlainObject(payload)) {
      throw new Error(`Shopify Admin GraphQL ${operationName} returned an invalid payload.`);
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const messages = payload.errors
        .map((error) => (isPlainObject(error) ? error.message : null))
        .filter((message) => typeof message === 'string')
        .join('; ');
      throw new Error(
        `Shopify Admin GraphQL ${operationName} errors: ${
          redact(messages || 'unknown error', redactions)
        }`,
      );
    }
    if (!isPlainObject(payload.data)) {
      throw new Error(`Shopify Admin GraphQL ${operationName} returned no data.`);
    }
    return payload.data;
  };
}

export function inspectDiscovery(data) {
  assertPlainObject(data, 'Shopify registration discovery returned invalid data.');
  const functions = connectionNodes(data.shopifyFunctions, 'shopifyFunctions');
  const transforms = connectionNodes(data.cartTransforms, 'cartTransforms');
  const validations = connectionNodes(data.validations, 'validations');
  const transformFunction = oneByHandle(functions, TRANSFORM_HANDLE, 'Cart Transform Function');
  const validationFunction = oneByHandle(functions, VALIDATION_HANDLE, 'Validation Function');

  const matchingTransforms = transforms.filter(
    (node) => node?.functionId === transformFunction.id,
  );
  if (matchingTransforms.length > 1) {
    throw new Error('Cart Transform registration conflict: multiple owned records use the handle.');
  }
  const matchingValidations = validations.filter(
    (node) => node?.shopifyFunction?.handle === VALIDATION_HANDLE,
  );
  if (matchingValidations.length > 1) {
    throw new Error('Validation registration conflict: multiple owned records use the handle.');
  }
  const transform = matchingTransforms[0] ?? null;
  const validation = matchingValidations[0] ?? null;
  if (transforms.some((node) => node?.config && node !== transform)) {
    throw new Error('Cart Transform configuration owner conflict.');
  }
  if (validations.some((node) => node?.config && node !== validation)) {
    throw new Error('Validation configuration owner conflict.');
  }
  if (transform) validateRegistrationId(transform.id, 'Cart Transform registration');
  if (validation) validateRegistrationId(validation.id, 'Validation registration');
  return {
    transformFunction,
    validationFunction,
    transform,
    validation,
  };
}

export function verifyRemoteConfiguration({ input, discovery }) {
  const normalized = normalizeInstallInput(input);
  const inspected = inspectDiscovery(discovery);
  if (!inspected.transform || !inspected.validation) {
    throw new Error('Secure jersey registrations are incomplete.');
  }
  if (inspected.transform.blockOnFailure !== true) {
    throw new Error('Cart Transform registration must block on failure.');
  }
  if (
    inspected.validation.blockOnFailure !== true
    || inspected.validation.enabled !== true
  ) {
    throw new Error('Validation registration must be enabled and block on failure.');
  }
  const transformConfig = parseOwnerConfig(inspected.transform.config, 'Cart Transform');
  const validationConfig = parseOwnerConfig(inspected.validation.config, 'Validation');
  const expected = JSON.stringify(normalized.storeConfig);
  if (
    JSON.stringify(transformConfig) !== expected
    || JSON.stringify(validationConfig) !== expected
  ) {
    throw new Error('Remote secure jersey configuration does not match the local configuration.');
  }
  return createRedactedSummary(normalized, {
    transformId: inspected.transform.id,
    validationId: inspected.validation.id,
  });
}

export function assertMutationResult(operationName, container, recordName) {
  assertUserErrors(operationName, container);
  const record = container[recordName];
  if (!isPlainObject(record) || typeof record.id !== 'string') {
    throw new Error(`${operationName} returned no registration.`);
  }
  validateRegistrationId(record.id, `${operationName} registration`);
  return record;
}

export function assertUserErrors(operationName, container) {
  if (!isPlainObject(container)) {
    throw new Error(`${operationName} returned an invalid mutation payload.`);
  }
  if (!Array.isArray(container.userErrors)) {
    throw new Error(`${operationName} returned invalid userErrors.`);
  }
  if (container.userErrors.length > 0) {
    const details = container.userErrors.map((error) => {
      const field = Array.isArray(error?.field) ? error.field.join('.') : 'unknown';
      const message = typeof error?.message === 'string' ? error.message : 'unknown error';
      return `${field}: ${message}`;
    }).join('; ');
    throw new Error(`${operationName} failed: ${details}`);
  }
}

export async function discover(graphql) {
  if (typeof graphql !== 'function') throw new TypeError('graphql must be a function.');
  return graphql('DiscoverSecureJerseyRegistrations', { first: 100 });
}

export async function loadInstallInput({ configPath, env = process.env } = {}) {
  let raw;
  if (configPath) {
    raw = JSON.parse(await readFile(configPath, 'utf8'));
  } else {
    const required = ['SHOP_DOMAIN', 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'SHOPIFY_STORE_CONFIG_JSON'];
    if (required.some((name) => typeof env[name] !== 'string' || env[name].length === 0)) {
      throw new Error(
        'Provide --config PATH or SHOP_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN, and SHOPIFY_STORE_CONFIG_JSON.',
      );
    }
    raw = {
      shop: env.SHOP_DOMAIN,
      adminAccessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      storeConfig: JSON.parse(env.SHOPIFY_STORE_CONFIG_JSON),
    };
  }
  return normalizeInstallInput(raw);
}

export function parseCliArgs(argv, { allowApply = false } = {}) {
  const result = { configPath: null, dryRun: false, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--config') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--config requires a file path.');
      result.configPath = value;
      index += 1;
    } else if (argument === '--dry-run') {
      result.dryRun = true;
    } else if (argument === '--apply' && allowApply) {
      result.apply = true;
    } else {
      throw new Error(`Unknown argument ${argument}.`);
    }
  }
  if (result.apply && result.dryRun) throw new Error('--apply and --dry-run are mutually exclusive.');
  return result;
}

export function redactError(error, sensitiveValues) {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message, sensitiveValues);
}

function normalizeJerseyVariants(value) {
  assertPlainObject(value, 'storeConfig.jerseyVariants must be an object.');
  assertExactKeys(value, JERSEY_SIZES, 'storeConfig.jerseyVariants');
  const result = {};
  const used = new Set();
  for (const size of JERSEY_SIZES) {
    const variantId = normalizeVariantId(
      value[size],
      `storeConfig.jerseyVariants.${size} is invalid.`,
    );
    if (used.has(variantId)) {
      throw new TypeError(`storeConfig.jerseyVariants reuses variant ${variantId}.`);
    }
    used.add(variantId);
    result[size] = variantId;
  }
  return result;
}

function normalizeSurchargeVariants(value, jerseyIds) {
  assertPlainObject(value, 'storeConfig.surchargeVariants must be an object.');
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new TypeError('storeConfig.surchargeVariants must not be empty.');
  }
  if (entries.length > 64) {
    throw new TypeError('storeConfig.surchargeVariants must contain at most 64 entries.');
  }
  const normalized = [];
  const used = new Set();
  for (const [amountText, rawVariantId] of entries) {
    if (!/^[1-9][0-9]*$/u.test(amountText)) {
      throw new TypeError(`storeConfig.surchargeVariants amount ${amountText} is invalid.`);
    }
    const amount = Number(amountText);
    if (!Number.isSafeInteger(amount) || amount > MAX_SURCHARGE_TOTAL) {
      throw new TypeError(`storeConfig.surchargeVariants amount ${amountText} is invalid.`);
    }
    const variantId = normalizeVariantId(
      rawVariantId,
      `storeConfig.surchargeVariants.${amountText} is invalid.`,
    );
    if (used.has(variantId)) {
      throw new TypeError(`storeConfig.surchargeVariants reuses variant ${variantId}.`);
    }
    if (jerseyIds.has(variantId)) {
      throw new TypeError(
        `storeConfig.surchargeVariants variant ${variantId} conflicts with a jersey variant.`,
      );
    }
    used.add(variantId);
    normalized.push([amount, variantId]);
  }
  normalized.sort(([left], [right]) => left - right);
  return Object.fromEntries(normalized.map(([amount, variantId]) => [String(amount), variantId]));
}

function normalizeVariantId(value, message) {
  if (
    typeof value !== 'string'
    || !/^[1-9][0-9]*$/u.test(value)
    || value.length > UINT64_MAX.length
    || (value.length === UINT64_MAX.length && value > UINT64_MAX)
  ) {
    throw new TypeError(message);
  }
  return value;
}

function parseOwnerConfig(metafield, ownerName) {
  if (
    !isPlainObject(metafield)
    || metafield.type !== 'json'
    || typeof metafield.value !== 'string'
  ) {
    throw new Error(`${ownerName} configuration metafield is missing or invalid.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(metafield.value);
  } catch {
    throw new Error(`${ownerName} configuration metafield is not valid JSON.`);
  }
  try {
    return normalizeStoreConfig(parsed);
  } catch {
    throw new Error(`${ownerName} configuration metafield has an invalid schema.`);
  }
}

function connectionNodes(connection, name) {
  if (
    !isPlainObject(connection)
    || !Array.isArray(connection.nodes)
    || !isPlainObject(connection.pageInfo)
    || typeof connection.pageInfo.hasNextPage !== 'boolean'
  ) {
    throw new Error(`Shopify ${name} connection is invalid.`);
  }
  if (connection.pageInfo.hasNextPage) {
    throw new Error(`Shopify ${name} result is truncated; conflict safety requires a complete list.`);
  }
  return connection.nodes;
}

function oneByHandle(functions, handle, label) {
  const matches = functions.filter((node) => node?.handle === handle);
  if (matches.length !== 1) {
    throw new Error(`${label} handle conflict: expected exactly one deployed Function.`);
  }
  if (typeof matches[0].id !== 'string' || matches[0].id.length === 0) {
    throw new Error(`${label} has an invalid Function ID.`);
  }
  return matches[0];
}

function validateRegistrationId(value, label) {
  assertGid(value, `${label} ID`);
}

function assertGid(value, label) {
  if (typeof value !== 'string' || !/^gid:\/\/shopify\/[A-Za-z][A-Za-z0-9]*\/[^/]+$/u.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function assertExactKeys(value, expected, name) {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length
    || keys.some((key) => !expected.includes(key))
    || expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new TypeError(`${name} must contain exactly: ${expected.join(', ')}.`);
  }
}

function assertPlainObject(value, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function shopFingerprint(shop) {
  const encoded = createHash('sha256').update(shop, 'utf8').digest('base64url');
  return `shop_${encoded.slice(0, 12)}`;
}

function redact(value, sensitiveValues) {
  return sensitiveValues
    .filter((item) => typeof item === 'string' && item.length > 0)
    .reduce((result, item) => result.split(item).join('[REDACTED]'), String(value));
}
