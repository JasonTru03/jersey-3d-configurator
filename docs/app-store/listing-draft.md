# Shopify App Store Listing Draft

Status: local draft only. Do not submit until every `{{...}}` field is resolved and the live candidate passes end-to-end review.

## App name

`{{APP_NAME}}`  
Working name: Secure Jersey Configurator

## App card subtitle

Create configurable 3D jerseys with a secure Shopify checkout flow

## Primary language

To confirm. Do not claim English support until the complete merchant UI, help content, and review flow are available in English. Do not claim additional languages unless the complete merchant experience supports them.

## App details

`{{APP_NAME}}` lets sportswear merchants offer an interactive 3D jersey customization flow from their product pages. Merchants map their existing jersey variants and customization surcharge variants in the app, then add the app block to an Online Store 2.0 product template.

Customers can configure supported jersey options, return the completed design to the Shopify cart, and check out through Shopify. The app verifies the priced bundle at cart and checkout, associates paid orders with their production design package, and gives authorized production staff access to the order-linked files.

The current release is intended for stores using USD. It requires the Shopify Online Store sales channel and an Online Store 2.0 theme.

## Feature bullets

- Add an interactive 3D jersey customization entry to product pages
- Map S, M, L, XL and customization surcharge variants per store
- Keep jersey and surcharge components protected through cart and checkout
- Link paid Shopify orders to production-ready design packages
- Manage multiple installed stores from one isolated production workflow

## Sales channel and compatibility requirements

- Select: Merchant must have Online Store
- Theme requirement: Online Store 2.0
- Currency requirement: USD only for the current release
- App type: regular app, not a Sales Channel app

## Pricing

`{{PRICING_MODEL}}`

Pricing must appear only in the designated Pricing details section. Do not mention prices, free trials, discounts, or “free” claims elsewhere in listing copy or images.

## Category draft

Confirm against the live taxonomy immediately before submission. Candidate primary function: product customization. Do not select “Pricing quotes” unless the final product is presented as a quote-request workflow.

## Media plan

1. App Home showing product and variant mapping.
2. Theme editor showing the 3D jersey app block on a product template.
3. Customer-facing 3D configurator with a customized jersey.
4. Shopify cart showing the protected jersey bundle.
5. Production order portal showing an order-linked design package without customer PII.

Rules for every asset:

- Show real UI and a distinct feature/state.
- Crop out browser chrome and desktop backgrounds.
- Do not add pricing, testimonials, reviews, statistics, guarantees, URLs, or Shopify trademarks.
- Do not use a logo-only screenshot.

## Demo screencast outline

English narration or English subtitles are required.

1. Install the app on a fresh development store.
2. Complete OAuth and open App Home.
3. Select the jersey product, S/M/L/XL variants, and surcharge variants.
4. Save and confirm both Shopify Functions are active.
5. Open the Theme Editor deep link, add the app block, and save the theme.
6. Customize a jersey on the storefront and add it to cart.
7. Complete a Shopify test payment.
8. Show the paid order linked to the production package.
9. Uninstall and confirm the app no longer operates on the store.

## Reviewer instructions draft

- Review store: `{{REVIEW_STORE}}`
- Store password: `{{REVIEW_STORE_PASSWORD}}`
- App login: standard Shopify OAuth; no separate merchant account
- Production portal URL: `{{PRODUCTION_PORTAL_URL}}`
- Production reviewer credentials: `{{REVIEW_PORTAL_CREDENTIALS}}`
- Test product: `{{REVIEW_PRODUCT}}`
- Test payment steps: `{{TEST_PAYMENT_STEPS}}`

All credentials must remain valid for the entire review period. Do not place real credentials in this repository.
