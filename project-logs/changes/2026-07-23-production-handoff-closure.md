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

Pending in this checkpoint:

- commit the exact live launcher plus the production-handoff design and plan;
- run the existing 31-file/207-test baseline and both builds;
- push `codex/continuous-bottom-pattern` to `origin` and `backup`;
- read back both remote branch hashes.

## Local production-file closure

Pending implementation:

- record an in-memory receipt only after **Save design** prepares and initiates both downloads;
- require the receipt to match the current design before a bottom-pattern cart handoff;
- block stale or missing production-file references;
- keep Blob content, full JSON, Data URLs, and credentials out of cart properties.

## Verification and remaining acceptance

Pending:

- focused red/green tests for receipt behavior;
- full tests and application/Shopify builds;
- desktop/mobile storefront verification;
- S/M/L/XL launch parameter verification;
- real two-file download, JSON reload, and cart property inspection.

