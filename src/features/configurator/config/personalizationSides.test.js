import { describe, expect, it } from 'vitest';
import {
  getPersonalizationSide,
  getPersonalizationSidePlacement,
  PERSONALIZATION_SIDES,
} from './personalizationSides.js';

describe('personalization sides', () => {
  it('defines the supported front and back sides', () => {
    expect(PERSONALIZATION_SIDES).toEqual([
      { id: 'front', label: 'Front' },
      { id: 'back', label: 'Back' },
    ]);
    expect(Object.isFrozen(PERSONALIZATION_SIDES)).toBe(true);
    PERSONALIZATION_SIDES.forEach((side) => {
      expect(Object.isFrozen(side)).toBe(true);
    });
  });

  it('returns an independent back placement object', () => {
    const firstPlacement = getPersonalizationSidePlacement('back');
    const secondPlacement = getPersonalizationSidePlacement('back');

    expect(firstPlacement).toEqual({
      x: 0,
      y: 0.36,
      z: -0.5,
      normal: { x: 0, y: 0, z: -1 },
    });
    expect(secondPlacement).toEqual(firstPlacement);
    expect(secondPlacement).not.toBe(firstPlacement);
    expect(secondPlacement.normal).not.toBe(firstPlacement.normal);
  });

  it('uses an independent front placement for unknown sides', () => {
    const frontPlacement = getPersonalizationSidePlacement();
    const unknownPlacement = getPersonalizationSidePlacement('sleeve');

    expect(frontPlacement).toEqual({
      x: 0,
      y: 0.36,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    });
    expect(unknownPlacement).toEqual(frontPlacement);
    expect(unknownPlacement).not.toBe(frontPlacement);
    expect(unknownPlacement.normal).not.toBe(frontPlacement.normal);
  });

  it('determines a side from normal before placement and defaults null to front', () => {
    expect(getPersonalizationSide({ z: 0.5, normal: { z: -1 } })).toBe('back');
    expect(getPersonalizationSide({ z: -0.5, normal: { z: 1 } })).toBe('front');
    expect(getPersonalizationSide({ z: -0.5, normal: { z: 0 } })).toBe('front');
    expect(getPersonalizationSide({ z: -0.5 })).toBe('back');
    expect(getPersonalizationSide({ z: 0.5, normal: { z: '-1' } })).toBe('front');
    expect(getPersonalizationSide({ z: -0.5, normal: { z: '1' } })).toBe('back');
    expect(getPersonalizationSide(null)).toBe('front');
  });
});
