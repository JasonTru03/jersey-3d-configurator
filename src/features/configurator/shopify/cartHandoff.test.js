import { describe, expect, it } from 'vitest';
import * as cartHandoff from './cartHandoff.js';

const { findSurchargeCombination, MAX_SURCHARGE_TOTAL, parseShopifyLaunch } = cartHandoff;
const VARIANT_MAP = '%7B%22s%22%3A%2248039101890711%22%2C%22xl%22%3A%2248039101989015%22%7D';

describe('Shopify launch parsing', () => {
  it('normalizes a valid launch and resolves the selected layout', () => {
    expect(parseShopifyLaunch(
      `?shop=TESTCSJ.MYSHOPIFY.COM&variantMap=${VARIANT_MAP}&variantId=48039101989015&productHandle=jersey`,
    )).toEqual({
      shop: 'testcsj.myshopify.com',
      productHandle: 'jersey',
      returnPath: '',
      surchargeVariantMap: null,
      variantId: '48039101989015',
      variantMap: { s: '48039101890711', xl: '48039101989015' },
      initialLayout: 'xl',
    });
  });

  it('rejects invalid shops and malformed required variant maps', () => {
    expect(parseShopifyLaunch('?shop=example.com')).toBeNull();
    expect(parseShopifyLaunch(`?shop=-bad.myshopify.com&variantMap=${VARIANT_MAP}`)).toBeNull();
    expect(parseShopifyLaunch(`?shop=bad-.myshopify.com&variantMap=${VARIANT_MAP}`)).toBeNull();
    expect(parseShopifyLaunch('?shop=testcsj.myshopify.com&variantMap=%7B%22s%22%3A%22abc%22%7D')).toBeNull();
    expect(parseShopifyLaunch('?shop=testcsj.myshopify.com&variantMap=%7B%7D')).toBeNull();
  });

  it('keeps a malformed optional surcharge map isolated from the valid launch', () => {
    expect(parseShopifyLaunch(
      `?shop=testcsj.myshopify.com&variantMap=${VARIANT_MAP}&surchargeVariantMap=%7B%2218%22%3A%22bad%22%7D`,
    )).toMatchObject({ shop: 'testcsj.myshopify.com', surchargeVariantMap: null });
  });

  it('accepts internal return paths and rejects external or ambiguous paths', () => {
    expect(parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${VARIANT_MAP}&returnPath=%2Fcart%3Fx%3D1`))
      .toMatchObject({ returnPath: '/cart?x=1' });
    for (const returnPath of [
      'https%3A%2F%2FTARGET%2F',
      '%2F%2FTARGET%2F',
      '%2F%5CTARGET%2F',
      '%2F%0A%2F%2FTARGET%2F',
      '%2F%0D%2F%2FTARGET%2F',
      '%2F%09%2F%2FTARGET%2F',
    ]) {
      expect(parseShopifyLaunch(
        `?shop=testcsj.myshopify.com&variantMap=${VARIANT_MAP}&returnPath=${returnPath}`,
      )).toBeNull();
    }
  });

  it('does not expose credentials or direct-cart construction APIs', () => {
    const context = parseShopifyLaunch(`?shop=testcsj.myshopify.com&variantMap=${VARIANT_MAP}`);
    expect(Object.keys(context).sort()).toEqual([
      'initialLayout', 'productHandle', 'returnPath', 'shop',
      'surchargeVariantMap', 'variantId', 'variantMap',
    ]);
    expect(cartHandoff).not.toHaveProperty('createCartUrl');
  });
});

describe('surcharge combinations', () => {
  it('takes the exact fast path at the supported upper boundary', () => {
    expect(findSurchargeCombination({
      1: '4900000000000001',
      [MAX_SURCHARGE_TOTAL]: '4900000000010000',
    }, MAX_SURCHARGE_TOTAL)).toEqual([
      { amount: MAX_SURCHARGE_TOTAL, quantity: 1, variantId: '4900000000010000' },
    ]);
  });

  it('composes exact sums and uses quantity when repetition is optimal', () => {
    expect(findSurchargeCombination({
      50: '4900000000000050',
      12: '4900000000000012',
      8: '4900000000000008',
    }, 62)).toEqual([
      { amount: 50, quantity: 1, variantId: '4900000000000050' },
      { amount: 12, quantity: 1, variantId: '4900000000000012' },
    ]);
    expect(findSurchargeCombination({ 8: '4900000000000008' }, 24)).toEqual([
      { amount: 8, quantity: 3, variantId: '4900000000000008' },
    ]);
  });

  it('chooses the fewest units, then kinds, then larger amounts deterministically', () => {
    expect(findSurchargeCombination({
      8: '4900000000000008', 7: '4900000000000007', 6: '4900000000000006',
      5: '4900000000000005', 4: '4900000000000004',
    }, 12)).toEqual([{ amount: 6, quantity: 2, variantId: '4900000000000006' }]);
    expect(findSurchargeCombination({
      7: '4900000000000007', 6: '4900000000000006',
      4: '4900000000000004', 3: '4900000000000003',
    }, 10)).toEqual([
      { amount: 7, quantity: 1, variantId: '4900000000000007' },
      { amount: 3, quantity: 1, variantId: '4900000000000003' },
    ]);
  });

  it('handles zero and rejects invalid or unsupported targets without large allocation', () => {
    expect(findSurchargeCombination({ invalid: 'bad' }, 0)).toEqual([]);
    for (const target of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, MAX_SURCHARGE_TOTAL + 1]) {
      expect(findSurchargeCombination({ 8: '4900000000000008' }, target)).toBeNull();
    }
  });

  it('ignores invalid entries and rejects one variant mapped to different amounts', () => {
    expect(findSurchargeCombination({
      0: '4900000000000000',
      '-4': '4900000000000004',
      8: 'bad',
      12: '4900000000000012',
    }, 12)).toEqual([{ amount: 12, quantity: 1, variantId: '4900000000000012' }]);
    expect(findSurchargeCombination({
      8: '4900000000000008',
      12: '4900000000000008',
    }, 16)).toBeNull();
  });

  it('allows equal amounts with different variants and chooses a stable variant id', () => {
    expect(findSurchargeCombination({
      8: '4900000000000009',
      '08': '4900000000000008',
    }, 8)).toEqual([{ amount: 8, quantity: 1, variantId: '4900000000000008' }]);
  });

  it('returns null when no exact sum exists', () => {
    expect(findSurchargeCombination({ 10: '4900000000000010' }, 23)).toBeNull();
  });
});
