import { describe, expect, it } from 'vitest';
import { getRegionAnchor, toSpriteTransform } from './decorationEditor.js';

describe('decoration editor geometry', () => {
  it('clamps a sprite transform to the editable range', () => {
    expect(toSpriteTransform({ x: 9, y: -9, scale: 9, rotation: 300 })).toEqual({
      x: 1,
      y: -1,
      scale: 2.4,
      rotation: 180,
    });
  });

  it('provides distinct anchors for the four named jersey regions', () => {
    expect(getRegionAnchor('front')).not.toEqual(getRegionAnchor('back'));
    expect(getRegionAnchor('left-sleeve')).not.toEqual(getRegionAnchor('right-sleeve'));
  });
});
