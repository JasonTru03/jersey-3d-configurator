# Secure Shopify Customization Bundle

## Local checkpoint — 2026-07-27

- Branch: `codex/continuous-bottom-pattern`
- Verified source commit: `6213d48`
- Remote Shopify writes: none
- Cloudflare deployment: none
- GitHub push: pending user acceptance

### Completed locally

- Worker-owned design normalization, trusted USD pricing, durable `designId`, and signed cart quote.
- Shopify App Proxy handoff that adds the complete component set.
- Shopify 2026-07 Cart Transform Function that verifies and merges an intact jersey bundle.
- Shopify 2026-07 Cart and Checkout Validation Function that blocks altered or incomplete bundles.
- Idempotent store configuration and redacted read-back scripts using registration-owner metafields.
- Cross-language JavaScript/Rust quote-contract fixtures and hostile-cart test coverage.

### Verification evidence

- Root Vitest: 56 files, 623 tests passed.
- Root Vite application and Shopify exports: passed.
- Shopify scaffold, deploy guard, and store configuration tests: passed.
- Store configuration Node tests: 11 passed.
- Cart Transform Rust tests: 23 passed.
- Cart Validation Rust tests: 13 passed.
- Both locked Wasm release builds: passed.
- Shopify CLI application build: passed from an ASCII-only verification mirror of the exact source.
- `npm audit --audit-level=high`: zero known vulnerabilities after updating the locked PostCSS dependency.
- `git diff --check`: passed.
- Credential scan: no committed Shopify access token, Shopify API secret, or cart quote signing secret value.

### Known local environment notes

- The Windows MinGW linker does not reliably handle the repository's Chinese path. Rust and Shopify Function builds are therefore verified from an ASCII-only mirror while preserving the exact committed source and lockfiles.
- Vite reports the existing large-chunk and `inlineDynamicImports` warnings; both builds still complete successfully.
- App Proxy enforces the seven-day quote TTL precisely before cart admission. Offline Shopify Functions only expose store-local calendar comparison for a dynamic signed expiry, so they reject quotes that are definitely stale with a documented worst-case grace of about 60 hours. This grace does not permit a lower-price component set because the HMAC, variant allow-list, quantities, USD subtotal, and component completeness are still enforced.

### Next managed-platform checkpoint

Before the first test-store write, record and confirm:

- target shop domain and Shopify app/client ID;
- current Cart Transform and Validation registrations;
- jersey and surcharge product/variant IDs and prices;
- Worker deployment, bindings, and non-secret variables;
- launcher theme/section state;
- redacted rollback snapshots.

## Managed-platform checkpoint — 2026-07-28

### Completed

- Created the remote `DESIGN_QUOTES` KV namespace and declared the quote/handoff
  rate-limit bindings. The Worker itself has not been deployed from this
  checkpoint.
- Added the Worker secret names `CART_QUOTE_SIGNING_SECRET` and
  `SHOPIFY_API_SECRET`; values remain outside the repository.
- Migrated both Shopify Functions from `shopify_function` 1.1.0 /
  `wasm32-wasip1` to `shopify_function` 2.2.0 /
  `wasm32-unknown-unknown`, which is accepted by Shopify's current Wasm API.
- Released the exact verified Function artifacts to the `csj` test app as
  version `secure-jersey-configurator-2`.
- Added a scaffold guard so named Shopify CLI store configurations remain
  local and never enter Git.

### Verification

- Root Vitest: 56 files, 623 tests passed.
- Root production build: passed.
- Shopify deploy guard: 4 tests passed.
- Shopify store configuration tests: 11 tests passed.
- Transform Rust tests: 23 tests passed.
- Validation Rust tests: 13 tests passed.
- Shopify application build and both Function releases: passed from the
  ASCII-only source mirror.

### Store eligibility finding

Shopify identifies `testcsj.myshopify.com` as a `CLIENT_TRANSFER` store.
Shopify excludes custom/draft app installation on that store type. The real
Function acceptance run therefore requires an App Development Store in the
same `csj` organization. The existing test store remains unchanged by this
app-installation attempt.

### Credential hygiene follow-up

One Shopify CLI diagnostic run used verbose telemetry and wrote three existing
Admin access-token values into the local tool log. The values were not added
to the repository or project files. Rotate the affected test, FKK, and MTT
Admin tokens in their respective app settings before treating those
credentials as current. No FKK or MTT store write is part of this project.

### Pending

- Create an App Development Store after explicit approval.
- Copy only the two test products and required launcher/theme assets.
- Rebind the Worker store configuration to the new store and deploy.
- Install/configure Transform and Validation, then run hostile-cart acceptance.
- Push to GitHub only after user storefront acceptance.
## Test-store registration and hostile-cart acceptance — 2026-07-28

### Remote registration read-back

- Test store: `testcsj-secure-bundle.myshopify.com`.
- Cart Transform registration: `gid://shopify/CartTransform/79495255`, `blockOnFailure: true`.
- Checkout Validation registration: `gid://shopify/Validation/87294039`, enabled and `blockOnFailure: true`.
- Both registration owners contain `json` configuration metafields with matching content and matching local install configuration.
- Function handles resolve to `secure-jersey-transform` and `secure-jersey-validation`.
- No secret value was printed or added to the repository.

### Defects found and fixed during real acceptance

1. Worker signing secrets uploaded through a PowerShell pipeline contained a trailing newline. Both Worker secrets were re-uploaded from exact files through stdin redirection.
2. KV stored the full pricing breakdown while App Proxy required the signed record to contain only `total` and `currency`. `cartQuotes.js` now persists the exact admitted quote shape.
3. Shopify Cart Transform returns an opaque merged `cart/add.js` response. The handoff page previously expected the two original component rows, displayed a false review error, and could add the same design again. The handoff now trusts a parseable same-origin Shopify 2xx response and uses strict reconciliation only after network/error paths.

### Real storefront evidence

- Normal M jersey plus long-sleeve customization: quote HTTP 201, App Proxy handoff succeeded, one merged cart line, quantity 1, total `$107.00`, and automatic redirect to `/cart`.
- Direct surcharge deletion attempt against variant `44079399960663`: rejected by Shopify Validation; cart remained one `$107.00` line with surcharge 18.
- Quantity change from 1 to 2: rejected with the secure-jersey validation message; quantity and total remained unchanged.
- Low-price replacement attempt from surcharge 18 to surcharge 8: rejected; surcharge 18 remained and surcharge 8 was absent.
- Parent-line deletion: succeeded and removed the whole bundle, not only its surcharge.
- Valid bundle checkout: reached the Shopify checkout contact/delivery page with no secure-jersey validation error.
- Final browser state was returned to `/cart` with one valid `$107.00`, quantity-1 merged bundle for manual inspection.

### Deployment and verification

- Current Worker version: `73484913-312c-42e9-b3a9-f9fb627af8c4`.
- Root Vitest: 56 files, 629 tests passed.
- Focused secure-cart tests: 53 passed.
- Store-configuration Node tests: 12 passed.
- Root production and Shopify bundle builds: passed.
- `git diff --check`: passed after cleanup.
- Existing Vite large-chunk and `inlineDynamicImports` warnings remain informational.

### Documentation and remaining safeguards

- Added `shopify-app/README.md` with second-store prerequisites, secret handling, installation order, registration read-back, hostile-cart acceptance, and rollback steps.
- The surcharge product should be removed from storefront recommendations/navigation in every destination store; it is still protected from underpriced custom fulfillment because production must trust only a verified `designId`.
- GitHub upload remains intentionally pending explicit user authorization.
