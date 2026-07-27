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
    let registrations = inspectDiscovery(before);
    if (registrations.transform && registrations.transform.blockOnFailure !== true) {
      throw new Error(
        'Cart Transform registration has blockOnFailure disabled; the 2026-07 API has no '
        + 'CartTransform update mutation, so resolve this conflicting registration before applying.',
      );
    }

    let createdRegistration = false;
    if (!registrations.transform) {
      await createTransform(graphql, input.storeConfig);
      createdRegistration = true;
    }

    if (!registrations.validation) {
      await createValidation(graphql, input.storeConfig);
      createdRegistration = true;
    }

    if (createdRegistration) {
      registrations = inspectDiscovery(await discover(graphql));
    }
    if (!registrations.transform || !registrations.validation) {
      throw new Error('Secure jersey registrations are incomplete after creation.');
    }
    if (registrations.transform.blockOnFailure !== true) {
      throw new Error('Cart Transform registration must block on failure.');
    }

    await updateOwnerConfigs(graphql, registrations, input.storeConfig);
    await updateValidationSettings(graphql, registrations.validation.id);

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

async function updateOwnerConfigs(graphql, registrations, storeConfig) {
  // Admin API 2026-07 exposes cartTransformCreate/Delete but no cartTransformUpdate.
  // Both registration owners are updated atomically with compare-and-set metafieldsSet.
  const operationName = 'UpdateSecureJerseyOwnerConfigs';
  const data = await graphql(operationName, {
    metafields: [
      createMetafield(
        storeConfig,
        registrations.transform.id,
        registrations.transform.config?.compareDigest ?? null,
      ),
      createMetafield(
        storeConfig,
        registrations.validation.id,
        registrations.validation.config?.compareDigest ?? null,
      ),
    ],
  });
  const payload = data?.metafieldsSet;
  assertUserErrors(operationName, payload);
  if (!Array.isArray(payload.metafields) || payload.metafields.length !== 2) {
    throw new Error(`${operationName} did not update both owner metafields.`);
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

async function updateValidationSettings(graphql, id) {
  const operationName = 'UpdateSecureJerseyValidation';
  const data = await graphql(operationName, {
    id,
    validation: {
      title: VALIDATION_TITLE,
      enable: true,
      blockOnFailure: true,
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
