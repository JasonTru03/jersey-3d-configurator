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

  it('deep merges bottom pattern sources without dropping existing metadata', () => {
    const current = {
      extras: {},
      overrides: {
        bottomPattern: {
          source: { kind: 'uploaded', id: 'asset-1', assetRef: 'asset:1' },
          transform: {},
        },
      },
    };

    expect(mergeConfiguratorState(current, {
      overrides: { bottomPattern: { source: { id: 'asset-2' } } },
    }).overrides.bottomPattern.source).toEqual({
      kind: 'uploaded',
      id: 'asset-2',
      assetRef: 'asset:1',
    });
  });
  it('deep merges bottom pattern transforms without dropping source metadata', () => {
    const current = {
      extras: {},
      overrides: {
        bottomPattern: {
          enabled: true,
          source: { kind: 'preset', id: 'micro-chevron', assetRef: 'patterns/micro-chevron.svg' },
          transform: {
            offset: { u: 0.25, v: -0.5 },
            scale: 1.5,
            rotationDeg: 30,
            repeat: { u: 3, v: 4 },
          },
        },
      },
    };

    expect(mergeConfiguratorState(current, {
      overrides: { bottomPattern: { transform: { scale: 2, repeat: { v: 6 } } } },
    }).overrides.bottomPattern).toEqual({
      enabled: true,
      source: { kind: 'preset', id: 'micro-chevron', assetRef: 'patterns/micro-chevron.svg' },
      transform: {
        offset: { u: 0.25, v: -0.5 },
        scale: 2,
        rotationDeg: 30,
        repeat: { u: 3, v: 6 },
      },
    });
  });
});
