import { describe, expect, it } from 'vitest';
import { calculateQuote } from '../../src/features/configurator/config/pricing.js';
import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import { calculateTrustedComponents } from './quotePricing.js';

const jerseyVariants = { s: '1001', m: '1002', l: '1003', xl: '1004' };

function config(overrides = {}) {
  return {
    currency: 'USD',
    jerseyVariants,
    surchargeVariants: {},
    ...overrides,
  };
}

describe('calculateTrustedComponents', () => {
  it('prices the default design as one jersey line with no surcharge', () => {
    const result = calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config(),
    });

    expect(result.quote).toEqual(calculateQuote(jerseyProduct, jerseyProduct.defaultState));
    expect(result.jerseyVariantId).toBe('1002');
    expect(result.surchargeItems).toEqual([]);
    expect(result.normalizedState).toEqual(expect.objectContaining({ layout: 'm' }));
  });

  it('matches existing complex pricing and composes surcharge variants', () => {
    const design = {
      ...structuredClone(jerseyProduct.defaultState),
      layout: 'xl',
      material: 'player',
      lighting: 'name-number',
      extras: { sleeveBadge: true, giftBox: false, matchPatch: true },
      overrides: { customTextItems: [{ text: 'CAPTAIN' }, { text: '  ' }] },
    };
    const result = calculateTrustedComponents({
      state: design,
      storeConfig: config({ surchargeVariants: { 60: '2060', 20: '2020', 12: '2012', 8: '2008' } }),
    });

    expect(result.quote).toEqual(calculateQuote(jerseyProduct, design));
    expect(result.quote.customizationTotal).toBe(72);
    expect(result.jerseyVariantId).toBe('1004');
    expect(result.surchargeItems).toEqual([
      { amount: 60, variantId: '2060', quantity: 1 },
      { amount: 12, variantId: '2012', quantity: 1 },
    ]);
  });

  it('uses an exact surcharge mapping when present', () => {
    const design = { ...structuredClone(jerseyProduct.defaultState), lighting: 'name-number' };
    const result = calculateTrustedComponents({
      state: design,
      storeConfig: config({ surchargeVariants: { 18: '2018', 10: '2010', 8: '2008' } }),
    });

    expect(result.surchargeItems).toEqual([{ amount: 18, variantId: '2018', quantity: 1 }]);
  });

  it('rejects missing jersey and surcharge mappings with configuration errors', () => {
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ jerseyVariants: { s: '1001' } }),
    })).toThrow('Store pricing configuration has no jersey variant for layout "m"');

    const charged = { ...structuredClone(jerseyProduct.defaultState), lighting: 'name-number' };
    expect(() => calculateTrustedComponents({
      state: charged,
      storeConfig: config({ surchargeVariants: { 10: '2010' } }),
    })).toThrow('Store pricing configuration cannot represent surcharge 18 USD');
  });

  it('rejects malformed or inconsistent store pricing configuration', () => {
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ currency: 'EUR' }),
    })).toThrow('Store pricing currency EUR does not match product currency USD');
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ jerseyVariants: { ...jerseyVariants, m: 'bad-id' } }),
    })).toThrow('Invalid jersey variant');
    const charged = { ...structuredClone(jerseyProduct.defaultState), extras: { sleeveBadge: true, giftBox: false, matchPatch: false } };
    expect(() => calculateTrustedComponents({
      state: charged,
      storeConfig: config({ surchargeVariants: { 10: '1002' } }),
    })).toThrow('must not reuse jersey variant');
  });
});
