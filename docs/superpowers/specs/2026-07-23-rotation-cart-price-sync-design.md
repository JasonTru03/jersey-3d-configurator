# Print Rotation and Shopify Cart Price Sync Design

## Goal

Make the selected print rotate clockwise in fixed 45-degree steps and make the Shopify cart total equal the configurator quote.

## Approved approach

### Print rotation

- The rotate control is a normal button.
- Each click adds 45 degrees.
- Rotation is normalized to the range `0..359`, so `315 + 45` becomes `0`.
- Existing print persistence, undo/redo, duplicate, delete, edit, and resize behavior remains unchanged.

### Shopify pricing

The configurator quote is split into two Shopify merchandise amounts:

1. the jersey size variant carries the configurator base price plus the size adjustment;
2. a hidden `3D Customization Surcharge` product variant carries the remaining fabric, print, and extras amount.

The default configuration has a zero customization surcharge and adds only the jersey variant. A positive customization amount adds both variants through one cart permalink.

The Shopify launcher passes a validated `surchargeVariantMap` alongside the existing size `variantMap`. The map is generated from the hidden Shopify surcharge product instead of hard-coding Shopify variant IDs into the application bundle.

## Pricing contract

- `quote.merchandisePrice = product.basePrice + selected size priceDelta`
- `quote.customizationTotal = material + print + enabled extras`
- `quote.total = quote.merchandisePrice + quote.customizationTotal`
- Shopify jersey prices must be `S/M/L = $89`, `XL = $93`.
- Shopify surcharge variants must cover every positive total produced by the current option catalog.
- The cart URL uses the selected size variant and, when required, the exact surcharge variant.

If a positive customization amount has no valid Shopify variant mapping, cart navigation stops with an explicit pricing-configuration error.

## Shopify product boundary

- Product handle: `3d-customization-surcharge`
- Status: active and available to the Online Store cart
- Search visibility: hidden with Shopify's `seo.hidden` product metafield
- Inventory tracking: off
- Taxable: on, matching the jersey merchandise treatment

No credentials, full design JSON, Data URLs, or uploaded file contents enter the cart URL.

## Files

- `src/features/configurator/scene/PrintToolbarOverlay.jsx`
- `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
- `src/features/configurator/scene/ProductStage.test.jsx`
- `src/features/configurator/config/pricing.js`
- `src/features/configurator/config/pricing.test.js`
- `src/features/configurator/shopify/cartHandoff.js`
- `src/features/configurator/shopify/cartHandoff.test.js`
- `src/features/configurator/ui/ConfiguratorPage.jsx`
- `src/features/configurator/ui/ConfiguratorPage.test.jsx`
- `src/features/configurator/ui/DesignReviewDialog.jsx`
- `src/features/configurator/ui/DesignReviewDialog.test.jsx`
- `shopify/sections/product-3d-configurator-launch.liquid`
- `project-logs/changes/2026-07-23-rotation-cart-price-sync.md`

## Verification

1. Run focused tests red before implementation.
2. Run focused tests green after implementation.
3. Run the complete test suite and both production builds.
4. Read back Shopify jersey and surcharge variant prices.
5. Deploy the launcher to the confirmed live theme and read it back.
6. Deploy the exact tested application commit to Cloudflare.
7. Use the real storefront path to verify a `$107` configuration creates an `$89 + $18 = $107` cart.

## Rollback

- Application: deploy the previous Cloudflare Worker version.
- Theme: restore the backed-up launcher section.
- Shopify: restore the four captured jersey prices and set the surcharge product to draft.

