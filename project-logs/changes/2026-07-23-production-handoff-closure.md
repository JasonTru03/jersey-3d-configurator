# Production handoff closure

## Date

2026-07-23

## Goal

Bring the deployed Shopify launcher back under Git control, establish a remote backup for the deployed Cloudflare source, and close the local production-file/cart consistency gap.

## Live Shopify readback

- Store: `testcsj.myshopify.com`
- Shopify CLI: `3.91.1`
- Confirmed live theme: `152029888663` (`Horizon`, `processing: false`)
- Existing pre-change backup: `152031887511`
- Read operation:

```powershell
shopify theme pull --store testcsj.myshopify.com --theme 152029888663 `
  --only 'sections/product-3d-configurator-launch.liquid' `
  --only 'templates/product.3d-configurator.json'
```

### Readback evidence

| Asset | Remote SHA-256 | Result |
| --- | --- | --- |
| `sections/product-3d-configurator-launch.liquid` | `39bdf0ed94da17753e8a55d4d1aa2b52cdfa8a038ebd69f89cc95f5cfd70d733` | Live positioning rules copied back into the tracked launcher. The normalized LF content hash matches the readback: `5d1225c496f986170023a9f05b23c6fb1b7f3e6c794f2c07004ebb3a16265105`. |
| `templates/product.3d-configurator.json` | `3baf06b6497611f4f2d11ecf2fc4df4ae2a4f095c142608a9b82cb8c901f7a66` | Read and recorded; not copied wholesale because it is an auto-generated Horizon template containing theme-owned product blocks outside this feature. |

Verified live template order:

```text
main -> product_3d_configurator_launch -> product_recommendations_qggXJq
```

The launcher section type is `product-3d-configurator-launch`. No Shopify write was performed during this readback.

## Git convergence

Checkpoint commit:

```text
171bb39 docs: converge live production handoff state
```

- The exact live launcher plus the production-handoff design and plan were committed.
- Baseline verification passed: 31 test files, 207 tests, application build, and Shopify build.
- `codex/continuous-bottom-pattern` was pushed to `origin` and `backup`.
- Local, origin, and backup read back the same checkpoint hash:

```text
171bb39e320ccdfcf60f58c265624cfb0c0ea42b
```

## Local production-file closure

Implemented:

- `localProductionReceipt.js` records an in-memory receipt only after **Save design** prepares the production bundle.
- A bottom-pattern cart handoff requires the receipt to match the complete current design state.
- Missing production files show the save-first error and stop navigation.
- Any design edit after saving shows the stale-files error and stops navigation.
- `productionBundle.js` packages the design JSON and UV Atlas PNG in one store-only ZIP download. This avoids Chrome's automatic multi-download gate, which accepted the first file but suppressed the second file during live acceptance.
- Cart handoff receives only the bundle filename, design filename, atlas filename, and atlas SHA-256. Blob content, full JSON, Data URLs, upload URLs, and credentials remain excluded.

## Verification and remaining acceptance

TDD evidence:

- Receipt tests first failed because `localProductionReceipt.js` did not exist, then passed after the minimal implementation.
- UI flow tests first proved the old behavior still navigated without a receipt, then passed after the save/cart gate was added.
- Focused result: 3 files, 23 tests passed.
- Full result: 32 files, 212 tests passed.
- Application build passed: `index-Ctk6hu2Q.js`, 983.09 kB, gzip 273.97 kB.
- Shopify build passed: 1,348.32 kB, gzip 381.14 kB.
- Existing large-chunk and `inlineDynamicImports` warnings remain non-blocking.

### First deployed browser acceptance

Cloudflare Worker version:

```text
fde079fc-5869-4455-a46f-271f0b7b9d5d
```

Desktop live-theme evidence:

- the launcher appeared once between the size picker and the quantity/add controls;
- the launcher width was `456px`, matching the product information column;
- S/M/L/XL each launched the Worker with the corresponding live Shopify variant ID;
- the bottom-pattern cart gate stopped navigation before **Save design**;
- after saving, the XL design entered the Shopify cart as variant `48039101989015`;
- the cart total was `$49.99 USD`;
- cart properties contained `Production Files`, `Design File`, and the exact UV Atlas SHA-256;
- checkout and order creation were not entered.

The same acceptance exposed the browser delivery defect: `fn8788-jersey-design.json` reached the Downloads folder, while the second automatic `fn8788-jersey-uv-atlas.png` download was suppressed. The ZIP-bundle change is the direct fix.

The first ZIP deployment exposed a second browser-specific edge: preparing the bundle asynchronously and then creating a synthetic anchor click did not produce a file in the authenticated Chrome session. Extending the object-URL lifetime alone did not change that result, and an unpatterned JSON control download from the same implementation also stayed absent. The production flow now separates preparation from delivery: **Save design** prepares the Blob and exposes a native `Download production ZIP` link; the user's second click performs the browser-native download and records the cart receipt.

### ZIP regression verification

- Red evidence: the new bundle test failed because `productionBundle.js` did not exist, both UI flow tests failed because the old implementation still initiated two downloads, and the native-link tests failed while the page still used a synthetic click.
- Focused result: 4 files, 24 tests passed.
- Full result: 33 files, 213 tests passed.
- Application build passed: `index-DD39jI1W.js`, 985.20 kB, gzip 274.73 kB.
- Shopify build passed: 1,348.32 kB, gzip 381.14 kB.
- Windows `Expand-Archive` successfully extracted both `fn8788-jersey-design.json` and `fn8788-jersey-uv-atlas.png` from a generated bundle.

Remaining real acceptance after redeploy:

- mobile storefront verification through a stable mobile session.

### Final native-download acceptance

Cloudflare Worker version:

```text
5f29e35d-3db8-47cf-a1f4-a495b02d7370
```

The versioned Worker entry loaded `/assets/index-BLrlGbv_.js` and
`/assets/index-D7hOy3wQ.css`.

- A real browser click downloaded `C:\Users\Administrator\Downloads\fn8788-jersey-production.zip`.
- The ZIP was 91,801 bytes and extracted to `fn8788-jersey-design.json` (2,839 bytes) plus `fn8788-jersey-uv-atlas.png` (88,686 bytes).
- The extracted atlas hash was `sha256:cfe512b6b2d769474e00338ce2e30c821c449600a092f7b7f4ee2edecf7be878`, exactly matching `bakeMetadata.atlasSha256` in the JSON.
- The JSON reported format `jersey-design`, version 2, layout XL, bottom pattern enabled, and preset `chelsea-stripe`.
- After changing the browser design to S, opening the extracted JSON restored XL and the `$93` configurator quote.
- The resulting Shopify cart used variant `48039101989015`, total `$49.99 USD`, and showed `Production Files: Local ZIP download`, `Bundle File: fn8788-jersey-production.zip`, the design filename, and the exact atlas SHA-256.
- Acceptance stopped before checkout and order creation.

The production-file/cart gap is closed. The remaining storefront acceptance item is a stable mobile session.

## Horizon-native launcher staging

The existing standalone launcher remains live while a native Horizon block is staged for the next scoped rollout.

- Staging theme: `152059117719` (`3D native launcher staging - 2026-07-23`, unpublished).
- New block: `blocks/product-3d-configurator-launch.liquid`.
- The migration inserted `product_3d_configurator_launch` inside `main -> product-details` between `variant_picker_R3rGDr` and `buy_buttons_eYQEYi`.
- The old top-level launcher was removed from the staged template, leaving the top-level order `main -> product_recommendations_qggXJq`.
- Staging readback hashes:
  - block: `4375302408bb72ba7eb295fed5de821eebd61be58b79b25a5db4996dbd8a60dc`
  - template: `f1852723f530b0c7a692c3470b8c3d621e6bf94a9debc73dc153375619f82148`
- Desktop preview showed the launcher exactly once after the size picker and before quantity/add/buy controls without DOM relocation.
- Theme Check found no issue in the new block or migrated template. Its six errors and four warnings belong to pre-existing Horizon core files.
- Staged mobile preview and the native block's four-size parameter sweep remain open.
- Live theme `152029888663` was not modified by this native-block staging work.

### Final repository verification

- Horizon source and migration tests: 2 files, 5 tests passed.
- Full test suite: 36 files, 219 tests passed.
- Application build passed: `index-BLrlGbv_.js`, 985.83 kB, gzip 274.91 kB.
- Shopify build passed: 1,348.32 kB, gzip 381.14 kB.
- `git diff --check` passed.
- The existing large-chunk and `inlineDynamicImports` warnings remain non-blocking.

Native-launcher staging checkpoint:

```text
b21c6dfa70220b0d99b8e3d75e7c35782808ec6e
```

The local branch, `origin/codex/continuous-bottom-pattern`, and
`backup/codex/continuous-bottom-pattern` all read back this exact hash.
