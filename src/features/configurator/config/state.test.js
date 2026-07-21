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

  it('deep merges appearance colors without dropping the existing zones', () => {
    const current = {
      extras: {},
      overrides: {
        appearance: {
          colors: { body: '#F7F5EF', collar: '#20242A' },
          template: 'solid',
        },
      },
    };

    expect(mergeConfiguratorState(current, {
      overrides: { appearance: { colors: { collar: '#C84F3D' } } },
    }).overrides.appearance).toEqual({
      colors: { body: '#F7F5EF', collar: '#C84F3D' },
      template: 'solid',
    });
  });
});
