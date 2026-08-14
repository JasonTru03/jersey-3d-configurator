import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildStoreConfig,
  configureStore,
  createAdminGraphqlClient,
} from './configure-store.mjs';
import { readStoreConfig } from './read-store-config.mjs';
import { OPERATIONS } from './store-config-core.mjs';

const SECRET = '0123456789abcdef0123456789abcdef';
const TOKEN = `${'sh'}${'pat_'}0123456789abcdef0123456789abcdef`;
const SHOP = 'test-store.myshopify.com';
const TRANSFORM_HANDLE = 'secure-jersey-transform';
const VALIDATION_HANDLE = 'secure-jersey-validation';

function input(overrides = {}) {
  return {
    shop: SHOP,
    adminAccessToken: TOKEN,
    storeConfig: {
      schema: 1,
      shopFingerprint: 'shop_pOkgoffXsXsw',
      signingSecret: SECRET,
      productId: 'fn8788-jersey',
      currency: 'USD',
      jerseyVariants: {
        s: '11111111111111',
        m: '22222222222222',
        l: '33333333333333',
        xl: '44444444444444',
      },
      surchargeVariants: {
        8: '55555555555555',
        12: '66666666666666',
        20: '77777777777777',
      },
      ...overrides,
    },
  };
}

function configValue(overrides = {}) {
  return buildStoreConfig(input(overrides)).metafield.value;
}

function surchargeMap(count) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      String(index + 1),
      String(10_000 + index),
    ]),
  );
}

function discovery({
  transformId,
  validationId,
  transformConfig = configValue(),
  validationConfig = configValue(),
  duplicateTransform = false,
  duplicateValidation = false,
  foreignConfigOwner = false,
} = {}) {
  const transforms = [];
  if (transformId) {
    transforms.push({
      id: transformId,
      functionId: 'fn-transform',
      blockOnFailure: true,
      config: {
        id: 'mf-transform',
        type: 'json',
        value: transformConfig,
        compareDigest: 'digest-transform',
      },
    });
  }
  if (duplicateTransform) {
    transforms.push({
      id: 'gid://shopify/CartTransform/duplicate',
      functionId: 'fn-transform',
      blockOnFailure: true,
      config: {
        id: 'mf-duplicate-transform',
        type: 'json',
        value: transformConfig,
        compareDigest: 'digest-duplicate-transform',
      },
    });
  }
  if (foreignConfigOwner) {
    transforms.push({
      id: 'gid://shopify/CartTransform/foreign',
      functionId: 'fn-other',
      blockOnFailure: true,
      config: {
        id: 'mf-foreign',
        type: 'json',
        value: transformConfig,
        compareDigest: 'digest-foreign',
      },
    });
  }
  const validations = [];
  if (validationId) {
    validations.push({
      id: validationId,
      title: 'Secure jersey bundle validation',
      enabled: true,
      blockOnFailure: true,
      shopifyFunction: { id: 'fn-validation', handle: VALIDATION_HANDLE },
      config: {
        id: 'mf-validation',
        type: 'json',
        value: validationConfig,
        compareDigest: 'digest-validation',
      },
    });
  }
  if (duplicateValidation) {
    validations.push({
      id: 'gid://shopify/Validation/duplicate',
      title: 'Duplicate',
      enabled: true,
      blockOnFailure: true,
      shopifyFunction: { id: 'fn-validation-2', handle: VALIDATION_HANDLE },
      config: {
        id: 'mf-duplicate-validation',
        type: 'json',
        value: validationConfig,
        compareDigest: 'digest-duplicate-validation',
      },
    });
  }
  return {
    shopifyFunctions: {
      nodes: [
        { id: 'fn-transform', handle: TRANSFORM_HANDLE },
        { id: 'fn-validation', handle: VALIDATION_HANDLE },
      ],
      pageInfo: { hasNextPage: false },
    },
    cartTransforms: {
      nodes: transforms,
      pageInfo: { hasNextPage: false },
    },
    validations: {
      nodes: validations,
      pageInfo: { hasNextPage: false },
    },
  };
}

function operationMock(sequence) {
  const calls = [];
  const graphql = async (operationName, variables) => {
    calls.push({ operationName, variables });
    const next = sequence.shift();
    assert.ok(next, `Unexpected GraphQL operation ${operationName}.`);
    assert.equal(operationName, next.operationName);
    if (next.error) throw next.error;
    return typeof next.data === 'function' ? next.data(variables) : next.data;
  };
  return { calls, graphql };
}

test('builds the exact seven-field app-owned JSON config and redacts credentials', () => {
  const result = buildStoreConfig(input());
  assert.equal(result.metafield.namespace, '$app:secure_jersey');
  assert.equal(result.metafield.key, 'config');
  assert.equal(result.metafield.type, 'json');
  assert.deepEqual(Object.keys(JSON.parse(result.metafield.value)), [
    'schema',
    'shopFingerprint',
    'signingSecret',
    'productId',
    'currency',
    'jerseyVariants',
    'surchargeVariants',
  ]);
  const serializedLog = JSON.stringify(result.log);
  assert.doesNotMatch(serializedLog, new RegExp(SECRET));
  assert.doesNotMatch(serializedLog, new RegExp(TOKEN));
  assert.match(result.log.signingSecretSha256, /^[a-f0-9]{64}$/);
});

test('accepts Shopify authorization-code Admin tokens', () => {
  const result = buildStoreConfig({
    ...input(),
    adminAccessToken: 'shpua_' + '0123456789abcdef0123456789abcdef',
  });
  assert.equal(result.metafield.namespace, '$app:secure_jersey');
});

test('accepts Shopify client-credentials Admin tokens', () => {
  const result = buildStoreConfig({
    ...input(),
    adminAccessToken: 'shpca_' + '0123456789abcdef0123456789abcdef',
  });
  assert.equal(result.metafield.namespace, '$app:secure_jersey');
});

test('uses the 2026-07 handle mutations and both registration-owned metafields', () => {
  assert.match(OPERATIONS.CreateSecureJerseyCartTransform, /functionHandle/u);
  assert.doesNotMatch(OPERATIONS.CreateSecureJerseyCartTransform, /functionId/u);
  assert.match(OPERATIONS.CreateSecureJerseyValidation, /validationCreate/u);
  assert.doesNotMatch(OPERATIONS.CreateSecureJerseyValidation, /cartValidationCreate/u);
  assert.match(OPERATIONS.UpdateSecureJerseyOwnerConfigs, /metafieldsSet/u);
  assert.match(OPERATIONS.DiscoverSecureJerseyRegistrations, /cartTransforms[\s\S]*metafield/u);
  assert.match(OPERATIONS.DiscoverSecureJerseyRegistrations, /validations[\s\S]*metafield/u);
});

test('rejects malformed domains, tokens, IDs, maps, overlaps, and short secrets', () => {
  const cases = [
    [{ ...input(), shop: 'https://test-store.myshopify.com' }, /shop domain/i],
    [{ ...input(), adminAccessToken: 'short' }, /Admin access token/i],
    [input({ shopFingerprint: 'shop_AAAAAAAAAAAA' }), /shop domain/i],
    [input({ signingSecret: 'short' }), /signingSecret/i],
    [input({ currency: 'EUR' }), /currency/i],
    [input({ productId: 'gid://shopify/Product/1' }), /productId/i],
    [input({ jerseyVariants: { s: '1', m: '2', l: '3' } }), /jerseyVariants/i],
    [input({ jerseyVariants: { s: '1', m: '2', l: '3', xl: '2' } }), /reuses/i],
    [input({ surchargeVariants: { 0: '9' } }), /surchargeVariants/i],
    [input({ surchargeVariants: surchargeMap(65) }), /at most 64/i],
    [input({
      jerseyVariants: { s: '1', m: '2', l: '3', xl: '4' },
      surchargeVariants: { 8: '1' },
    }), /conflicts/i],
  ];
  for (const [candidate, error] of cases) {
    assert.throws(() => buildStoreConfig(candidate), error);
  }
});

test('dry-run validates and plans without calling Shopify', async () => {
  let called = false;
  const result = await configureStore({
    input: input(),
    dryRun: true,
    graphql: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.transform.functionHandle, TRANSFORM_HANDLE);
  assert.equal(result.validation.functionHandle, VALIDATION_HANDLE);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
});

test('creates both registrations with owner metafields, then verifies read-back', async () => {
  const after = discovery({
    transformId: 'gid://shopify/CartTransform/1',
    validationId: 'gid://shopify/Validation/2',
  });
  const mock = operationMock([
    { operationName: 'DiscoverSecureJerseyRegistrations', data: discovery() },
    {
      operationName: 'CreateSecureJerseyCartTransform',
      data: {
        cartTransformCreate: {
          cartTransform: { id: 'gid://shopify/CartTransform/1' },
          userErrors: [],
        },
      },
    },
    {
      operationName: 'CreateSecureJerseyValidation',
      data: {
        validationCreate: {
          validation: { id: 'gid://shopify/Validation/2' },
          userErrors: [],
        },
      },
    },
    { operationName: 'DiscoverSecureJerseyRegistrations', data: after },
    {
      operationName: 'UpdateSecureJerseyOwnerConfigs',
      data: {
        metafieldsSet: {
          metafields: [{ id: 'mf-transform' }, { id: 'mf-validation' }],
          userErrors: [],
        },
      },
    },
    {
      operationName: 'UpdateSecureJerseyValidation',
      data: {
        validationUpdate: {
          validation: { id: 'gid://shopify/Validation/2' },
          userErrors: [],
        },
      },
    },
    { operationName: 'DiscoverSecureJerseyRegistrations', data: after },
  ]);

  const result = await configureStore({ input: input(), graphql: mock.graphql });
  assert.equal(result.transform.registrationId, 'gid://shopify/CartTransform/1');
  assert.equal(result.validation.registrationId, 'gid://shopify/Validation/2');
  const createTransform = mock.calls[1].variables;
  assert.equal(createTransform.functionHandle, TRANSFORM_HANDLE);
  assert.equal(createTransform.blockOnFailure, true);
  assert.equal(createTransform.metafields[0].value, configValue());
  const createValidation = mock.calls[2].variables.validation;
  assert.equal(createValidation.functionHandle, VALIDATION_HANDLE);
  assert.equal(createValidation.enable, true);
  assert.equal(createValidation.metafields[0].value, configValue());
  assert.equal(mock.calls[4].variables.metafields.length, 2);
  assert.equal(mock.calls[4].variables.metafields[0].compareDigest, 'digest-transform');
  assert.equal(mock.calls[4].variables.metafields[1].compareDigest, 'digest-validation');
  assert.equal(Object.hasOwn(mock.calls[5].variables.validation, 'metafields'), false);
});

test('updates existing owners without creating duplicate registrations', async () => {
  const before = discovery({
    transformId: 'gid://shopify/CartTransform/1',
    validationId: 'gid://shopify/Validation/2',
    transformConfig: configValue({ signingSecret: 'a'.repeat(32) }),
    validationConfig: configValue({ signingSecret: 'a'.repeat(32) }),
  });
  const after = discovery({
    transformId: 'gid://shopify/CartTransform/1',
    validationId: 'gid://shopify/Validation/2',
  });
  const mock = operationMock([
    { operationName: 'DiscoverSecureJerseyRegistrations', data: before },
    {
      operationName: 'UpdateSecureJerseyOwnerConfigs',
      data: {
        metafieldsSet: {
          metafields: [{ id: 'mf-transform' }, { id: 'mf-validation' }],
          userErrors: [],
        },
      },
    },
    {
      operationName: 'UpdateSecureJerseyValidation',
      data: {
        validationUpdate: {
          validation: { id: 'gid://shopify/Validation/2' },
          userErrors: [],
        },
      },
    },
    { operationName: 'DiscoverSecureJerseyRegistrations', data: after },
  ]);

  const result = await configureStore({ input: input(), graphql: mock.graphql });
  assert.deepEqual(
    mock.calls.map(({ operationName }) => operationName),
    [
      'DiscoverSecureJerseyRegistrations',
      'UpdateSecureJerseyOwnerConfigs',
      'UpdateSecureJerseyValidation',
      'DiscoverSecureJerseyRegistrations',
    ],
  );
  assert.equal(mock.calls[1].variables.metafields.length, 2);
  assert.equal(mock.calls[1].variables.metafields[0].ownerId, result.transform.registrationId);
  assert.equal(mock.calls[1].variables.metafields[0].compareDigest, 'digest-transform');
  assert.equal(mock.calls[1].variables.metafields[1].ownerId, result.validation.registrationId);
  assert.equal(mock.calls[1].variables.metafields[1].compareDigest, 'digest-validation');
  assert.equal(mock.calls[2].variables.id, result.validation.registrationId);
  assert.equal(Object.hasOwn(mock.calls[2].variables.validation, 'metafields'), false);
});

test('is repeatable with stable IDs and performs no duplicate creates', async () => {
  const configured = discovery({
    transformId: 'gid://shopify/CartTransform/1',
    validationId: 'gid://shopify/Validation/2',
  });
  const mock = operationMock([
    { operationName: 'DiscoverSecureJerseyRegistrations', data: configured },
    {
      operationName: 'UpdateSecureJerseyOwnerConfigs',
      data: {
        metafieldsSet: {
          metafields: [{ id: 'mf-transform' }, { id: 'mf-validation' }],
          userErrors: [],
        },
      },
    },
    {
      operationName: 'UpdateSecureJerseyValidation',
      data: {
        validationUpdate: {
          validation: { id: 'gid://shopify/Validation/2' },
          userErrors: [],
        },
      },
    },
    { operationName: 'DiscoverSecureJerseyRegistrations', data: configured },
  ]);
  const result = await configureStore({ input: input(), graphql: mock.graphql });
  assert.equal(result.transform.registrationId, 'gid://shopify/CartTransform/1');
  assert.equal(result.validation.registrationId, 'gid://shopify/Validation/2');
  assert.ok(mock.calls.every(({ operationName }) => !operationName.includes('Create')));
});

test('aborts both owner config writes on a compare-and-set conflict', async () => {
  const configured = discovery({
    transformId: 'gid://shopify/CartTransform/1',
    validationId: 'gid://shopify/Validation/2',
  });
  for (const conflictingOwnerIndex of [0, 1]) {
    const mock = operationMock([
      { operationName: 'DiscoverSecureJerseyRegistrations', data: configured },
      {
        operationName: 'UpdateSecureJerseyOwnerConfigs',
        data: {
          metafieldsSet: {
            metafields: [],
            userErrors: [{
              field: ['metafields', String(conflictingOwnerIndex), 'compareDigest'],
              message: 'The compare digest does not match.',
            }],
          },
        },
      },
    ]);
    await assert.rejects(
      configureStore({ input: input(), graphql: mock.graphql }),
      /compare digest/i,
    );
    assert.deepEqual(
      mock.calls.map(({ operationName }) => operationName),
      ['DiscoverSecureJerseyRegistrations', 'UpdateSecureJerseyOwnerConfigs'],
    );
  }
});

test('fails closed on partial mutation failure and conflicting owned records', async () => {
  const partial = operationMock([
    { operationName: 'DiscoverSecureJerseyRegistrations', data: discovery() },
    {
      operationName: 'CreateSecureJerseyCartTransform',
      data: {
        cartTransformCreate: {
          cartTransform: { id: 'gid://shopify/CartTransform/1' },
          userErrors: [],
        },
      },
    },
    {
      operationName: 'CreateSecureJerseyValidation',
      data: {
        validationCreate: {
          validation: null,
          userErrors: [{ field: ['validation'], message: 'Rejected.' }],
        },
      },
    },
  ]);
  await assert.rejects(
    configureStore({ input: input(), graphql: partial.graphql }),
    /CreateSecureJerseyValidation.*Rejected/i,
  );

  for (const conflict of [
    discovery({ duplicateTransform: true, transformId: 'gid://shopify/CartTransform/1' }),
    discovery({ duplicateValidation: true, validationId: 'gid://shopify/Validation/2' }),
    discovery({ foreignConfigOwner: true }),
  ]) {
    await assert.rejects(
      configureStore({ input: input(), graphql: async () => conflict }),
      /conflict/i,
    );
  }
});

test('read-back requires two identical owner configs and emits only fingerprints', async () => {
  const configured = discovery({
    transformId: 'gid://shopify/CartTransform/1',
    validationId: 'gid://shopify/Validation/2',
  });
  const result = await readStoreConfig({
    input: input(),
    graphql: async () => configured,
  });
  assert.equal(result.transform.registrationId, 'gid://shopify/CartTransform/1');
  assert.equal(result.validation.registrationId, 'gid://shopify/Validation/2');
  assert.match(result.signingSecretSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));

  await assert.rejects(
    readStoreConfig({
      input: input(),
      graphql: async () => discovery({
        transformId: 'gid://shopify/CartTransform/1',
        validationId: 'gid://shopify/Validation/2',
        validationConfig: configValue({ signingSecret: 'b'.repeat(32) }),
      }),
    }),
    /does not match/i,
  );
});

test('Admin GraphQL client rejects HTTP and GraphQL errors without leaking credentials', async () => {
  const httpClient = createAdminGraphqlClient({
    shop: SHOP,
    adminAccessToken: TOKEN,
    fetchImpl: async () => new Response('bad gateway', { status: 502 }),
  });
  await assert.rejects(
    httpClient('DiscoverSecureJerseyRegistrations', { first: 100 }),
    /HTTP 502/,
  );

  const graphqlClient = createAdminGraphqlClient({
    shop: SHOP,
    adminAccessToken: TOKEN,
    storeConfig: input().storeConfig,
    sensitiveValues: [SECRET],
    fetchImpl: async () => Response.json({
      errors: [{ message: `bad ${TOKEN} ${SECRET} ${configValue()}` }],
    }),
  });
  await assert.rejects(
    graphqlClient('DiscoverSecureJerseyRegistrations', { first: 100 }),
    (error) => (
      !error.message.includes(TOKEN)
      && !error.message.includes(SECRET)
      && !error.message.includes(configValue())
    ),
  );
});
