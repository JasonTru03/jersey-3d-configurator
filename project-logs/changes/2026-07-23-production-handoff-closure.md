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

- `localProductionReceipt.js` records an in-memory receipt only after **Save design** prepares and initiates both downloads.
- A bottom-pattern cart handoff requires the receipt to match the complete current design state.
- Missing production files show the save-first error and stop navigation.
- Any design edit after saving shows the stale-files error and stops navigation.
- Cart handoff receives only the design filename, atlas filename, and atlas SHA-256. Blob content, full JSON, Data URLs, upload URLs, and credentials remain excluded.

## Verification and remaining acceptance

TDD evidence:

- Receipt tests first failed because `localProductionReceipt.js` did not exist, then passed after the minimal implementation.
- UI flow tests first proved the old behavior still navigated without a receipt, then passed after the save/cart gate was added.
- Focused result: 3 files, 23 tests passed.
- Full result: 32 files, 212 tests passed.
- Application build passed: `index-Ctk6hu2Q.js`, 983.09 kB, gzip 273.97 kB.
- Shopify build passed: 1,348.32 kB, gzip 381.14 kB.
- Existing large-chunk and `inlineDynamicImports` warnings remain non-blocking.

Remaining real acceptance:

- desktop/mobile storefront verification;
- S/M/L/XL launch parameter verification;
- browser confirmation of both download attempts and JSON reload;
- Shopify cart variant and production-property inspection.
