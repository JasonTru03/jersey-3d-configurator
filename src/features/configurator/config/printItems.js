export const MAX_PRINT_ITEMS = 8;
export const MIN_PRINT_SCALE = 0.55;
export const MAX_PRINT_SCALE = 1.8;

export function createPrintItem({
  id = 'print-1',
  name = 'PLAYER',
  number = '16',
  placement = null,
  scale = 1,
  rotation = 0,
} = {}) {
  return {
    id: String(id),
    name,
    number,
    placement,
    rotation: normalizeRotation(rotation),
    scale: clamp(scale, MIN_PRINT_SCALE, MAX_PRINT_SCALE),
  };
}

export function getPrintItems(overrides = {}) {
  if (Array.isArray(overrides.printItems)) {
    const sourceItems = overrides.printItems.slice(0, MAX_PRINT_ITEMS);
    const reservedIds = new Set(sourceItems
      .filter((item) => item?.id !== undefined && item?.id !== null)
      .map((item) => String(item.id)));
    const usedIds = new Set();

    return sourceItems.map((item, index) => {
      const explicitId = item?.id === undefined || item?.id === null ? null : String(item.id);
      const id = explicitId && !usedIds.has(explicitId)
        ? explicitId
        : nextAvailablePrintId(usedIds, reservedIds, index + 1);
      usedIds.add(id);
      return createPrintItem({ ...item, id });
    });
  }

  if (!overrides.printName && !overrides.printNumber && !overrides.printPlacement) return [];

  return [createPrintItem({
    name: overrides.printName,
    number: overrides.printNumber,
    placement: overrides.printPlacement,
  })];
}

export function ensurePrintItems(items) {
  if (items.length) return items;
  return [createPrintItem()];
}

export function patchPrintItem(items, id, patch) {
  return items.map((item) => (
    item.id === id ? createPrintItem({ ...item, ...patch, id: item.id }) : item
  ));
}

export function removePrintItem(items, id) {
  return items.filter((item) => item.id !== id);
}

export function duplicatePrintItem(items, id, placement) {
  if (items.length >= MAX_PRINT_ITEMS || !placement) return null;
  const source = items.find((item) => item.id === id);
  if (!source) return null;
  return createPrintItem({ ...source, id: nextPrintId(items), placement });
}

export function legacyFirstItemFields(items) {
  const first = items[0];
  return {
    printName: first?.name ?? '',
    printNumber: first?.number ?? '',
    printPlacement: first?.placement ?? null,
  };
}

function nextPrintId(items) {
  let number = items.length + 1;
  while (items.some((item) => item.id === `print-${number}`)) number += 1;
  return `print-${number}`;
}

function nextAvailablePrintId(usedIds, reservedIds, startNumber) {
  let number = startNumber;
  while (usedIds.has(`print-${number}`) || reservedIds.has(`print-${number}`)) number += 1;
  return `print-${number}`;
}

function normalizeRotation(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}
