import { describe, expect, it } from 'vitest';
import { calculateQuote } from './pricing.js';
import { jerseyProduct } from './productDefinitions.js';

describe('calculateQuote', () => {
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
    expect(quote.total).toBe(157);
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
