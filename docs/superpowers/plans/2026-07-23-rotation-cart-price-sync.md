# Print Rotation and Shopify Cart Price Sync Plan

**Goal:** Implement the approved 45-degree rotation button and exact configurator-to-cart total using a jersey line plus an exact customization surcharge line.

### Task 1: Establish regression tests

- [x] Replace pointer-drag rotation tests with click-step and wraparound tests.
- [x] Add quote split assertions for merchandise and customization totals.
- [x] Add cart permalink tests for zero and positive surcharge totals.
- [x] Add launch-context validation tests for the surcharge map.
- [x] Update review and page-flow tests to require the configurator total.
- [x] Run the focused tests and record the expected failures.

### Task 2: Implement the application behavior

- [x] Replace rotation pointer handlers with a 45-degree click action.
- [x] Expose the quote split from `calculateQuote`.
- [x] Pass the quote into cart handoff.
- [x] Build one- or two-variant cart permalinks based on the customization total.
- [x] Remove the obsolete fixed-price review note.
- [x] Extend the Shopify launch context with `surchargeVariantMap`.
- [x] Run focused tests until green.

### Task 3: Configure Shopify

- [x] Capture the current four jersey variant prices.
- [ ] Update `S/M/L` to `$89` and `XL` to `$93`.
- [x] Create the hidden surcharge product and all required positive-price variants.
- [x] Publish it to the Online Store through the authenticated admin session.
- [x] Read back product status, variants, prices, and storefront availability.

### Task 4: Deploy and accept

- [ ] Back up the live launcher section.
- [ ] Upload the updated launcher and read it back.
- [ ] Run the complete test suite, build, diff check, and status check.
- [ ] Commit and push the isolated branch to both remotes.
- [ ] Deploy the tested commit to Cloudflare and read back the deployment.
- [ ] Verify the real `$107` storefront cart path and record evidence.
