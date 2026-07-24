import { getCustomTextItems } from './customTextItems.js';
import { getPrintItems } from './printItems.js';

const ITEM_KINDS = new Set(['player', 'text']);

export const PERSONALIZATION_COPY_CANDIDATES = createCopyCandidates();

export function makePersonalizationKey(itemKind, sourceId) {
  if (!ITEM_KINDS.has(itemKind)) throw new TypeError(`Unknown personalization item kind: ${itemKind}`);
  return `${itemKind}:${String(sourceId)}`;
}

export function getSelectablePersonalizationItems(state = {}) {
  const playerItems = state.lighting && state.lighting !== 'none'
    ? getPrintItems(state.overrides).map((item) => withIdentity('player', item))
    : [];
  const textItems = getCustomTextItems(state.overrides)
    .map((item) => withIdentity('text', item));
  return [...playerItems, ...textItems];
}

export function getRenderablePersonalizationItems(state = {}) {
  return getSelectablePersonalizationItems(state)
    .filter((item) => item.itemKind === 'player' || item.text.trim().length > 0);
}

export function findPersonalizationItem(items, key) {
  return items.find((item) => item.key === key) ?? null;
}

function withIdentity(itemKind, item) {
  return {
    ...item,
    itemKind,
    sourceId: item.id,
    key: makePersonalizationKey(itemKind, item.id),
  };
}

function createCopyCandidates() {
  const preferred = [
    { x: 0.3, y: 0.36, z: 0.5 },
    { x: -0.3, y: 0.36, z: 0.5 },
    { x: 0, y: 0.08, z: 0.5 },
  ];
  const grid = [];
  [0.64, 0.36, 0.08, -0.2, -0.48].forEach((y) => {
    [-0.6, -0.3, 0, 0.3, 0.6].forEach((x) => {
      if (preferred.some((candidate) => candidate.x === x && candidate.y === y)) return;
      grid.push({ x, y, z: 0.5 });
    });
  });
  return [...preferred, ...grid];
}
