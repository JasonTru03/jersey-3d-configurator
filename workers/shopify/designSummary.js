import {
  APPEARANCE_TEMPLATES,
  APPEARANCE_ZONES,
} from '../../src/features/configurator/config/appearance.js';
import { MAX_DECORATIONS } from '../../src/features/configurator/config/decorations.js';
import { getBillableCustomTextItems } from '../../src/features/configurator/config/customTextItems.js';
import { MAX_PRINT_ITEMS, getPrintItems } from '../../src/features/configurator/config/printItems.js';

export const MAX_DESIGN_SUMMARY_BYTES = 4096;

const TEMPLATE_IDS = new Set(APPEARANCE_TEMPLATES.map(({ id }) => id));
const ZONE_IDS = new Set(APPEARANCE_ZONES);
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;
const URL_LIKE_PATTERN = /^(?:data:|https?:\/\/|\/\/|javascript:|vbscript:|file:)/iu;
const DATA_URL_PATTERN = /data:/iu;
const encoder = new TextEncoder();

export function createDesignSummary({ state, normalizedState, productionFiles } = {}) {
  assertPlainObject(state, 'Design state');
  assertPlainObject(normalizedState, 'Normalized design state');
  const overrides = state.overrides;
  assertPlainObject(overrides, 'Design overrides');

  const summary = {
    Size: validateSummaryText(normalizedState.layout, 'Size', 16),
    Template: summarizeTemplate(overrides.appearance),
    Colors: summarizeColors(overrides.appearance),
    Print: summarizePrint(normalizedState.lighting, overrides),
    'Custom Text': summarizeCustomText(normalizedState.overrides),
    Extras: summarizeExtras(normalizedState.extras),
    Artwork: summarizeArtwork(overrides.decorations),
  };

  const bottomPattern = overrides.bottomPattern;
  if (bottomPattern !== undefined) {
    assertPlainObject(bottomPattern, 'Bottom pattern');
    if (typeof bottomPattern.enabled !== 'boolean') {
      throw new TypeError('Bottom pattern enabled flag must be a boolean.');
    }
  }
  if (bottomPattern?.enabled === true) {
    if (!productionFiles) throw new TypeError('Production files are required for an enabled bottom pattern.');
    Object.assign(summary, {
      'Production Files': 'Local ZIP download',
      'Bundle File': productionFiles.bundleFilename,
      'Design File': productionFiles.designFilename,
      'Atlas File': productionFiles.atlasFilename,
      'UV Atlas SHA-256': productionFiles.atlasSha256,
    });
  }

  for (const [field, value] of Object.entries(summary)) {
    validateSummaryText(value, field, field === 'Colors' ? 512 : 1024);
  }
  if (encoder.encode(JSON.stringify(summary)).byteLength > MAX_DESIGN_SUMMARY_BYTES) {
    throw new RangeError('Design summary exceeds its serialized size limit.');
  }
  return summary;
}

function summarizeTemplate(appearance) {
  assertPlainObject(appearance, 'Appearance');
  if (typeof appearance.template !== 'string' || !TEMPLATE_IDS.has(appearance.template)) {
    throw new TypeError('Appearance template is invalid.');
  }
  return appearance.template;
}

function summarizeColors(appearance) {
  assertPlainObject(appearance.colors, 'Appearance colors');
  const colors = {};
  for (const [zone, color] of Object.entries(appearance.colors)) {
    if (!ZONE_IDS.has(zone)) throw new TypeError(`Appearance color zone "${zone}" is invalid.`);
    if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) {
      throw new TypeError(`Appearance color ${zone} must be a six-digit hex color.`);
    }
    colors[zone] = color.toUpperCase();
  }
  return JSON.stringify(colors);
}

function summarizePrint(lighting, overrides) {
  if (lighting !== 'name-number' && lighting !== 'raised-print') return '';
  if (overrides.printItems !== undefined) {
    if (!Array.isArray(overrides.printItems) || overrides.printItems.length > MAX_PRINT_ITEMS) {
      throw new TypeError(`Print items must contain at most ${MAX_PRINT_ITEMS} entries.`);
    }
  }
  return getPrintItems(overrides).map((player, index) => {
    const name = validatePrintText(player.name, `Print item ${index} name`, 14);
    const number = validatePrintText(player.number, `Print item ${index} number`, 2);
    return name || number ? `${name}${number ? ` #${number}` : ''}`.trim() : '';
  }).filter(Boolean).join(' | ');
}

function validatePrintText(value, field, maximum) {
  const text = validateSummaryText(value, field, maximum).trim();
  if (URL_LIKE_PATTERN.test(text)) {
    throw new TypeError(`${field} is invalid.`);
  }
  return text;
}

function summarizeCustomText(normalizedOverrides) {
  assertPlainObject(normalizedOverrides, 'Normalized design overrides');
  if (!Array.isArray(normalizedOverrides.customTextItems)) {
    throw new TypeError('Normalized custom text items must be an array.');
  }
  return getBillableCustomTextItems(normalizedOverrides.customTextItems)
    .map(({ text }) => validateSummaryText(text.trim(), 'Custom Text', 24))
    .join(' | ');
}

function summarizeExtras(extras) {
  assertPlainObject(extras, 'Normalized extras');
  return Object.entries(extras)
    .filter(([, enabled]) => enabled === true)
    .map(([id]) => validateSummaryText(id, 'Extra ID', 32))
    .join(', ');
}

function summarizeArtwork(decorations = []) {
  if (!Array.isArray(decorations) || decorations.length > MAX_DECORATIONS) {
    throw new TypeError(`Artwork must contain at most ${MAX_DECORATIONS} entries.`);
  }
  return decorations.map((decoration, index) => {
    assertPlainObject(decoration, `Artwork ${index}`);
    const fields = ['id', 'label'].filter((field) => decoration[field] !== undefined);
    if (!fields.includes('id')) throw new TypeError(`Artwork ${index} must have an ID.`);
    for (const field of fields) {
      const text = validateSummaryText(decoration[field], `Artwork ${index} ${field}`, 64).trim();
      if (!text || URL_LIKE_PATTERN.test(text)) {
        throw new TypeError(`Artwork ${index} ${field} must be safe plain text.`);
      }
    }
    return (decoration.label ?? decoration.id).trim();
  }).join(', ');
}

function validateSummaryText(value, field, maximum) {
  if (
    typeof value !== 'string'
    || value.length > maximum
    || CONTROL_CHARACTER_PATTERN.test(value)
    || DATA_URL_PATTERN.test(value)
  ) {
    throw new TypeError(`${field} must be bounded plain text.`);
  }
  return value;
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
