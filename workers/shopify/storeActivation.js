import { createShopFingerprint } from './quoteContract.js';

const CONFIG_NAMESPACE = '$app:secure_jersey';
const CONFIG_KEY = 'config';
const TRANSFORM_HANDLE = 'secure-jersey-transform';
const VALIDATION_HANDLE = 'secure-jersey-validation';

const DISCOVER = `query Discover($first: Int!) {
  shopifyFunctions(first: $first) { nodes { id handle } pageInfo { hasNextPage } }
  cartTransforms(first: $first) { nodes { id functionId blockOnFailure config: metafield(namespace: "$app:secure_jersey", key: "config") { id compareDigest value } } pageInfo { hasNextPage } }
  validations(first: $first) { nodes { id enabled blockOnFailure shopifyFunction { id handle } config: metafield(namespace: "$app:secure_jersey", key: "config") { id compareDigest value } } pageInfo { hasNextPage } }
}`;
const CREATE_TRANSFORM = `mutation CreateTransform($functionHandle: String!, $blockOnFailure: Boolean!, $metafields: [MetafieldInput!]!) { cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: $blockOnFailure, metafields: $metafields) { cartTransform { id } userErrors { field message code } } }`;
const CREATE_VALIDATION = `mutation CreateValidation($validation: ValidationCreateInput!) { validationCreate(validation: $validation) { validation { id } userErrors { field message code } } }`;
const SET_METAFIELDS = `mutation SetConfigs($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } } }`;
const UPDATE_VALIDATION = `mutation UpdateValidation($id: ID!, $validation: ValidationUpdateInput!) { validationUpdate(id: $id, validation: $validation) { validation { id } userErrors { field message code } } }`;

export async function activateStore({ graphql, shop, config, signingSecret }) {
  if (typeof graphql !== 'function') throw new TypeError('GraphQL client is required.');
  const functionConfig = {
    schema: 1,
    shopFingerprint: await createShopFingerprint(shop),
    signingSecret,
    ...config,
  };
  let discovered = inspect(await graphql(DISCOVER, { first: 100 }));
  if (!discovered.transform) {
    assertMutation('cartTransformCreate', await graphql(CREATE_TRANSFORM, {
      functionHandle: TRANSFORM_HANDLE,
      blockOnFailure: true,
      metafields: [metafield(functionConfig)],
    }), 'cartTransform');
  }
  if (!discovered.validation) {
    assertMutation('validationCreate', await graphql(CREATE_VALIDATION, {
      validation: {
        functionHandle: VALIDATION_HANDLE,
        title: 'Secure jersey bundle validation',
        enable: true,
        blockOnFailure: true,
        metafields: [metafield(functionConfig)],
      },
    }), 'validation');
  }
  discovered = inspect(await graphql(DISCOVER, { first: 100 }));
  if (!discovered.transform || !discovered.validation || discovered.transform.blockOnFailure !== true) {
    throw new StoreActivationError('FUNCTION_REGISTRATIONS_INCOMPLETE');
  }
  const setResult = await graphql(SET_METAFIELDS, {
    metafields: [
      metafield(functionConfig, discovered.transform.id, discovered.transform.config?.compareDigest ?? null),
      metafield(functionConfig, discovered.validation.id, discovered.validation.config?.compareDigest ?? null),
    ],
  });
  assertUserErrors(setResult.metafieldsSet);
  if (setResult.metafieldsSet?.metafields?.length !== 2) {
    throw new StoreActivationError('FUNCTION_CONFIG_WRITE_INCOMPLETE');
  }
  assertMutation('validationUpdate', await graphql(UPDATE_VALIDATION, {
    id: discovered.validation.id,
    validation: { title: 'Secure jersey bundle validation', enable: true, blockOnFailure: true },
  }), 'validation');
  const verified = inspect(await graphql(DISCOVER, { first: 100 }));
  const expectedConfig = JSON.stringify(functionConfig);
  if (!verified.transform || !verified.validation || verified.transform.blockOnFailure !== true
    || verified.validation.enabled !== true || verified.validation.blockOnFailure !== true
    || !sameJson(verified.transform.config?.value, expectedConfig)
    || !sameJson(verified.validation.config?.value, expectedConfig)) {
    throw new StoreActivationError('FUNCTION_READBACK_FAILED');
  }
  return Object.freeze({
    transformRegistrationId: verified.transform.id,
    validationRegistrationId: verified.validation.id,
  });
}

export async function verifySelectedVariants({
  graphql,
  productGid,
  jerseyVariantGids,
  surchargeVariantGids,
}) {
  const variantGids = [...(jerseyVariantGids ?? []), ...(surchargeVariantGids ?? [])];
  if (!/^gid:\/\/shopify\/Product\/[1-9][0-9]{0,31}$/u.test(productGid)
    || !Array.isArray(jerseyVariantGids) || jerseyVariantGids.length !== 4
    || !Array.isArray(surchargeVariantGids) || surchargeVariantGids.length < 1
    || variantGids.length > 68 || new Set(variantGids).size !== variantGids.length
    || variantGids.some((gid) => !/^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]{0,31}$/u.test(gid))) {
    throw new StoreActivationError('PRODUCT_SELECTION_INVALID');
  }
  const data = await graphql(`query VerifyProduct($id: ID!, $variantIds: [ID!]!) {
    shop { currencyCode }
    product(id: $id) { id title }
    nodes(ids: $variantIds) { ... on ProductVariant { id product { id } } }
  }`, { id: productGid, variantIds: variantGids });
  if (data.product?.id !== productGid || !/^[A-Z]{3}$/u.test(data.shop?.currencyCode ?? '')
    || !Array.isArray(data.nodes) || data.nodes.length !== variantGids.length
    || data.nodes.some((node, index) => node?.id !== variantGids[index])
    || data.nodes.slice(0, jerseyVariantGids.length)
      .some((node) => node?.product?.id !== productGid)) {
    throw new StoreActivationError('PRODUCT_SELECTION_NOT_OWNED');
  }
  return Object.freeze({ currency: data.shop.currencyCode, title: data.product.title });
}

export async function listProducts(graphql) {
  const query = `query MerchantProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: TITLE) {
      nodes { id title variants(first: 100) { nodes { id title price } pageInfo { hasNextPage } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const products = [];
  let after = null;
  const cursors = new Set();
  do {
    const data = await graphql(query, { first: 50, after });
    const connection = data.products;
    if (!connection || !Array.isArray(connection.nodes)) {
      throw new StoreActivationError('PRODUCT_CATALOG_INVALID');
    }
    for (const product of connection.nodes) {
      if (!Array.isArray(product.variants?.nodes)) {
        throw new StoreActivationError('PRODUCT_CATALOG_INVALID');
      }
      products.push({ ...product, variantsTruncated: product.variants.pageInfo?.hasNextPage === true });
    }
    if (products.length >= 250) return products.slice(0, 250);
    after = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
    if (connection.pageInfo?.hasNextPage
      && (typeof after !== 'string' || after.length === 0 || cursors.has(after))) {
      throw new StoreActivationError('PRODUCT_CATALOG_INVALID');
    }
    if (after !== null) cursors.add(after);
  } while (after !== null);
  return products;
}

function inspect(data) {
  for (const connection of ['shopifyFunctions', 'cartTransforms', 'validations']) {
    if (data[connection]?.pageInfo?.hasNextPage || !Array.isArray(data[connection]?.nodes)) {
      throw new StoreActivationError('FUNCTION_DISCOVERY_INVALID');
    }
  }
  const transformFunction = data.shopifyFunctions.nodes.find(({ handle }) => handle === TRANSFORM_HANDLE);
  const validationFunction = data.shopifyFunctions.nodes.find(({ handle }) => handle === VALIDATION_HANDLE);
  if (!transformFunction || !validationFunction) throw new StoreActivationError('FUNCTION_EXTENSION_MISSING');
  const transforms = data.cartTransforms.nodes.filter(({ functionId }) => functionId === transformFunction.id);
  const validations = data.validations.nodes.filter(({ shopifyFunction }) => shopifyFunction?.id === validationFunction.id);
  if (transforms.length > 1 || validations.length > 1) throw new StoreActivationError('FUNCTION_REGISTRATION_CONFLICT');
  return { transform: transforms[0] ?? null, validation: validations[0] ?? null };
}

function metafield(value, ownerId, compareDigest) {
  const result = {
    namespace: CONFIG_NAMESPACE,
    key: CONFIG_KEY,
    type: 'json',
    value: JSON.stringify(value),
  };
  if (ownerId) Object.assign(result, { ownerId, compareDigest });
  return result;
}

function assertMutation(name, data, field) {
  const payload = data[name];
  assertUserErrors(payload);
  if (!payload?.[field]?.id) throw new StoreActivationError('FUNCTION_MUTATION_INCOMPLETE');
}

function assertUserErrors(payload) {
  if (!payload || !Array.isArray(payload.userErrors) || payload.userErrors.length > 0) {
    throw new StoreActivationError('FUNCTION_MUTATION_REJECTED');
  }
}

function sameJson(actual, expected) {
  if (typeof actual !== 'string') return false;
  try {
    return stableJson(JSON.parse(actual)) === stableJson(JSON.parse(expected));
  } catch {
    return false;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export class StoreActivationError extends Error {
  constructor(code) {
    super('Shopify store activation failed.');
    this.name = 'StoreActivationError';
    this.code = code;
  }
}
