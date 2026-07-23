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

### Pending live cutover

- Back up and update the live launcher section.
- Deploy the tested Worker build.
- Change the jersey prices to `89/89/89/93`.
- Verify the real `$107` cart and record the final version/readback.
