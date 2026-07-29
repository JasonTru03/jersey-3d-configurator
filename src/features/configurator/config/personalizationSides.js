export const PERSONALIZATION_SIDES = Object.freeze([
  Object.freeze({ id: 'front', label: 'Front' }),
  Object.freeze({ id: 'back', label: 'Back' }),
]);

const SIDE_PLACEMENTS = Object.freeze({
  front: Object.freeze({ x: 0, y: 0.36, z: 0.5, normal: Object.freeze({ x: 0, y: 0, z: 1 }) }),
  back: Object.freeze({ x: 0, y: 0.36, z: -0.5, normal: Object.freeze({ x: 0, y: 0, z: -1 }) }),
});

export function getPersonalizationSide(placement) {
  const normalZ = Number(placement?.normal?.z);
  if (Number.isFinite(normalZ) && normalZ < 0) return 'back';
  return Number(placement?.z) < 0 ? 'back' : 'front';
}

export function getPersonalizationSidePlacement(side) {
  const placement = SIDE_PLACEMENTS[side] ?? SIDE_PLACEMENTS.front;
  return { ...placement, normal: { ...placement.normal } };
}
