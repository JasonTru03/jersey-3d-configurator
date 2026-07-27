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
