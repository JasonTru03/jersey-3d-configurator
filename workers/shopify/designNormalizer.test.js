import { describe, expect, it } from 'vitest';
import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import { MAX_CUSTOM_TEXT_ITEMS } from '../../src/features/configurator/config/customTextItems.js';
import { normalizeDesignState } from './designNormalizer.js';

function state(overrides = {}) {
  return structuredClone({ ...jerseyProduct.defaultState, ...overrides });
}

describe('normalizeDesignState', () => {
  it('returns a detached pricing-only representation of the default design', () => {
    const input = state();
    input.secret = 'TOKEN';
    input.overrides.bottomPattern = { source: { dataUrl: 'data:image/png;base64,PAYLOAD' } };

    const normalized = normalizeDesignState(input);

    expect(normalized).toEqual({
      productId: 'fn8788-jersey',
      layout: 'm',
      material: 'stadium',
      lighting: 'none',
      extras: { sleeveBadge: false, giftBox: false, matchPatch: false },
      overrides: { customTextItems: [] },
    });
    expect(normalized).not.toBe(input);
    expect(JSON.stringify(normalized)).not.toContain('data:');
    expect(JSON.stringify(normalized)).not.toContain('TOKEN');
  });

  it.each([
    ['productId', { productId: 'unknown-product' }, 'Unknown productId'],
    ['layout', { layout: 'xxl' }, 'Unknown layout'],
    ['material', { material: 'silk' }, 'Unknown material'],
    ['lighting', { lighting: 'laser' }, 'Unknown lighting'],
  ])('rejects an unknown %s', (_field, patch, message) => {
    expect(() => normalizeDesignState(state(patch))).toThrow(message);
  });

  it('rejects unknown extras and non-boolean extra values', () => {
    expect(() => normalizeDesignState(state({
      extras: { ...jerseyProduct.defaultState.extras, freeUpgrade: true },
    }))).toThrow('Unknown extra');
    expect(() => normalizeDesignState(state({
      extras: { ...jerseyProduct.defaultState.extras, giftBox: 1 },
    }))).toThrow('giftBox must be a boolean');
    expect(() => normalizeDesignState(state({ extras: [] }))).toThrow('extras must be a plain object');
  });

  it.each([
    [null, 'Design state must be a plain object'],
    [{ ...jerseyProduct.defaultState, overrides: [] }, 'overrides must be a plain object'],
    [{ ...jerseyProduct.defaultState, overrides: { customTextItems: {} } }, 'customTextItems must be an array'],
    [{ ...jerseyProduct.defaultState, overrides: { customTextItems: [null] } }, 'customTextItems[0] must be a plain object'],
    [{ ...jerseyProduct.defaultState, overrides: { customTextItems: [{ text: 10 }] } }, 'customTextItems[0].text must be a string'],
  ])('rejects malformed pricing input %#', (input, message) => {
    expect(() => normalizeDesignState(input)).toThrow(message);
  });

  it('rejects custom text beyond the editor item and text limits', () => {
    expect(() => normalizeDesignState(state({
      overrides: { customTextItems: Array.from({ length: MAX_CUSTOM_TEXT_ITEMS + 1 }, () => ({ text: 'A' })) },
    }))).toThrow(`customTextItems cannot contain more than ${MAX_CUSTOM_TEXT_ITEMS} items`);
    expect(() => normalizeDesignState(state({
      overrides: { customTextItems: [{ text: 'A'.repeat(25) }] },
    }))).toThrow('customTextItems[0].text cannot exceed 24 characters');
  });

  it('retains blank text for consistent non-billable pricing and strips item metadata', () => {
    const input = state({
      overrides: {
        customTextItems: [
          { id: 'text-1', text: '   ', credential: 'TOKEN' },
          { id: 'text-2', text: 'CAPTAIN', image: 'data:image/png;base64,PAYLOAD' },
        ],
      },
    });

    const normalized = normalizeDesignState(input);

    expect(normalized.overrides.customTextItems).toEqual([{ text: '   ' }, { text: 'CAPTAIN' }]);
    input.overrides.customTextItems[1].text = 'MUTATED';
    expect(normalized.overrides.customTextItems[1].text).toBe('CAPTAIN');
  });
});
