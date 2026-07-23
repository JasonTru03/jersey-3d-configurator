# Horizon native launcher implementation plan

**Goal:** Place the 3D launcher as a native Horizon product-details block without loading the configurator bundle on Shopify.

### Task 1: Capture Horizon block contracts

- [x] Pull `blocks/_product-details.liquid`, `blocks/variant-picker.liquid`, `blocks/buy-buttons.liquid`, and `sections/product-information.liquid` from live theme `152029888663`.
- [x] Confirm `_product-details` accepts `@theme` blocks.
- [x] Confirm the dedicated template contains `variant_picker_R3rGDr` immediately before `buy_buttons_eYQEYi`.

### Task 2: Implement with TDD

- [x] Add failing source-contract tests for a native block with no DOM relocation.
- [x] Add failing migration tests for insertion/removal/order/idempotency.
- [x] Implement the native Liquid block.
- [x] Implement the deterministic template migration.
- [x] Run focused tests.
- [x] Run full repository verification.

### Task 3: Stage and preview

- [x] Create a fresh unpublished copy of the current live Horizon theme.
- [x] Pull the exact live dedicated template.
- [x] Transform it with the tested migration script.
- [x] Upload only the new block and transformed dedicated template to the unpublished theme.
- [ ] Run theme check and desktop/mobile preview. Desktop passed; mobile remains open. Theme Check reported only pre-existing Horizon core findings and no finding in the new block/template.
- [ ] Verify S/M/L/XL launch parameters.

### Task 4: Scoped live rollout

- [ ] Read back live hashes immediately before the write.
- [ ] Upload only the native block and transformed dedicated template.
- [ ] Read back both assets and verify exact hashes/order.
- [ ] Remove the old standalone launcher section asset only in a later cleanup; it is inactive once absent from template order.

### Task 5: Document and publish

- [x] Update the production closure log and current handoff.
- [x] Run final tests/build/diff check.
- [ ] Commit, push both remotes, and record exact remote hashes.
