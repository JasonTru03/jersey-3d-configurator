import { pathToFileURL } from 'node:url';

import {
  TRANSFORM_HANDLE,
  VALIDATION_HANDLE,
  VALIDATION_TITLE,
  assertMutationResult,
  assertUserErrors,
  createAdminGraphqlClient,
  createMetafield,
  createRedactedSummary,
  discover,
  inspectDiscovery,
  loadInstallInput,
  normalizeInstallInput,
  parseCliArgs,
  redactError,
  verifyRemoteConfiguration,
} from './store-config-core.mjs';

export { createAdminGraphqlClient };

export function buildStoreConfig(value) {
  const input = normalizeInstallInput(value);
  return {
    metafield: createMetafield(input.storeConfig),
    log: createRedactedSummary(input),
  };
}

export async function configureStore({ input: rawInput, graphql, dryRun = false } = {}) {
  const input = normalizeInstallInput(rawInput);
  const redactedPlan = {
    mode: dryRun ? 'dry-run' : 'apply',
    ...createRedactedSummary(input),
  };
  if (dryRun) return redactedPlan;
  if (typeof graphql !== 'function') throw new TypeError('graphql must be a function.');

  try {
    const before = await discover(graphql);
    const registrations = inspectDiscovery(before);
    if (registrations.transform && registrations.transform.blockOnFailure !== true) {
      throw new Error(
        'Cart Transform registration has blockOnFailure disabled; the 2026-07 API has no '
        + 'CartTransform update mutation, so resolve this conflicting registration before applying.',
      );
    }

    if (registrations.transform) {
      await updateTransformConfig(
        graphql,
        registrations.transform.id,
        registrations.transform.config?.compareDigest ?? null,
        input.storeConfig,
      );
    } else {
      await createTransform(graphql, input.storeConfig);
    }

    if (registrations.validation) {
      await updateValidation(graphql, registrations.validation.id, input.storeConfig);
    } else {
      await createValidation(graphql, input.storeConfig);
    }

    const after = await discover(graphql);
    return {
      mode: 'applied',
      ...verifyRemoteConfiguration({ input, discovery: after }),
    };
  } catch (error) {
    throw new Error(redactError(error, [
      input.adminAccessToken,
      input.storeConfig.signingSecret,
      JSON.stringify(input.storeConfig),
    ]));
  }
}

async function createTransform(graphql, storeConfig) {
  const operationName = 'CreateSecureJerseyCartTransform';
  const data = await graphql(operationName, {
    functionHandle: TRANSFORM_HANDLE,
    blockOnFailure: true,
    metafields: [createMetafield(storeConfig)],
  });
  assertMutationResult(operationName, data?.cartTransformCreate, 'cartTransform');
}

async function updateTransformConfig(graphql, ownerId, compareDigest, storeConfig) {
  // Admin API 2026-07 exposes cartTransformCreate/Delete but no cartTransformUpdate.
  // CartTransform is a metafield owner, so existing configuration is updated with metafieldsSet.
  const operationName = 'UpdateSecureJerseyCartTransformConfig';
  const data = await graphql(operationName, {
    metafields: [createMetafield(storeConfig, ownerId, compareDigest)],
  });
  const payload = data?.metafieldsSet;
  assertUserErrors(operationName, payload);
  if (!Array.isArray(payload.metafields) || payload.metafields.length !== 1) {
    throw new Error(`${operationName} returned no updated metafield.`);
  }
}

async function createValidation(graphql, storeConfig) {
  const operationName = 'CreateSecureJerseyValidation';
  const data = await graphql(operationName, {
    validation: {
      functionHandle: VALIDATION_HANDLE,
      title: VALIDATION_TITLE,
      enable: true,
      blockOnFailure: true,
      metafields: [createMetafield(storeConfig)],
    },
  });
  assertMutationResult(operationName, data?.validationCreate, 'validation');
}

async function updateValidation(graphql, id, storeConfig) {
  const operationName = 'UpdateSecureJerseyValidation';
  const data = await graphql(operationName, {
    id,
    validation: {
      title: VALIDATION_TITLE,
      enable: true,
      blockOnFailure: true,
      metafields: [createMetafield(storeConfig)],
    },
  });
  assertMutationResult(operationName, data?.validationUpdate, 'validation');
}

async function main() {
  let input;
  try {
    const args = parseCliArgs(process.argv.slice(2), { allowApply: true });
    input = await loadInstallInput({ configPath: args.configPath });
    const dryRun = args.dryRun || !args.apply;
    const graphql = dryRun
      ? async () => {
        throw new Error('Dry-run must not call Shopify.');
      }
      : createAdminGraphqlClient(input);
    const result = await configureStore({ input, graphql, dryRun });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!args.apply && !args.dryRun) {
      process.stdout.write('No remote write was made. Re-run with --apply to configure Shopify.\n');
    }
  } catch (error) {
    process.stderr.write(`${redactError(error, [
      input?.adminAccessToken,
      input?.storeConfig?.signingSecret,
      input?.storeConfig ? JSON.stringify(input.storeConfig) : null,
    ])}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
