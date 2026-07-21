import { normalizeAppearance } from './appearance.js';

export function findOption(product, group, id) {
  return product.options[group]?.find((option) => option.id === id) ?? null;
}

export function selectedOptions(product, state) {
  const colorway = findOption(product, 'colorway', state.colorway);
  return {
    layout: findOption(product, 'layout', state.layout),
    colorway,
    material: findOption(product, 'material', state.material),
    lighting: findOption(product, 'lighting', state.lighting),
    extras: product.options.extras.filter((extra) => Boolean(state.extras?.[extra.id])),
    appearance: normalizeAppearance(state.overrides?.appearance, colorway?.swatches),
  };
}
