import { describe, expect, it } from 'vitest';
import {
  applyPatternOutputTransform,
  resolvePatternOutputTransform,
  transformPatternOutputBounds,
  transformPatternOutputPoint,
} from './uvPatternOutputTransform.js';

const NON_SQUARE_SIZE = { width: 10, height: 8 };
const NON_SQUARE_POINT = { x: 1, y: 2 };
const NON_SQUARE_BOUNDS = { x: 2, y: 1, width: 3, height: 4 };
const NON_SQUARE_TRANSFORM_CASES = [
  [0, false, { x: 1, y: 2 }, { x: 2, y: 1, width: 3, height: 4 }],
  [0, true, { x: 9, y: 2 }, { x: 5, y: 1, width: 3, height: 4 }],
  [90, false, { x: 6, y: 1 }, { x: 3, y: 2, width: 4, height: 3 }],
  [90, true, { x: 2, y: 1 }, { x: 1, y: 2, width: 4, height: 3 }],
  [180, false, { x: 9, y: 6 }, { x: 5, y: 3, width: 3, height: 4 }],
  [180, true, { x: 1, y: 6 }, { x: 2, y: 3, width: 3, height: 4 }],
  [270, false, { x: 2, y: 9 }, { x: 1, y: 5, width: 4, height: 3 }],
  [270, true, { x: 6, y: 9 }, { x: 3, y: 5, width: 4, height: 3 }],
];

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

  it.each(NON_SQUARE_TRANSFORM_CASES)('maps point coordinates after rotation %i and mirrorX=%s', (
    rotation,
    mirrorX,
    expectedPoint,
  ) => {
    expect(transformPatternOutputPoint(NON_SQUARE_POINT, {
      ...NON_SQUARE_SIZE,
      rotation,
      mirrorX,
    })).toEqual(expectedPoint);
  });

  it.each(NON_SQUARE_TRANSFORM_CASES)('maps bounds after rotation %i and mirrorX=%s', (
    rotation,
    mirrorX,
    _expectedPoint,
    expectedBounds,
  ) => {
    const bounds = { ...NON_SQUARE_BOUNDS };

    expect(transformPatternOutputBounds(bounds, {
      ...NON_SQUARE_SIZE,
      rotation,
      mirrorX,
    })).toEqual(expectedBounds);
    expect(bounds).toEqual(NON_SQUARE_BOUNDS);
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

  it('preserves fractional identity bounds without mutating the input', () => {
    const bounds = { x: 2.25, y: 1.5, width: 3.25, height: 4.125 };

    expect(transformPatternOutputBounds(bounds, {
      width: 10,
      height: 8,
      rotation: 0,
      mirrorX: false,
    })).toEqual(bounds);
    expect(bounds).toEqual({ x: 2.25, y: 1.5, width: 3.25, height: 4.125 });
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

  it.each(NON_SQUARE_TRANSFORM_CASES)(
    'maps Canvas coordinates for rotation %i and mirrorX=%s using the rotated output width',
    (rotation, mirrorX, expectedPoint) => {
      const context = createAffineContext();

      applyPatternOutputTransform(context, {
        ...NON_SQUARE_SIZE,
        rotation,
        mirrorX,
      });

      const mappedPoint = context.mapPoint(NON_SQUARE_POINT);
      expect(mappedPoint.x).toBeCloseTo(expectedPoint.x, 10);
      expect(mappedPoint.y).toBeCloseTo(expectedPoint.y, 10);
    },
  );
});

function createAffineContext() {
  let matrix = [1, 0, 0, 1, 0, 0];

  return {
    translate(x, y) {
      const [a, b, c, d, e, f] = matrix;
      matrix = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
    },
    scale(x, y) {
      const [a, b, c, d, e, f] = matrix;
      matrix = [a * x, b * x, c * y, d * y, e, f];
    },
    rotate(angle) {
      const [a, b, c, d, e, f] = matrix;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      matrix = [
        a * cosine + c * sine,
        b * cosine + d * sine,
        c * cosine - a * sine,
        d * cosine - b * sine,
        e,
        f,
      ];
    },
    mapPoint({ x, y }) {
      const [a, b, c, d, e, f] = matrix;
      return { x: a * x + c * y + e, y: b * x + d * y + f };
    },
  };
}
