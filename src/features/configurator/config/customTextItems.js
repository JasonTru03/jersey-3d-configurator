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
    text: String(text).slice(0, 24),
    fontPreset: FONT_IDS.has(fontPreset) ? fontPreset : CUSTOM_TEXT_FONT_PRESETS[0].id,
    fillColor: normalizeColor(fillColor, '#20242A'),
    outlineEnabled: Boolean(outlineEnabled),
    outlineColor: normalizeColor(outlineColor, '#F7F5EF'),
    letterSpacing: clamp(letterSpacing, 0, 20),
    placement,
    scale: clamp(scale, MIN_SCALE, MAX_SCALE),
    rotation: normalizeRotation(rotation),
  };
}

export function getCustomTextItems(overrides = {}) {
  if (overrides.customTextItems === undefined) return [];
  if (!Array.isArray(overrides.customTextItems)) {
    throw new TypeError('Custom text items must be an array.');
  }
  return overrides.customTextItems
    .slice(0, MAX_CUSTOM_TEXT_ITEMS)
    .map((item, index) => createCustomTextItem({
      ...item,
      id: item?.id ?? `text-${index + 1}`,
    }));
}

export function getBillableCustomTextItems(items) {
  return items.filter((item) => item.text.trim().length > 0);
}

export function patchCustomTextItem(items, id, patch) {
  return items.map((item) => (
    item.id === id ? createCustomTextItem({ ...item, ...patch }) : item
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

function normalizeColor(value, fallback) {
  const color = String(value).toUpperCase();
  return HEX_COLOR.test(color) ? color : fallback;
}

function normalizeRotation(value) {
  const rotation = Number(value);
  if (!Number.isFinite(rotation)) return 0;
  return ((rotation % 360) + 360) % 360;
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}
