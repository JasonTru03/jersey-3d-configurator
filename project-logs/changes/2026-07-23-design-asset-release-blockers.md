# 2026-07-23 Design asset release blockers

## Goal

Close the bottom-pattern asset upload, metadata validation, and UV-edge consistency blockers before release.

## Changed

- Worker writes now require a matching `DESIGN_ASSET_WRITE_TOKEN` bearer token and return 401 for a missing or incorrect token.
- Shopify launch parsing accepts the short-lived `designToken`; the client sends it only for asset upload and keeps preview and local file save usable without one.
- Add to Shopify cart reports a visible error when an enabled bottom pattern needs storage but the launch has no token.
- The Worker continues to require the exact metadata pair `atlasSize: 2048` and `projectionVersion: 1`.
- UV-island padding is drawn in the same transformed source coordinate system as its triangle fill, preventing padding from sampling a shifted pattern edge.

## Verification

- `npm test` — 30 files, 198 tests passed.
- `npm run build` — app and Shopify bundles built successfully.
- `npx wrangler deploy --dry-run` — Worker and R2 binding validation passed.

## Follow-up

- Configure `DESIGN_ASSET_WRITE_TOKEN` as a Cloudflare Worker secret and issue the matching short-lived Shopify launch token before a production deployment.
