export const CUSTOM_TEXT_PRICE = 8;
export const MAX_CUSTOM_TEXT_ITEMS = 8;
export const CUSTOM_TEXT_FONT_PRESETS = [
  { id: 'athletic', label: 'Athletic', family: 'Arial Black, Arial, sans-serif' },
  { id: 'block', label: 'Block', family: 'Impact, Arial Black, sans-serif' },
  { id: 'modern', label: 'Modern', family: 'Arial, Helvetica, sans-serif' },
  { id: 'classic', label: 'Classic', family: 'Georgia, Times New Roman, serif' },
];

const FONT_IDS = new Set(CUSTOM_TEXT_FONT_PRESETS.map((font) => font.id));
const HEX_COLOR = /^#[0-9A-F]{6}$/;
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.8;

export function createCustomTextItem({
  id = 'text-1',
  text = '',
  fontPreset = 'athletic',
  fillColor = '#20242A',
  outlineEnabled = true,
  outlineColor = '#F7F5EF',
  letterSpacing = 0,
  placement = null,
  scale = 1,
  rotation = 0,
} = {}) {
  return {
    id: String(id),
    text: typeof text === 'string' ? text.slice(0, 24) : '',
    fontPreset: FONT_IDS.has(fontPreset) ? fontPreset : CUSTOM_TEXT_FONT_PRESETS[0].id,
    fillColor: normalizeColor(fillColor, '#20242A'),
    outlineEnabled: Boolean(outlineEnabled),
    outlineColor: normalizeColor(outlineColor, '#F7F5EF'),
    letterSpacing: clamp(letterSpacing, 0, 20, 0),
    placement,
    scale: clamp(scale, MIN_SCALE, MAX_SCALE, 1),
    rotation: normalizeRotation(rotation),
  };
}

export function getCustomTextItems(overrides = {}) {
  if (overrides.customTextItems === undefined) return [];
  if (!Array.isArray(overrides.customTextItems)) {
    throw new TypeError('Custom text items must be an array.');
  }

  const sourceItems = overrides.customTextItems.slice(0, MAX_CUSTOM_TEXT_ITEMS);
  const reservedIds = new Set(sourceItems
    .filter((item) => item?.id !== undefined && item?.id !== null)
    .map((item) => String(item.id)));
  const usedIds = new Set();

  return sourceItems.map((item, index) => {
    const explicitId = item?.id === undefined || item?.id === null ? null : String(item.id);
    const id = explicitId && !usedIds.has(explicitId)
      ? explicitId
      : nextAvailableTextId(usedIds, reservedIds, index + 1);
    usedIds.add(id);
    return createCustomTextItem({ ...item, id });
  });
}

export function getBillableCustomTextItems(items) {
  return items.filter((item) => item.text.trim().length > 0);
}

export function patchCustomTextItem(items, id, patch) {
  return items.map((item) => (
    item.id === id ? createCustomTextItem({ ...item, ...patch, id: item.id }) : item
  ));
}

export function removeCustomTextItem(items, id) {
  return items.filter((item) => item.id !== id);
}

export function duplicateCustomTextItem(items, id, placement) {
  if (items.length >= MAX_CUSTOM_TEXT_ITEMS || !placement) return null;
  const source = items.find((item) => item.id === id);
  if (!source) return null;
  return createCustomTextItem({
    ...source,
    id: nextTextId(items),
    placement,
  });
}

export function nextTextId(items) {
  let number = items.length + 1;
  while (items.some((item) => item.id === `text-${number}`)) number += 1;
  return `text-${number}`;
}

function nextAvailableTextId(usedIds, reservedIds, startNumber) {
  let number = startNumber;
  while (usedIds.has(`text-${number}`) || reservedIds.has(`text-${number}`)) number += 1;
  return `text-${number}`;
}

function normalizeColor(value, fallback) {
  const color = String(value).toUpperCase();
  return HEX_COLOR.test(color) ? color : fallback;
}

function normalizeRotation(value) {
  const rotation = Number(value);
  if (!Number.isFinite(rotation)) return 0;
  return ((rotation % 360) + 360) % 360;
}

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}