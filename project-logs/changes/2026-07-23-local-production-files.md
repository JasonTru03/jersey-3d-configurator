# 2026-07-23 Local production files for bottom patterns

## Goal

Allow an enabled continuous bottom pattern to stay entirely in the browser: Save design downloads the editable design JSON and final UV Atlas PNG, and Shopify cart creation carries concise local-file references instead of requiring a Worker, R2, or Turnstile upload.

## Changed

- `bottomPatternBaker` now calculates a SHA-256 reference for the locally baked PNG.
- `useConfigurator` adds local atlas filename and hash metadata to the saved JSON while keeping the PNG binary out of the document.
- `ConfiguratorPage` locally bakes, hashes, and downloads both production files for Save design. The cart path bakes and hashes only, then passes local production references to Shopify; it does not invoke the upload or Turnstile clients.
- Cart properties for enabled bottom patterns are `Production Files: Local download`, `Design File`, and `UV Atlas SHA-256`. No PNG, JSON payload, URL, or credential is placed in Shopify line properties.
- The design-review dialog explains that production uses the two files downloaded through Save design.
- The existing Worker/R2 upload modules remain in the repository for their separate deployment path.
- `wrangler.jsonc` now uses explicit `LOCAL_PRODUCTION_FILES=true` and declares no R2, KV, or Turnstile binding. All design-asset API routes return a clear `503` in this mode while static resources continue through the Worker asset binding.

## Verification

| Command | Result |
| --- | --- |
| `npm test` | Passed: 31 files, 206 tests. |
| `npm run build` | Passed: application and Shopify bundles built successfully. |
| `git diff --check` | Passed: no whitespace errors. |

## Boundaries and follow-up

- The cart only stores text references. Production staff must obtain the downloaded JSON and PNG from the shopper/order workflow; this mode does not persist binary files server-side.
- Browser-level WebGL/manual download acceptance remains to be performed in a browser with WebGL. The automated suite verifies the local bake metadata, hash, JSON serialization, cart properties, and review messaging.
- The existing Vite chunk-size warning above 500 kB remains non-blocking and unchanged.
- Server-side asset storage remains a separate opt-in deployment profile that requires R2, KV, and Turnstile provisioning.
