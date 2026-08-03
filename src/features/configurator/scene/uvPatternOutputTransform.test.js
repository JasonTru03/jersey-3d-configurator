import { describe, expect, it } from 'vitest';
import {
  applyPatternOutputTransform,
  resolvePatternOutputTransform,
  transformPatternOutputBounds,
  transformPatternOutputPoint,
} from './uvPatternOutputTransform.js';

describe('UV pattern output transform', () => {
  it('resolves an omitted output transform to a fresh identity transform', () => {
    const first = resolvePatternOutputTransform({});
    const second = resolvePatternOutputTransform({});

    expect(first).toEqual({ rotation: 0, mirrorX: false });
    expect(first).not.toBe(second);
  });

  it('copies only the configured output rotation and horizontal mirror', () => {
    const source = {
      patternOutputTransform: { rotation: 180, mirrorX: true, ignored: 'value' },
    };

    const resolved = resolvePatternOutputTransform(source);

    expect(resolved).toEqual({ rotation: 180, mirrorX: true });
    expect(resolved).not.toBe(source.patternOutputTransform);
  });

  it.each([
    [0, false, { x: 1, y: 2 }],
    [90, false, { x: 6, y: 1 }],
    [180, false, { x: 9, y: 6 }],
    [270, false, { x: 2, y: 9 }],
    [180, true, { x: 1, y: 6 }],
  ])('maps point coordinates after rotation %i and mirrorX=%s', (rotation, mirrorX, expected) => {
    expect(transformPatternOutputPoint(
      { x: 1, y: 2 },
      { width: 10, height: 8, rotation, mirrorX },
    )).toEqual(expected);
  });

  it('maps rectangular bounds through all four transformed corners', () => {
    const bounds = { x: 2, y: 1, width: 3, height: 4 };

    expect(transformPatternOutputBounds(bounds, {
      width: 10,
      height: 8,
      rotation: 180,
      mirrorX: true,
    })).toEqual({ x: 2, y: 3, width: 3, height: 4 });
    expect(bounds).toEqual({ x: 2, y: 1, width: 3, height: 4 });
  });

  it('applies horizontal mirroring after a clockwise 180 degree rotation', () => {
    const calls = [];
    const context = Object.fromEntries(['translate', 'scale', 'rotate'].map((method) => [method, (...args) => {
      calls.push([method, ...args]);
    }]));

    applyPatternOutputTransform(context, {
      width: 4096,
      height: 4096,
      rotation: 180,
      mirrorX: true,
    });

    expect(calls).toEqual([
      ['translate', 4096, 0],
      ['scale', -1, 1],
      ['translate', 4096, 4096],
      ['rotate', Math.PI],
    ]);
  });
});
