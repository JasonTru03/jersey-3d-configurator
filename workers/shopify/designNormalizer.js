import {
  MAX_CUSTOM_TEXT_ITEMS,
} from '../../src/features/configurator/config/customTextItems.js';
import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';

const MAX_CUSTOM_TEXT_LENGTH = 24;
const OPTION_IDS = Object.fromEntries(
  ['layout', 'material', 'lighting'].map((group) => [
    group,
    new Set(jerseyProduct.options[group].map((option) => option.id)),
  ]),
);
const EXTRA_IDS = jerseyProduct.options.extras.map((extra) => extra.id);
const EXTRA_ID_SET = new Set(EXTRA_IDS);

export function normalizeDesignState(state) {
  assertPlainObject(state, 'Design state');
  assertKnownValue(state.productId, new Set([jerseyProduct.id]), 'productId');
  assertKnownValue(state.layout, OPTION_IDS.layout, 'layout');
  assertKnownValue(state.material, OPTION_IDS.material, 'material');
  assertKnownValue(state.lighting, OPTION_IDS.lighting, 'lighting');

  assertPlainObject(state.extras, 'extras');
  for (const id of Object.keys(state.extras)) {
    if (!EXTRA_ID_SET.has(id)) throw new TypeError(`Unknown extra "${id}".`);
  }
  const extras = {};
  for (const id of EXTRA_IDS) {
    if (typeof state.extras[id] !== 'boolean') {
      throw new TypeError(`extras.${id} must be a boolean.`);
    }
    extras[id] = state.extras[id];
  }

  assertPlainObject(state.overrides, 'overrides');
  const customTextItems = normalizeCustomTextItems(state.overrides.customTextItems);

  return {
    productId: state.productId,
    layout: state.layout,
    material: state.material,
    lighting: state.lighting,
    extras,
    overrides: { customTextItems },
  };
}

function normalizeCustomTextItems(items = []) {
  if (!Array.isArray(items)) throw new TypeError('overrides.customTextItems must be an array.');
  if (items.length > MAX_CUSTOM_TEXT_ITEMS) {
    throw new RangeError(`overrides.customTextItems cannot contain more than ${MAX_CUSTOM_TEXT_ITEMS} items.`);
  }

  return items.map((item, index) => {
    assertPlainObject(item, `overrides.customTextItems[${index}]`);
    if (typeof item.text !== 'string') {
      throw new TypeError(`overrides.customTextItems[${index}].text must be a string.`);
    }
    if (item.text.length > MAX_CUSTOM_TEXT_LENGTH) {
      throw new RangeError(
        `overrides.customTextItems[${index}].text cannot exceed ${MAX_CUSTOM_TEXT_LENGTH} characters.`,
      );
    }
    return { text: item.text };
  });
}

function assertKnownValue(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new TypeError(`Unknown ${field} "${String(value)}".`);
  }
}

function assertPlainObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${field} must be a plain object.`);
  }
}
