import { mountShopifyConfigurators } from './features/configurator/shopify/shopifyMount.js';

mountShopifyConfigurators();

document.addEventListener('shopify:section:load', (event) => {
  mountShopifyConfigurators(event.target);
});
