import { describe, expect, it } from 'vitest';
import { mergeConfiguratorState } from './state.js';

describe('mergeConfiguratorState', () => {
  it('merges nested extra flags without dropping existing selections', () => {
    const current = {
      productId: 'fn8788-jersey',
      layout: 'm',
      colorway: 'home',
      material: 'stadium',
      lighting: 'none',
      extras: { sleeveBadge: true, giftBox: false, matchPatch: false },
      overrides: {},
    };

    expect(
      mergeConfiguratorState(current, {
        colorway: 'away',
        extras: { giftBox: true },
      }),
    ).toEqual({
      productId: 'fn8788-jersey',
      layout: 'm',
      colorway: 'away',
      material: 'stadium',
      lighting: 'none',
      extras: { sleeveBadge: true, giftBox: true, matchPatch: false },
      overrides: {},
    });
  });
});
