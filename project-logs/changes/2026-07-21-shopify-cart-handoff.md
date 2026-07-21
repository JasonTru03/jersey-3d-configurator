# Shopify cart handoff staging and verification

## Date

2026-07-21

## Scope and environment

- Targeted only the ready, unpublished test-store theme `152001609879` (`3D Configurator Cart Handoff - 2026-07-21`); its API readback reported `role: unpublished` and `processing: false` before any write.
- Product: `custom-3d-football-jersey` (product ID `9676223545495`), using `templates/product.json`.
- No live theme was modified, no theme was published, and no checkout or order was created.

## Backups and staged assets

- Full pre-write `templates/product.json` backup: `project-logs/backups/2026-07-21-shopify-cart-handoff/theme-product-template.before.json`.
- The source template SHA-256 was `4874e3bf75e8131ca032c4961196afd01c83ed6c0e1d25611711d9bd0672625a`; the post-write template SHA-256 is `113606a4e5c2248ac0644ea5e56c62801fa997e179c3ff1b52f103582b92b293`.
- `preupload-readback.json` and `postupload-readback.json` record the theme/product metadata, source section hash, template section/order values, and API readback.
- Uploaded asset: `sections/product-3d-configurator-launch.liquid` (SHA-256 `021e95b90342190607fd484546ee7f27cd9b638e3d8960c3af08a15ad2d2004c`).
- Updated only `templates/product.json` to add `product_3d_configurator_launch` with `enabled: true` and the default label `Start 3D customization`. Its resulting order is `product_3d_configurator`, `main`, then `product_3d_configurator_launch`.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | Passed: 24 test files, 152 tests. |
| `npm run build:showcase` | Passed with exit code `0`. |
| `npm run build:shopify` | Passed with exit code `0`; existing Vite warning reports a minified chunk above 500 kB. |
| `git diff --check` | Passed with exit code `0` before staging changes. |
| Admin API readback | The uploaded Liquid content exactly matches the local source; the product template readback includes the configured launcher section and its order entry. |
| Cart URL behavior | Covered by the passing cart-handoff unit tests: the selected size maps to the expected variant cart path, `storefront=true` is present, and 14 concise properties decode as expected. |

## Preview and manual-flow status

- Preview URL: `https://testcsj.myshopify.com/products/custom-3d-football-jersey?preview_theme_id=152001609879`.
- Anonymous HTTP verification redirected to `https://testcsj.myshopify.com/password` with HTTP `200`. The returned page did not include the launcher marker or Worker URL; `http-preview-verification.json` preserves the exact non-authenticated result.
- Therefore browser-level size selection, the actual Worker launch parameters, and live cart-page rendering were not exercised in this run. No password barrier was bypassed.
- API readback confirmed the product variants used by the launcher map: S `48039101890711`, M `48039101923479`, L `48039101956247`, XL `48039101989015`.

## Rollback

1. Restore `templates/product.json` from `project-logs/backups/2026-07-21-shopify-cart-handoff/theme-product-template.before.json` to unpublished theme `152001609879`.
2. Delete `sections/product-3d-configurator-launch.liquid` from that same unpublished theme, or stop using its preview URL.
3. Re-read both assets and confirm the template SHA-256 is `4874e3bf75e8131ca032c4961196afd01c83ed6c0e1d25611711d9bd0672625a`.
