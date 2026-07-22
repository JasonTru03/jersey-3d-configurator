import { describe, expect, it } from 'vitest';
import {
  BOTTOM_PATTERN_VERSION,
  DEFAULT_BOTTOM_PATTERN,
  createDefaultBottomPattern,
  normalizeBottomPattern,
} from './bottomPattern.js';

describe('bottom pattern configuration', () => {
  it('exposes versioned defaults and returns an independent default state', () => {
    expect(BOTTOM_PATTERN_VERSION).toBe(1);
    expect(Object.isFrozen(DEFAULT_BOTTOM_PATTERN)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BOTTOM_PATTERN.source)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BOTTOM_PATTERN.transform)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BOTTOM_PATTERN.transform.offset)).toBe(true);
    expect(Object.isFrozen(DEFAULT_BOTTOM_PATTERN.transform.repeat)).toBe(true);
    expect(DEFAULT_BOTTOM_PATTERN).toEqual({
      enabled: false,
      source: { kind: 'preset', id: 'none', assetRef: '' },
      transform: {
        offset: { u: 0, v: 0 },
        scale: 1,
        rotationDeg: 0,
        repeat: { u: 3, v: 4 },
      },
      projectionVersion: 1,
      modelProjectionId: 'chelsea-jersey-cylindrical-v1',
    });

    const defaultPattern = createDefaultBottomPattern();
    defaultPattern.transform.offset.u = 0.5;
    expect(DEFAULT_BOTTOM_PATTERN.transform.offset.u).toBe(0);
  });

  it('fills missing values from the versioned defaults', () => {
    expect(normalizeBottomPattern()).toEqual(DEFAULT_BOTTOM_PATTERN);
  });

  it('preserves uploaded pattern sources', () => {
    expect(normalizeBottomPattern({
      source: { kind: 'uploaded', id: 'asset-1', assetRef: 'asset:1' },
    }).source).toEqual({
      kind: 'uploaded',
      id: 'asset-1',
      assetRef: 'asset:1',
    });
  });

  it('normalizes legacy upload sources to uploaded', () => {
    expect(normalizeBottomPattern({
      source: { kind: 'upload', id: 'uploaded-pattern', assetRef: 'assets/pattern.png' },
    }).source).toEqual({
      kind: 'uploaded',
      id: 'uploaded-pattern',
      assetRef: 'assets/pattern.png',
    });
  });
  it('clamps invalid transform values and preserves valid preset sources', () => {
    expect(normalizeBottomPattern({
      enabled: true,
      source: { kind: 'preset', id: 'micro-chevron', assetRef: 'patterns/micro-chevron.svg' },
      transform: {
        offset: { u: 4, v: -4 },
        scale: 0,
        rotationDeg: 810,
        repeat: { u: 0, v: 50 },
      },
    })).toEqual({
      enabled: true,
      source: { kind: 'preset', id: 'micro-chevron', assetRef: 'patterns/micro-chevron.svg' },
      transform: {
        offset: { u: 1, v: -1 },
        scale: 0.1,
        rotationDeg: 90,
        repeat: { u: 1, v: 16 },
      },
      projectionVersion: 1,
      modelProjectionId: 'chelsea-jersey-cylindrical-v1',
    });
  });
});
