import { describe, expect, it } from 'vitest';
import { calculateQuote } from '../../src/features/configurator/config/pricing.js';
import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import { MAX_SURCHARGE_TOTAL } from '../../src/features/configurator/shopify/cartHandoff.js';
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
    })).toThrow('Store pricing configuration has no jersey variant for size "m"');

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
    })).toThrow('Store pricing configuration has invalid jersey variant');
    const charged = { ...structuredClone(jerseyProduct.defaultState), extras: { sleeveBadge: true, giftBox: false, matchPatch: false } };
    expect(() => calculateTrustedComponents({
      state: charged,
      storeConfig: config({ surchargeVariants: { 10: '1002' } }),
    })).toThrow('surcharge variant "1002" conflicts with a jersey variant');
  });

  it('validates malformed and conflicting surcharge mappings even for a zero surcharge', () => {
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ surchargeVariants: { garbage: 'bad-id' } }),
    })).toThrow('Store pricing configuration has invalid surcharge amount');
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ surchargeVariants: { 8: '1001' } }),
    })).toThrow('Store pricing configuration surcharge variant "1001" conflicts with a jersey variant');
  });

  it('rejects a surcharge variant that belongs to a non-selected jersey size', () => {
    const charged = {
      ...structuredClone(jerseyProduct.defaultState),
      extras: { sleeveBadge: true, giftBox: false, matchPatch: false },
    };

    expect(() => calculateTrustedComponents({
      state: charged,
      storeConfig: config({ surchargeVariants: { 10: '1001' } }),
    })).toThrow('Store pricing configuration surcharge variant "1001" conflicts with a jersey variant');
  });

  it('requires a complete, exact, globally unique jersey variant map', () => {
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ jerseyVariants: { ...jerseyVariants, l: '1002' } }),
    })).toThrow('Store pricing configuration reuses jersey variant "1002"');
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ jerseyVariants: { ...jerseyVariants, xxl: '1005' } }),
    })).toThrow('Store pricing configuration has unknown jersey size "xxl"');
    const { l: _missing, ...missingSize } = jerseyVariants;
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ jerseyVariants: missingSize }),
    })).toThrow('Store pricing configuration has no jersey variant for size "l"');
  });

  it('rejects zero, unsafe, and non-decimal variant IDs and invalid surcharge amounts', () => {
    for (const invalidId of ['0', 0, '01', Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => calculateTrustedComponents({
        state: jerseyProduct.defaultState,
        storeConfig: config({ jerseyVariants: { ...jerseyVariants, m: invalidId } }),
      })).toThrow('Store pricing configuration has invalid jersey variant');
    }
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ surchargeVariants: { 8: '0' } }),
    })).toThrow('Store pricing configuration has invalid surcharge variant');
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ surchargeVariants: { 0: '2000' } }),
    })).toThrow('Store pricing configuration has invalid surcharge amount');
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ surchargeVariants: { [MAX_SURCHARGE_TOTAL + 1]: '2001' } }),
    })).toThrow('Store pricing configuration has invalid surcharge amount');
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ surchargeVariants: { 8: '2008', 12: '2008' } }),
    })).toThrow('Store pricing configuration maps surcharge variant "2008" to multiple amounts');
  });

  it('preserves canonical Shopify uint64 variant ID strings beyond JavaScript safe integers', () => {
    const aboveSafeInteger = '9007199254740992';
    const uint64Maximum = '18446744073709551615';

    expect(calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ jerseyVariants: { ...jerseyVariants, m: aboveSafeInteger } }),
    }).jerseyVariantId).toBe(aboveSafeInteger);
    expect(calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ jerseyVariants: { ...jerseyVariants, m: uint64Maximum } }),
    }).jerseyVariantId).toBe(uint64Maximum);
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({ jerseyVariants: { ...jerseyVariants, m: Number.MAX_SAFE_INTEGER + 1 } }),
    })).toThrow('Store pricing configuration has invalid jersey variant');
    expect(() => calculateTrustedComponents({
      state: jerseyProduct.defaultState,
      storeConfig: config({
        jerseyVariants: { ...jerseyVariants, m: '18446744073709551616' },
      }),
    })).toThrow('Store pricing configuration has invalid jersey variant');
  });
});
