# Design asset upload protection

`POST /api/design-assets` is disabled in the checked-in static deployment profile: `LOCAL_PRODUCTION_FILES=true` returns `503` for every design-asset API route and requires no R2, KV, or Turnstile binding. The shopper production path downloads the normalized `jersey-design` JSON and UV Atlas PNG locally.

This document describes the separate server-storage profile. Only enable it after R2, KV, and Turnstile are provisioned. In that profile, `POST /api/design-assets` accepts only a PNG atlas plus a normalized `jersey-design` document and matching bottom-pattern bake metadata. The Worker verifies every upload with Cloudflare Turnstile and compares `sourceHash`, `bakeKey`, `projectionId`, `transform`, and the complete `bakeMetadata` object between the design and submitted metadata.

## Cloudflare configuration

1. Create a Turnstile widget for the configurator Worker origin. Set `LOCAL_PRODUCTION_FILES` to `false` and add its **site key** to the server-storage deployment configuration as `TURNSTILE_SITE_KEY`; the Worker exposes only that public value at `GET /api/design-assets/config`.
2. Store the Turnstile **secret key** only in the Worker environment:

   ```powershell
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

3. Create a KV namespace and add a `DESIGN_UPLOAD_RATE_LIMIT` binding to the server-storage deployment configuration before deploying. It records a per-`CF-Connecting-IP`, per-minute counter. Upload writes are rejected when that binding is absent and capped at 10 successful verification attempts per IP per minute.

The Shopify section and configurator launch URL carry product context only. They carry no upload credential. The browser obtains the public site key from the Worker and requests a fresh Turnstile token immediately before each asset upload.

## Required bindings

- R2: `DESIGN_ASSETS` (server-storage profile only)
- KV: `DESIGN_UPLOAD_RATE_LIMIT` (server-storage profile only)
- Public variable: `TURNSTILE_SITE_KEY`
- Secret: `TURNSTILE_SECRET_KEY`

Do not place the secret key in `wrangler.jsonc`, Shopify section settings, launch parameters, repository files, or frontend bundles.
