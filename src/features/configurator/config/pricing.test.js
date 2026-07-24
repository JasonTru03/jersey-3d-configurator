import { describe, expect, it } from 'vitest';
import { calculateQuote } from './pricing.js';
import { jerseyProduct } from './productDefinitions.js';
import { createDefaultBottomPattern } from './bottomPattern.js';

describe('calculateQuote', () => {
  it('includes the v1 default bottom pattern in the product state', () => {
    expect(jerseyProduct.defaultState.overrides.bottomPattern)
      .toEqual(createDefaultBottomPattern());
  });
  it('adds layout, finish, lighting, and enabled extras to the base price', () => {
    const quote = calculateQuote(jerseyProduct, {
      productId: 'fn8788-jersey',
      layout: 'xl',
      colorway: 'away',
      material: 'player',
      lighting: 'name-number',
      extras: { sleeveBadge: true, giftBox: false, matchPatch: true },
      overrides: {},
    });

    expect(quote.currency).toBe('USD');
    expect(quote.basePrice).toBe(89);
    expect(quote.optionAdjustments).toEqual([
      { label: 'Extra Large', amount: 4 },
      { label: 'Player issue performance mesh', amount: 24 },
      { label: 'Name and number set', amount: 18 },
      { label: 'League sleeve badge', amount: 10 },
      { label: 'Match day chest patch', amount: 12 },
    ]);
    expect(quote.merchandisePrice).toBe(93);
    expect(quote.customizationTotal).toBe(64);
    expect(quote.total).toBe(157);
  });

  it('keeps the default configuration entirely on the jersey line', () => {
    const quote = calculateQuote(jerseyProduct, jerseyProduct.defaultState);

    expect(quote.merchandisePrice).toBe(89);
    expect(quote.customizationTotal).toBe(0);
    expect(quote.total).toBe(89);
  });

  it('prices only non-blank custom text items as one aggregate adjustment', () => {
    const quote = calculateQuote(jerseyProduct, {
      ...jerseyProduct.defaultState,
      overrides: {
        customTextItems: [
          { id: 'text-1', text: 'MASON' },
          { id: 'text-2', text: '   ' },
          { id: 'text-3', text: '10' },
        ],
      },
    });

    expect(quote.optionAdjustments).toEqual([{ label: 'Custom text × 2', amount: 16 }]);
    expect(quote.merchandisePrice).toBe(89);
    expect(quote.customizationTotal).toBe(16);
    expect(quote.total).toBe(105);
  });

  it('ignores unknown options instead of hiding the pricing error with a fake amount', () => {
    const quote = calculateQuote(jerseyProduct, {
      ...jerseyProduct.defaultState,
      productId: 'fn8788-jersey',
      layout: 'not-real',
    });

    expect(quote.optionAdjustments).not.toContainEqual(
      expect.objectContaining({ label: expect.stringContaining('not-real') }),
    );
    expect(quote.total).toBeGreaterThan(0);
  });
});
