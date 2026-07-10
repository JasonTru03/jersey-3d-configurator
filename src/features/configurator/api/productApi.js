import { products } from '../config/productDefinitions.js';
import { calculateQuote } from '../config/pricing.js';

export const productApi = {
  async getProducts() {
    return products.map(({ id, name, basePrice, currency, renderer }) => ({
      id,
      name,
      basePrice,
      currency,
      renderer,
    }));
  },

  async getProductDefinition(productId) {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      throw new Error(`Unknown product: ${productId}`);
    }
    return structuredClone(product);
  },

  async quoteConfiguration(productId, state) {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      throw new Error(`Unknown product: ${productId}`);
    }
    return calculateQuote(product, state);
  },
};
