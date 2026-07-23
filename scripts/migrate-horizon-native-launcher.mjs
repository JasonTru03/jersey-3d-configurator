import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NATIVE_LAUNCHER_BLOCK_ID = 'product_3d_configurator_launch';

export function migrateHorizonTemplate(template) {
  const result = structuredClone(template);
  const main = result.sections?.main;
  const details = main?.blocks?.['product-details']
    ?? Object.values(main?.blocks ?? {}).find((block) => block?.type === '_product-details');

  if (!main || main.type !== 'product-information' || !details) {
    throw new Error('The Horizon product-information details block is required.');
  }

  const order = Array.isArray(details.block_order) ? [...details.block_order] : [];
  const pickerId = order.find((id) => details.blocks?.[id]?.type === 'variant-picker');
  const buyButtonsId = order.find((id) => details.blocks?.[id]?.type === 'buy-buttons');
  if (!pickerId || !buyButtonsId) {
    throw new Error('The Horizon variant picker and buy buttons are required.');
  }

  const pickerIndex = order.indexOf(pickerId);
  const buyButtonsIndex = order.indexOf(buyButtonsId);
  if (pickerIndex >= buyButtonsIndex) {
    throw new Error('The Horizon variant picker must appear before buy buttons.');
  }

  const legacySectionIds = Object.entries(result.sections)
    .filter(([, section]) => section?.type === 'product-3d-configurator-launch')
    .map(([id]) => id);
  const legacySettings = legacySectionIds
    .map((id) => result.sections[id]?.settings)
    .find(Boolean);

  details.blocks ??= {};
  details.blocks[NATIVE_LAUNCHER_BLOCK_ID] = {
    type: 'product-3d-configurator-launch',
    settings: {
      button_label: legacySettings?.button_label ?? 'Start 3D customization',
      enabled: legacySettings?.enabled ?? true,
    },
  };

  const orderWithoutLauncher = order.filter((id) => id !== NATIVE_LAUNCHER_BLOCK_ID);
  const currentBuyButtonsIndex = orderWithoutLauncher.indexOf(buyButtonsId);
  orderWithoutLauncher.splice(currentBuyButtonsIndex, 0, NATIVE_LAUNCHER_BLOCK_ID);
  details.block_order = orderWithoutLauncher;

  for (const id of legacySectionIds) delete result.sections[id];
  result.order = (result.order ?? []).filter((id) => !legacySectionIds.includes(id));
  return result;
}

export function parseShopifyJsonTemplate(source) {
  const jsonStart = source.indexOf('{');
  if (jsonStart < 0) throw new Error('The Shopify template does not contain JSON.');
  return {
    header: source.slice(0, jsonStart).trimEnd(),
    template: JSON.parse(source.slice(jsonStart)),
  };
}

async function runCli() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    throw new Error('Usage: node scripts/migrate-horizon-native-launcher.mjs INPUT_JSON OUTPUT_JSON');
  }
  const source = await readFile(resolve(inputPath), 'utf8');
  const { header, template } = parseShopifyJsonTemplate(source);
  const migrated = migrateHorizonTemplate(template);
  const output = `${header ? `${header}\n` : ''}${JSON.stringify(migrated, null, 2)}\n`;
  await writeFile(resolve(outputPath), output, 'utf8');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  await runCli();
}
