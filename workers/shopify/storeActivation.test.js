import { describe, expect, it, vi } from 'vitest';
import {
  activateStore,
  listProducts,
  StoreActivationError,
  verifySelectedVariants,
} from './storeActivation.js';

const SHOP = 'activation-test.myshopify.com';
const CONFIG = {
  productId: 'fn8788-jersey',
  currency: 'USD',
  jerseyVariants: { s: '101', m: '102', l: '103', xl: '104' },
  surchargeVariants: { 8: '201' },
};

describe('Shopify store activation', () => {
  it('creates missing registrations and accepts activation only after exact config readback', async () => {
    let discoverCount = 0;
    let writtenValues = [];
    const graphql = vi.fn(async (query, variables) => {
      if (query.includes('query Discover')) {
        discoverCount += 1;
        if (discoverCount === 1) return discovery();
        if (discoverCount === 2) return discovery({ registered: true });
        return discovery({ registered: true, values: writtenValues });
      }
      if (query.includes('cartTransformCreate')) {
        return { cartTransformCreate: { cartTransform: { id: 'gid://shopify/CartTransform/11' }, userErrors: [] } };
      }
      if (query.includes('validationCreate')) {
        return { validationCreate: { validation: { id: 'gid://shopify/Validation/12' }, userErrors: [] } };
      }
      if (query.includes('metafieldsSet')) {
        writtenValues = variables.metafields.map(({ value }) => value);
        return { metafieldsSet: { metafields: [{ id: 'gid://shopify/Metafield/1' }, { id: 'gid://shopify/Metafield/2' }], userErrors: [] } };
      }
      if (query.includes('validationUpdate')) {
        return { validationUpdate: { validation: { id: 'gid://shopify/Validation/12' }, userErrors: [] } };
      }
      throw new Error('Unexpected query.');
    });

    await expect(activateStore({
      graphql,
      shop: SHOP,
      config: CONFIG,
      signingSecret: 's'.repeat(43),
    })).resolves.toEqual({
      transformRegistrationId: 'gid://shopify/CartTransform/11',
      validationRegistrationId: 'gid://shopify/Validation/12',
    });
    expect(writtenValues).toHaveLength(2);
    expect(JSON.parse(writtenValues[0])).toMatchObject(CONFIG);
    expect(JSON.parse(writtenValues[0]).signingSecret).toBe('s'.repeat(43));
  });

  it('rejects a readback whose stored function config differs from the write', async () => {
    let discoverCount = 0;
    const graphql = vi.fn(async (query) => {
      if (query.includes('query Discover')) {
        discoverCount += 1;
        return discovery({
          registered: true,
          values: discoverCount > 1 ? ['{}', '{}'] : undefined,
        });
      }
      if (query.includes('metafieldsSet')) {
        return { metafieldsSet: { metafields: [{ id: 'gid://shopify/Metafield/1' }, { id: 'gid://shopify/Metafield/2' }], userErrors: [] } };
      }
      if (query.includes('validationUpdate')) {
        return { validationUpdate: { validation: { id: 'gid://shopify/Validation/12' }, userErrors: [] } };
      }
      throw new Error('Unexpected query.');
    });

    await expect(activateStore({
      graphql,
      shop: SHOP,
      config: CONFIG,
      signingSecret: 's'.repeat(43),
    })).rejects.toMatchObject({ code: 'FUNCTION_READBACK_FAILED' });
  });

  it('allows surcharge variants from another product but rejects a jersey variant outside the selected product', async () => {
    const productGid = 'gid://shopify/Product/9';
    const jerseyVariantGids = [101, 102, 103, 104].map(variantGid);
    const surchargeVariantGids = [201].map(variantGid);
    const graphql = vi.fn(async () => ({
      shop: { currencyCode: 'USD' },
      product: { id: productGid, title: 'Jersey' },
      nodes: [
        ...jerseyVariantGids.map((id) => ({ id, product: { id: productGid } })),
        { id: surchargeVariantGids[0], product: { id: 'gid://shopify/Product/10' } },
      ],
    }));
    await expect(verifySelectedVariants({
      graphql, productGid, jerseyVariantGids, surchargeVariantGids,
    })).resolves.toEqual({ currency: 'USD', title: 'Jersey' });

    graphql.mockResolvedValueOnce({
      shop: { currencyCode: 'USD' }, product: { id: productGid, title: 'Jersey' },
      nodes: [
        { id: jerseyVariantGids[0], product: { id: 'gid://shopify/Product/10' } },
        ...jerseyVariantGids.slice(1).map((id) => ({ id, product: { id: productGid } })),
        { id: surchargeVariantGids[0], product: { id: 'gid://shopify/Product/10' } },
      ],
    });
    await expect(verifySelectedVariants({
      graphql, productGid, jerseyVariantGids, surchargeVariantGids,
    })).rejects.toBeInstanceOf(StoreActivationError);
  });

  it('paginates product catalogs without blocking on unrelated products over 100 variants', async () => {
    const graphql = vi.fn()
      .mockResolvedValueOnce(productPage('cursor-1', true, 'One'))
      .mockResolvedValueOnce(productPage(null, false, 'Two'));
    await expect(listProducts(graphql)).resolves.toHaveLength(2);
    expect(graphql).toHaveBeenNthCalledWith(2, expect.any(String), { first: 50, after: 'cursor-1' });

    graphql.mockReset().mockResolvedValueOnce({
      products: {
        nodes: [{ id: 'gid://shopify/Product/1', title: 'Large', variants: { nodes: [], pageInfo: { hasNextPage: true } } }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });
    await expect(listProducts(graphql)).resolves.toMatchObject([{ variantsTruncated: true }]);
  });
});

function discovery({ registered = false, values } = {}) {
  return {
    shopifyFunctions: {
      nodes: [
        { id: 'gid://shopify/ShopifyFunction/1', handle: 'secure-jersey-transform' },
        { id: 'gid://shopify/ShopifyFunction/2', handle: 'secure-jersey-validation' },
      ],
      pageInfo: { hasNextPage: false },
    },
    cartTransforms: {
      nodes: registered ? [{
        id: 'gid://shopify/CartTransform/11',
        functionId: 'gid://shopify/ShopifyFunction/1',
        blockOnFailure: true,
        config: { compareDigest: 'digest-1', value: values?.[0] },
      }] : [],
      pageInfo: { hasNextPage: false },
    },
    validations: {
      nodes: registered ? [{
        id: 'gid://shopify/Validation/12',
        enabled: true,
        blockOnFailure: true,
        shopifyFunction: { id: 'gid://shopify/ShopifyFunction/2' },
        config: { compareDigest: 'digest-2', value: values?.[1] },
      }] : [],
      pageInfo: { hasNextPage: false },
    },
  };
}

function productPage(endCursor, hasNextPage, title) {
  return {
    products: {
      nodes: [{
        id: `gid://shopify/Product/${title === 'One' ? 1 : 2}`,
        title,
        variants: { nodes: [], pageInfo: { hasNextPage: false } },
      }],
      pageInfo: { endCursor, hasNextPage },
    },
  };
}

function variantGid(id) {
  return `gid://shopify/ProductVariant/${id}`;
}
