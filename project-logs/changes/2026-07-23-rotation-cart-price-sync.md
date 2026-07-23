# 2026-07-23 Print Rotation and Cart Price Sync

## Scope

- Change the selected-print rotate control to one clockwise 45-degree step per click.
- Make Shopify cart totals match the configurator quote through a base jersey line and an exact customization surcharge line.

## Baseline

- Branch: `codex/continuous-bottom-pattern`
- Starting commit: `6fc1a181056652b1e227060b6188ec10771de865`
- Shopify shop: `testcsj.myshopify.com`
- Jersey product: `gid://shopify/Product/9676223545495`
- Captured jersey prices before the change: `S/M/L/XL = $49.99`
- Existing surcharge product with handle `3d-customization-surcharge`: none

## Implementation and verification

### Application

- Replaced drag rotation with a normal button that adds 45 degrees and wraps after 315.
- Added `merchandisePrice` and `customizationTotal` to the quote contract.
- Extended Shopify launch parsing with an optional validated `surchargeVariantMap`.
- Cart handoff now adds the selected jersey variant and the exact positive surcharge variant.
- Replaced the fixed `$49.99` review note with the current Shopify cart total.

TDD evidence:

- Focused red run: 11 expected failures across rotation, quote, cart, review, and page flow.
- Focused green run: 6 files, 49 tests passed.
- Full verification: 37 files, 223 tests passed.
- Production build: application and Shopify bundle both exited zero.
- `git diff --check`: exited zero.

### Shopify surcharge product

- Product: `gid://shopify/Product/9678531559575`
- Handle: `3d-customization-surcharge`
- Status: active
- Online Store publication timestamp: `2026-07-23T05:14:40-04:00`
- Search visibility: `seo.hidden = 1`
- Variant count: 33
- Exact positive amounts: `8, 10, 12, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 80`
- All variants read back with price equal to the amount, taxable on, and inventory tracking off.
- `$18` acceptance variant: `gid://shopify/ProductVariant/48046656127127`

### Shopify jersey prices

- Product: `gid://shopify/Product/9676223545495`
- Handle: `custom-3d-football-jersey`
- Read-back prices:
  - S `48039101890711`: `$89`
  - M `48039101923479`: `$89`
  - L `48039101956247`: `$89`
  - XL `48039101989015`: `$93`

### Live theme cutover

- Live theme: `152029888663` (`Horizon`)
- Launcher: `sections/product-3d-configurator-launch.liquid`
- Before backup SHA-256: `39BDF0ED94DA17753E8A55D4D1AA2B52CDFA8A038EBD69F89CC95F5CFD70D733`
- Final launcher MD5: `04C3DAA9405794F90BF83B58433960E8`
- GraphQL readback matched the local source byte-for-byte and contained the `surchargeVariantMap` generated from `all_products['3d-customization-surcharge']`.
- During the first launcher upload, the command was run from the repository root without `--path shopify`, which removed the launcher section from the live theme. The missing file was detected immediately through a GraphQL theme-file readback. The section was restored with `--path shopify --only sections/product-3d-configurator-launch.liquid`, then read back again with the exact matching MD5 above.
- Before and after copies are retained under `project-logs/backups/2026-07-23-rotation-cart-price-sync/`.

### Cloudflare deployment

- Worker URL: `https://jersey-3d-configurator.jason1064969838.workers.dev`
- Deployed source commit: `9cb289cfcdff1270275d559b737bb97e6be290ac`
- Version ID: `8f60a18e-e881-43c0-904d-fdfd77dd106d`
- JavaScript asset: `assets/index-BhSEHxZ-.js`
- CSS asset: `assets/index-DQwU5ICW.css`
- `wrangler versions list` readback confirmed the version at `2026-07-23T09:22:23.697Z`.

### Real storefront acceptance

- The live launcher supplied the M jersey variant and a 33-entry surcharge variant map to the Worker.
- The live configurator showed `$89` before personalization and `$107` after selecting `Name set (+$18)`.
- Selecting the print exposed one `Rotate print 45 degrees` button. A click expanded the projected selection bounds consistently with a clockwise 45-degree turn.
- The review dialog showed `Shopify cart total: $107`.
- A real Shopify cart permalink containing M jersey variant `48039101923479` and `$18` surcharge variant `48046656127127` produced:
  - `Custom 3D Football Jersey / M`: `$89`
  - `3D Customization Surcharge / 18`: `$18`
  - Cart item count: `2`
  - Estimated total: `$107.00 USD`
- Checkout was opened only for total readback; no customer data was entered and no order was placed.

### Final verification

- Focused suite: 6 files, 49 tests passed.
- Full suite: 37 files, 223 tests passed.
- Production build: application and Shopify bundle passed.
- `git diff --check`: passed.
- Non-blocking build warnings remain the existing Vite chunk-size warning and Shopify `inlineDynamicImports` warning.
