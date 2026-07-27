import { pathToFileURL } from 'node:url';

import {
  createAdminGraphqlClient,
  createRedactedSummary,
  discover,
  loadInstallInput,
  normalizeInstallInput,
  parseCliArgs,
  redactError,
  verifyRemoteConfiguration,
} from './store-config-core.mjs';

export async function readStoreConfig({ input: rawInput, graphql, dryRun = false } = {}) {
  const input = normalizeInstallInput(rawInput);
  if (dryRun) {
    return {
      mode: 'dry-run',
      ...createRedactedSummary(input),
    };
  }
  if (typeof graphql !== 'function') throw new TypeError('graphql must be a function.');
  try {
    const remote = await discover(graphql);
    return {
      mode: 'read-back',
      ...verifyRemoteConfiguration({ input, discovery: remote }),
    };
  } catch (error) {
    throw new Error(redactError(error, [
      input.adminAccessToken,
      input.storeConfig.signingSecret,
      JSON.stringify(input.storeConfig),
    ]));
  }
}

async function main() {
  let input;
  try {
    const args = parseCliArgs(process.argv.slice(2));
    input = await loadInstallInput({ configPath: args.configPath });
    const graphql = args.dryRun
      ? async () => {
        throw new Error('Dry-run must not call Shopify.');
      }
      : createAdminGraphqlClient(input);
    const result = await readStoreConfig({ input, graphql, dryRun: args.dryRun });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
