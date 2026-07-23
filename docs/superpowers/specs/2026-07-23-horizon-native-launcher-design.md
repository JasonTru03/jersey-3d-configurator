# Horizon native 3D launcher design

## Goal

Replace the live custom-product template's top-level launcher section plus DOM relocation with a Horizon theme block placed directly between the native variant picker and buy buttons.

## Constraints

- Scope remains the `product.3d-configurator` template on `testcsj.myshopify.com`.
- The default product template and unrelated Horizon blocks stay unchanged.
- The independent Cloudflare Worker remains the configurator runtime.
- Shopify product pages must not load React, Three.js, or the Shopify configurator bundle.
- The selected Shopify variant is read only when the launcher is clicked.
- The live theme is updated only after the same transformed template and block pass an unpublished-theme preview.

## Architecture

Create `blocks/product-3d-configurator-launch.liquid` as a Horizon `@theme` block. Horizon's `_product-details` block already accepts `@theme` children, so the template can place this block in `product-details.block_order` immediately after `variant_picker_*` and before `buy_buttons_*`.

The block owns:

- the full-width launcher button;
- the size-to-variant map derived from `closest.product.variants`;
- safe launch parameters (`shop`, `productHandle`, `variantId`, `variantMap`, `returnPath`);
- a block-scoped click handler.

It does not move itself or depend on quantity/add-button layout.

## Template migration

Add a deterministic migration script that:

1. validates the `main -> product-details -> variant picker/buy buttons` anchors;
2. inserts the native block between the picker and buy buttons;
3. removes the old top-level launcher section;
4. removes the old launcher ID from the top-level order;
5. writes a valid Shopify JSON template.

The complete Horizon template stays theme-owned and is not committed to Git. The repository tracks the reusable block, migration logic, tests, and readback hashes.

## Performance decision

No application bundle split is required for the Shopify product page. The live launcher performs a normal navigation to the independent Worker and does not load the 985 kB Worker application or the 1.35 MB Shopify build on the product page. Three.js is already deferred until the shopper enters the configurator.

The existing Worker bundle-size warning remains an optimization opportunity for configurator startup, not a Shopify product-page regression.

## Verification

- unit tests for source boundaries and deterministic template migration;
- Shopify theme check on the staged theme source;
- unpublished desktop/mobile preview;
- S/M/L/XL launch parameter readback;
- live asset readback after the scoped rollout;
- unchanged Worker cart and production-file flow.
