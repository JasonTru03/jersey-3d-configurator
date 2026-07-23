# Local Production Handoff Closure Design

## Goal

Make the deployed local-production workflow traceable and prevent a bottom-pattern design from entering the Shopify cart unless the current design's production files have first been generated for download.

## Current problem

The Cloudflare deployment runs with `LOCAL_PRODUCTION_FILES=true`. A shopper is expected to download `design.json` and `uv-atlas.png` before continuing to Shopify.

The current cart handler creates a fresh atlas reference at click time but does not download either file and does not prove that the shopper previously used **Save design**. The cart can therefore claim `Production Files: Local download` while the corresponding files were never prepared for the shopper.

The deployed Shopify launcher also differs from the tracked Liquid file because its live-theme positioning CSS and DOM placement logic were edited online.

## Chosen approach

### Source convergence

- Treat the live Horizon theme `152029888663` as the source for the current launcher placement behavior.
- Copy the exact live launcher back to `shopify/sections/product-3d-configurator-launch.liquid`.
- Record the live template hash and section order in the change log rather than adding the complete Horizon product template to this repository. The template contains theme-owned sections outside this feature's responsibility.
- Push the clean `codex/continuous-bottom-pattern` branch to both configured GitHub remotes before further behavior changes.

### Production-file receipt

- **Save design** remains the operation that creates and downloads the production pair.
- After both download attempts are initiated, keep an in-memory receipt containing:
  - the exact current design-state fingerprint;
  - design filename;
  - atlas filename;
  - atlas SHA-256.
- When **Add to Shopify cart** is clicked with a bottom pattern enabled:
  - require a receipt;
  - require its fingerprint to match the current design state;
  - pass only the receipt's short production references into the cart URL;
  - do not rebake or silently manufacture a new reference during cart navigation.
- If the shopper edits the design after saving, the fingerprint comparison fails and the review dialog asks for a fresh save.
- Designs without a bottom pattern keep the existing cart behavior.

This is intentionally an in-memory gate. Browsers do not provide a portable API that proves a normal download reached permanent storage. The receipt proves that the application generated the exact files and initiated both downloads from the current state.

## File boundaries

- `shopify/sections/product-3d-configurator-launch.liquid`
  - Exact tracked copy of the current live launcher.
- `src/features/configurator/designs/localProductionReceipt.js`
  - Pure creation and validation of a production-file receipt.
- `src/features/configurator/designs/localProductionReceipt.test.js`
  - Receipt creation, missing receipt, stale receipt, and current receipt tests.
- `src/features/configurator/ui/ConfiguratorPage.jsx`
  - Coordinates save/download and cart navigation; stores the current receipt.
- `src/features/configurator/ui/ConfiguratorPage.test.jsx`
  - User-flow coverage proving cart is blocked before save, allowed after save, and blocked after an edit.
- `project-logs/changes/2026-07-23-production-handoff-closure.md`
  - Live-theme readback evidence, Git convergence, implementation, verification, and remaining browser limitations.

## Error handling

- Missing receipt: `Save the current design before adding it to the Shopify cart.`
- Stale receipt: `The design changed after the production files were saved. Save the design again.`
- Atlas generation failures continue to use the existing file error path.
- No credentials, design JSON, Data URLs, or file contents enter the Shopify cart URL.

## Verification

1. Confirm live theme ID and pull the launcher/template through Shopify CLI.
2. Compare and record SHA-256 values.
3. Run receipt unit tests red then green.
4. Run the focused configurator UI tests.
5. Run all 31 test files and both application/Shopify builds.
6. Confirm the feature worktree is clean.
7. Confirm both GitHub remotes contain the branch tip.
8. Use a real storefront session for desktop and mobile save/cart acceptance.

## Rollback

- Git behavior rollback: revert the production-receipt commit.
- Shopify launcher rollback: restore the already-existing live-theme backup after readback, or clear the test product's `templateSuffix`.
- Cloudflare rollback: select the previous successful deployment version.

