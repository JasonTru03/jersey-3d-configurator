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
