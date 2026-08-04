# 阶段 3：云端暂存与付款订单关联 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Shopify 加购前把完整七文件生产包保存到私有 R2 和 D1，付款后通过可信的 `orders/paid` 回调将同一 `designId` 关联到正式订单。

**Architecture:** 浏览器先生成现有七文件生产包，再把七个文件上传到 Worker；Worker严格验证 manifest、文件哈希、PNG/PDF 类型和设计指纹，重建 ZIP 后写入私有 R2，并在 D1 建立 `cart_draft`。报价接口只接受已经存在且与当前设计快照一致的 `designId`。Shopify `orders/paid` 回调验证原始请求体 HMAC、店铺、主题和去重 ID 后，检查 R2 文件并把记录更新为 `paid_pending_production` 或 `file_error`。

**Tech Stack:** React 19, Vite 8, Vitest 4, Cloudflare Workers, R2, D1, Turnstile, Shopify App Proxy, Shopify `orders/paid` webhooks.

**Source spec:** `docs/superpowers/specs/2026-07-30-shopify-3d-app-production-workflow-design.md` sections 9, 10, 12, 13 and phase 3 in section 14.

---

### Task 1: Define the browser production-draft upload contract

**Files:**
- Create: `src/features/configurator/api/productionDraftApi.js`
- Create: `src/features/configurator/api/productionDraftApi.test.js`
- Modify: `src/features/configurator/api/turnstile.js`
- Modify: `src/features/configurator/api/turnstile.test.js`

- [ ] **Step 1: Write the failing client contract tests**

Require the client to send one bounded multipart request containing the stable shop, one upload ID, a fresh Turnstile token, and the seven exact production files:

```js
const artifact = {
  files: [
    file('design.json', 'application/json'),
    file('uv-atlas.png', 'image/png'),
    file('uv-pattern-pieces.png', 'image/png'),
    file('uv-reference.pdf', 'application/pdf'),
    file('preview-front.png', 'image/png'),
    file('preview-back.png', 'image/png'),
    file('manifest.json', 'application/json'),
  ],
};

const result = await uploadProductionDraft({
  artifact,
  shop: 'testcsj.myshopify.com',
  turnstileToken: 'verified-token',
  uploadId: 'upl_1234567890abcdef',
});

expect(result).toEqual({
  designId: 'dsg_1234567890abcdef',
  designFingerprint: '6ac2cd02',
  bundleFilename: 'fn8788-jersey-design-6ac2cd02.zip',
  expiresAt: 1788470400000,
});
```

Also reject cross-origin endpoints, malformed shop domains, missing/duplicate filenames, missing tokens, unsafe response shapes, and responses whose expiry is not in the future.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run src/features/configurator/api/productionDraftApi.test.js src/features/configurator/api/turnstile.test.js
```

Expected: FAIL because `uploadProductionDraft` and the production-draft Turnstile action do not exist.

- [ ] **Step 3: Implement the smallest same-origin multipart client**

Implement this public API:

```js
export async function uploadProductionDraft({
  artifact,
  endpoint = '/api/production-drafts',
  fetchImpl = fetch,
  shop,
  signal,
  timeoutMs = 120_000,
  turnstileToken,
  uploadId,
})
```

The form fields are `shop`, `uploadId`, `turnstileToken`, followed by the seven exact filenames as field names. Do not send a bearer token, R2 key, Shopify secret, Base64 image, or arbitrary caller metadata. Reuse the existing abort/timeout discipline from `cartQuoteClient.js` without importing UI state into this module.

Change the Turnstile defaults to:

```js
endpoint = '/api/production-drafts/config'
action = 'production_draft'
```

- [ ] **Step 4: Run GREEN and commit**

Run the same focused Vitest command; all client validation, cancellation and response-contract tests must pass.

```powershell
git add src/features/configurator/api/productionDraftApi.js src/features/configurator/api/productionDraftApi.test.js src/features/configurator/api/turnstile.js src/features/configurator/api/turnstile.test.js
git commit -m "feat: define production draft upload client"
```

### Task 2: Validate the complete production package on the Worker

**Files:**
- Create: `workers/production/productionPackageValidator.js`
- Create: `workers/production/productionPackageValidator.test.js`
- Modify: `src/features/configurator/designs/productionBundle.js`
- Modify: `src/features/configurator/designs/productionBundle.test.js`

- [ ] **Step 1: Write failing validation tests**

Build real `Blob` fixtures and require the Worker validator to:

```js
const validated = await validateUploadedProductionPackage({
  files,
  expectedShop: 'testcsj.myshopify.com',
});

expect(validated).toMatchObject({
  designFingerprint: '6ac2cd02',
  productId: 'fn8788-jersey',
  variantId: '48039101989015',
  size: 'xl',
  modelId: 'chelsea-jersey',
  modelVersion: '1',
  uvExportVersion: '2',
});
```

Add one test per rejection class: wrong filename/order, extra field, empty or oversized file, wrong MIME/magic bytes, malformed JSON, mismatched manifest hash/length, invalid PNG dimensions, invalid PDF signature, manifest/design product or variant mismatch, and a recomputed fingerprint that differs from `manifest.designFingerprint`.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
npx vitest run workers/production/productionPackageValidator.test.js
```

Expected: FAIL because the server validator is missing.

- [ ] **Step 3: Implement validation by reusing the phase-2 contracts**

Convert the six non-manifest form files to the existing shape and call:

```js
await verifyProductionArtifacts(artifactFiles, manifest);
const fingerprint = await createDesignFingerprint({
  model: manifest.model,
  productId: manifest.productId,
  size: manifest.size,
  state: design.state,
  variantId: manifest.variantId,
});
```

Require schema 2, UV export version `"2"`, design document format/version, exact filenames, bounded byte lengths, `%PDF-` and PNG magic bytes, and equality of design/manifest product and variant. Return immutable normalized metadata plus the validated blobs; do not return caller-supplied object keys.

Export a server-safe bundle function from `productionBundle.js` so the Worker rebuilds the ZIP from the validated seven files rather than trusting an uploaded ZIP.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npx vitest run workers/production/productionPackageValidator.test.js src/features/configurator/designs/productionBundle.test.js src/features/configurator/designs/productionManifest.test.js
git add workers/production/productionPackageValidator.js workers/production/productionPackageValidator.test.js src/features/configurator/designs/productionBundle.js src/features/configurator/designs/productionBundle.test.js
git commit -m "feat: validate uploaded production packages"
```

### Task 3: Add the D1 production-design index

**Files:**
- Create: `migrations/0001_production_designs.sql`
- Create: `workers/production/productionRepository.js`
- Create: `workers/production/productionLifecycleSql.js`
- Create: `workers/production/productionRepository.test.js`
- Create: `workers/production/productionRepository.integration.test.js`

- [ ] **Step 1: Write the migration and repository contract tests first**

Require these operations against a D1-compatible fake that records prepared SQL and bound values:

```js
await repository.createCartDraft(draft);
await repository.getDesign('testcsj.myshopify.com', draft.designId);
await repository.getCartDraftByUpload('testcsj.myshopify.com', draft.uploadId);
await repository.bindCartQuote({ shop, designId, bundleId, updatedAt });
await repository.hasWebhookDelivery({ shop, webhookId });
await repository.hasWebhookEvent({ shop, topic, eventId });
await repository.recordOrderLifecycle({ delivery, designs, status: 'paid_pending_production' });
await repository.listExpiredDrafts({ before, staleBefore, limit: 100 });
await repository.claimExpiredDraft({
  shop, designId, expiresAt, claimToken, claimedAt, staleBefore,
});
await repository.deleteClaimedDraft({ shop, designId, expiresAt, claimToken });
```

Verify every SQL query is parameterized, store scope is always included, duplicate `(shop, upload_id)` returns the existing draft, and a design cannot silently move from one Shopify order to another.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run workers/production/productionRepository.test.js
```

Expected: FAIL because the migration and repository are missing.

- [ ] **Step 3: Create the minimum schema**

The migration creates `production_designs` with:

```sql
design_id TEXT PRIMARY KEY,
shop TEXT NOT NULL,
upload_id TEXT NOT NULL,
bundle_id TEXT,
status TEXT NOT NULL CHECK (status IN (
  'upload_pending', 'cart_draft', 'paid_pending_production', 'file_error',
  'cancelled', 'refunded', 'cleanup_pending', 'archived'
)),
product_id TEXT NOT NULL,
variant_id TEXT,
size TEXT NOT NULL,
model_id TEXT NOT NULL,
model_version TEXT NOT NULL,
uv_export_version TEXT NOT NULL,
design_fingerprint TEXT NOT NULL,
manifest_sha256 TEXT NOT NULL,
manifest_key TEXT NOT NULL,
bundle_key TEXT NOT NULL,
bundle_filename TEXT NOT NULL,
created_at INTEGER NOT NULL,
expires_at INTEGER NOT NULL,
paid_at INTEGER,
shopify_order_gid TEXT,
shopify_order_name TEXT,
error_code TEXT,
upload_token TEXT,
cleanup_token TEXT,
cleanup_started_at INTEGER,
updated_at INTEGER NOT NULL,
CHECK (
  (status = 'upload_pending' AND upload_token IS NOT NULL
    AND cleanup_token IS NULL AND cleanup_started_at IS NULL)
  OR (status = 'cleanup_pending' AND upload_token IS NULL
    AND cleanup_token IS NOT NULL AND cleanup_started_at IS NOT NULL)
  OR (status NOT IN ('upload_pending', 'cleanup_pending') AND upload_token IS NULL
    AND cleanup_token IS NULL AND cleanup_started_at IS NULL)
),
UNIQUE (shop, upload_id),
UNIQUE (shop, shopify_order_gid, design_id)
```

Also create `shopify_webhook_deliveries(webhook_id PRIMARY KEY, event_id, shop, topic, order_gid, received_at)`, a partial unique index on `(shop, topic, event_id) WHERE event_id IS NOT NULL`, plus indexes for `(shop, status, created_at)`, `(shop, shopify_order_name)`, `expires_at`, and `cleanup_started_at WHERE status = 'cleanup_pending'`.

Use `PRODUCTION_DB.batch()` with a single bounded JSON bind expanded by `json_each(?)`, one guarded lifecycle `UPDATE`, a conditional `INSERT OR IGNORE` receipt, and a scoped receipt read. Only strictly normalized design fields may be serialized; cast JSON timestamps to SQLite `INTEGER`, preserve JSON null as SQL `NULL`, and reject payloads above 1 MiB. This keeps the exact 250-design boundary below D1's per-query bind and SQL-size limits. The update must affect all requested designs or none; a receipt is accepted only after every design reaches the delivery's final state. Guard terminal transitions and `updated_at` so older or lower-priority events cannot overwrite newer state. Duplicate webhook IDs and duplicate non-null event IDs are idempotent, while cross-scope collisions return a stable conflict without changing designs.

Before the first R2 write, reserve an `upload_pending` row with the final private object keys. Finalize only that same `(shop, designId, uploadId)` row to `cart_draft` after all eight objects are stored. This closes the unindexed-R2 crash window while preserving `(shop, upload_id)` idempotence.

Cleanup must atomically move an expired `upload_pending` or `cart_draft` to `cleanup_pending` with `cleanup_token` and `cleanup_started_at` before any R2 deletion. Require `staleBefore < claimedAt`. A stale `cleanup_pending` lease can be reclaimed after `staleBefore`; payment lifecycle updates must never claim an `upload_pending` or `cleanup_pending` row.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npx vitest run workers/production/productionRepository.test.js workers/production/productionRepository.integration.test.js
git add migrations/0001_production_designs.sql workers/production/productionRepository.js workers/production/productionLifecycleSql.js workers/production/productionRepository.test.js workers/production/productionRepository.integration.test.js docs/superpowers/plans/2026-08-04-phase3-cloud-order-linking.md
git commit -m "feat: add production design d1 index"
```

### Task 4: Store verified cart drafts in private R2

**Files:**
- Modify: `migrations/0001_production_designs.sql`
- Modify: `src/features/configurator/api/productionDraftApi.test.js`
- Modify: `src/features/configurator/designs/productionManifest.js`
- Modify: `src/features/configurator/designs/productionBundle.js`
- Modify: `src/features/configurator/designs/productionBundle.test.js`
- Create: `workers/production/incrementalSha256.js`
- Create: `workers/production/incrementalSha256.test.js`
- Modify: `workers/production/productionPackageValidator.test.js`
- Create: `workers/production/productionDraftRequest.js`
- Create: `workers/production/productionDrafts.js`
- Create: `workers/production/productionDrafts.test.js`
- Modify: `workers/production/productionRepository.js`
- Modify: `workers/production/productionRepository.test.js`
- Modify: `workers/production/productionRepository.integration.test.js`
- Modify: `workers/router.js`
- Modify: `workers/router.test.js`
- Replace legacy responsibility in: `workers/designAssets.js`
- Modify: `workers/designAssets.test.js`

- [ ] **Step 1: Write failing upload-handler tests**

Cover these observable behaviors:

- `GET /api/production-drafts/config` exposes only the Turnstile site key.
- `POST /api/production-drafts` rejects missing bindings, incorrect content type, excessive declared body length, invalid shop/upload ID, failed Turnstile, failed rate limit, malformed files and unconfigured shops before writing R2. An IP/anonymous rate limit must run before `request.formData()`; the shared aggregate upload limit is 32 MiB.
- A valid package first reserves one `upload_pending` D1 row, writes the seven verified files plus the Worker-rebuilt ZIP under `shops/<shopFingerprint>/designs/<designId>/`, and then atomically finalizes that row to `cart_draft`.
- The rebuilt ZIP is passed to `PRODUCTION_ASSETS.put()` as the validated `ReadableStream`; the handler must not turn it back into a whole-package `Blob` or `ArrayBuffer`.
- The rebuilt ZIP is deterministic across repeated stream creation. Hash the first stream incrementally, pass a fresh second stream directly to R2, and store the trusted SHA-256 both as R2 integrity input and `customMetadata.sha256`.
- An R2 write, source-stream or D1 failure removes every key written by that request when ownership is certain and returns a stable 503 without leaking an internal key, stream error or exception. A failed D1 recovery read must preserve indexed R2 objects rather than guessing that no row exists. If compensating R2 deletion fails, return 503 rather than reporting an existing draft or conflict as successful.
- Before writing R2, `getCartDraftByUpload(shop, uploadId)` checks for an existing authoritative row. Repeating the same `(shop, uploadId)` returns the existing matching draft without writing a second package; a different fingerprint for the same upload ID is rejected.
- Every `upload_pending` row has an immutable owner token and is never taken over. Any pending row for the same upload ID returns 409 before package validation or R2 access, regardless of age, so a delayed old writer can never overlap a new owner writing the same private keys.
- Finalization is guarded by the current upload token. A captured failure first atomically changes the owned row to `cleanup_pending`; only the cleanup-token winner may delete R2 and then delete the claimed D1 row. After normal cleanup the same operation can retry. If the process is interrupted, the client starts a new attempt with a new upload ID and the old pending row is reclaimed by the 30-day expiry cron.
- A finalization recovery read of `missing` directly deletes this request's unindexed random-design keys; `read_failed` preserves the objects because ownership is ambiguous.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run workers/production/productionDrafts.test.js workers/router.test.js
```

Expected: FAIL because the route and handler do not exist.

- [ ] **Step 3: Implement the bounded upload pipeline**

Validate bindings before parsing the body:

```js
PRODUCTION_ASSETS.put/get/head/delete
PRODUCTION_DB.prepare/batch
PRODUCTION_UPLOAD_RATE_LIMIT.limit
TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
SHOPIFY_STORE_CONFIG_JSON
```

Use the atomic `validateAndRebuildUploadedProductionPackage()` entry point from Task 2. Use `crypto.randomUUID()` for the server `designId`, SHA-256 for object metadata, and the existing Web Crypto HMAC/fingerprint helpers. Verify Turnstile before expensive package hashing. Reserve an owner-token-guarded `upload_pending` row before R2, never replace its owner, pass a fresh rebuilt ZIP stream directly to R2, and finalize the reservation with the same token only after all writes succeed. Await every R2 write and compensating delete. Treat D1 recovery as three states (`found`, `missing`, `read_failed`) so an ambiguous committed row never loses its files. Before normal compensating deletion, CAS the owned upload row to `cleanup_pending`; delete the D1 row only after R2 deletion succeeds. A confirmed missing row has no published owner and its random-design keys can be deleted directly. Store only private keys in D1 and return:

```json
{
  "designId": "dsg_<random>",
  "designFingerprint": "6ac2cd02",
  "bundleFilename": "fn8788-jersey-design-6ac2cd02.zip",
  "expiresAt": 1788470400000
}
```

Keep the checked-in `LOCAL_PRODUCTION_FILES=true` behavior returning 503 until the stage-3 deployment profile is explicitly enabled. Retire only the legacy bottom-pattern upload route; static `ASSETS.fetch()` remains the final fallback.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npx vitest run src/features/configurator/designs/productionBundle.test.js src/features/configurator/designs/productionManifest.test.js src/features/configurator/api/productionDraftApi.test.js workers/production/incrementalSha256.test.js workers/production/productionPackageValidator.test.js workers/production/productionRepository.test.js workers/production/productionRepository.integration.test.js workers/production/productionDrafts.test.js workers/router.test.js workers/designAssets.test.js
git add migrations/0001_production_designs.sql src/features/configurator/api/productionDraftApi.test.js src/features/configurator/designs/productionManifest.js src/features/configurator/designs/productionBundle.js src/features/configurator/designs/productionBundle.test.js workers/production/incrementalSha256.js workers/production/incrementalSha256.test.js workers/production/productionPackageValidator.test.js workers/production/productionDraftRequest.js workers/production/productionDrafts.js workers/production/productionDrafts.test.js workers/production/productionRepository.js workers/production/productionRepository.test.js workers/production/productionRepository.integration.test.js workers/router.js workers/router.test.js workers/designAssets.js workers/designAssets.test.js docs/superpowers/plans/2026-08-04-phase3-cloud-order-linking.md
git commit -m "feat: store verified production drafts in r2"
```

### Task 5: Require a cloud draft before issuing the Shopify cart quote

**Files:**
- Modify: `src/features/configurator/shopify/cartQuoteClient.js`
- Modify: `src/features/configurator/shopify/cartQuoteClient.test.js`
- Modify: `workers/shopify/cartQuotes.js`
- Modify: `workers/shopify/cartQuotes.test.js`
- Create: `workers/shopify/cloudProductionDraft.js`
- Modify: `workers/shopify/designSummary.js`
- Modify: `workers/shopify/designSummary.test.js`
- Modify: `workers/shopify/appProxy.test.js`
- Modify: `workers/production/productionRepository.js`
- Modify: `workers/production/productionRepository.test.js`
- Modify: `workers/production/productionRepository.integration.test.js`

- [x] **Step 1: Change the request tests first**

The browser request becomes exactly:

```json
{
  "shop": "testcsj.myshopify.com",
  "designId": "dsg_1234567890abcdef",
  "state": {}
}
```

The Worker must reject a missing draft, wrong shop, expired draft, non-`cart_draft` status, product/variant mismatch, changed design fingerprint, missing R2 manifest/ZIP metadata, or a caller-provided production filename/hash.

- [x] **Step 2: Run RED**

```powershell
npx vitest run src/features/configurator/shopify/cartQuoteClient.test.js workers/shopify/cartQuotes.test.js workers/shopify/designSummary.test.js workers/shopify/appProxy.test.js
```

Expected: FAIL because the current quote endpoint generates its own `designId` and trusts the legacy local production summary.

- [x] **Step 3: Make the stored draft authoritative**

Load the D1 row by `(shop, designId)`, recompute the fingerprint from the incoming state plus the stored model/product/variant fields, and compare it to `design_fingerprint`. Check the private manifest and bundle with `R2.head()` before issuing a quote. Use the existing secure random `bundleId`, signing contract, KV quote record and App Proxy flow, but preserve the uploaded `designId`.

Derive this fulfillment summary only from the D1 row and manifest:

```js
{
  'Production Files': 'Cloud package ready',
  'Bundle File': draft.bundleFilename,
  'Design File': 'design.json',
  'Atlas File': 'uv-atlas.png',
  'UV Atlas SHA-256': `sha256:${manifestAtlasSha256}`,
}
```

Bind the generated `bundleId` back to D1 before writing KV or returning the handoff URL. The first successful bind fixes both `bundleId` and the quote `issuedAt`; retries and concurrent candidates must reuse that authoritative pair so a KV failure can be retried without a D1 conflict or a competing token. Do not accept a browser-supplied filename or hash.

- [x] **Step 4: Run GREEN and commit**

```powershell
npx vitest run src/features/configurator/shopify/cartQuoteClient.test.js workers/shopify/cartQuotes.test.js workers/shopify/designSummary.test.js workers/shopify/appProxy.test.js
git add src/features/configurator/shopify/cartQuoteClient.js src/features/configurator/shopify/cartQuoteClient.test.js workers/shopify/cartQuotes.js workers/shopify/cartQuotes.test.js workers/shopify/cloudProductionDraft.js workers/shopify/designSummary.js workers/shopify/designSummary.test.js workers/shopify/appProxy.test.js workers/production/productionRepository.js workers/production/productionRepository.test.js workers/production/productionRepository.integration.test.js docs/superpowers/plans/2026-08-04-phase3-cloud-order-linking.md
git commit -m "feat: require cloud draft for cart handoff"
```

### Task 6: Generate, upload and quote one immutable snapshot from the UI

**Files:**
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx`
- Modify: `src/features/configurator/ui/DesignReviewDialog.jsx`
- Modify: `src/features/configurator/ui/DesignReviewDialog.test.jsx`

- [x] **Step 1: Write failing orchestration tests**

When the user clicks Add to Shopify cart, require this sequence for every design, not only an enabled bottom pattern:

```text
snapshot state
→ createProductionPackage(snapshot)
→ getDesignUploadTurnstileToken()
→ uploadProductionDraft(package, shop)
→ createSecureCartHandoff(snapshot, designId)
→ navigate once
```

Verify that package generation/upload/quote use the same immutable state snapshot, the button stays disabled across all three asynchronous stages, design mutation or dialog close aborts the flow, upload failure never calls the quote endpoint, quote failure keeps the draft retryable, and no automatic browser download occurs.

- [x] **Step 2: Run RED**

```powershell
npx vitest run src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/ui/DesignReviewDialog.test.jsx
```

Expected: FAIL because Add to cart currently skips package generation and uses the local-download receipt.

- [x] **Step 3: Implement one add-to-cart transaction**

Generate an `upl_` ID with Web Crypto per cart attempt, clone the state once, build the production package, obtain a fresh Turnstile token, upload, and pass only the returned `designId` into `createSecureCartHandoff`. Keep Save design as an optional local ZIP download. Remove `localProductionReceipt` from the cart authorization path; a local file must never prove that the cloud draft exists.

Use the existing request ID, `AbortController`, mounted-state and snapshot identity guards. Show one stable user-facing failure message and retain the open review dialog for retry.

- [x] **Step 4: Run GREEN and commit**

```powershell
npx vitest run src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/ui/DesignReviewDialog.test.jsx src/features/configurator/api/productionDraftApi.test.js src/features/configurator/shopify/cartQuoteClient.test.js
git add src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/ui/DesignReviewDialog.jsx src/features/configurator/ui/DesignReviewDialog.test.jsx
git commit -m "feat: upload production package before cart"
```

### Task 7: Associate paid Shopify orders and track order lifecycle idempotently

**Files:**
- Create: `workers/shopify/orderLifecycleWebhooks.js`
- Create: `workers/shopify/orderLifecycleWebhooks.test.js`
- Modify: `workers/router.js`
- Modify: `workers/router.test.js`
- Modify: `shopify-app/shopify.app.toml`
- Modify: `shopify-app/scripts/verify-scaffold.mjs`

- [ ] **Step 1: Write failing HMAC and order-link tests**

Use a raw UTF-8 JSON body and Web Crypto to create the expected base64 HMAC. Cover:

- only `POST /webhooks/shopify/orders` with topic `orders/paid`, `orders/cancelled`, or `refunds/create` is accepted;
- missing/invalid HMAC, malformed shop, missing webhook ID, excessive body, invalid UTF-8/JSON and wrong topic are rejected before D1/R2 access;
- unique `_jersey_design_id` values are read from order line properties, while buyer-facing summaries are ignored;
- shop, stored `bundleId`, product variant and paid order line are consistent;
- both private R2 objects exist with the expected SHA-256 metadata;
- valid records become `paid_pending_production` with order GID/name and paid timestamp;
- missing/corrupt files become `file_error` and are never presented as ready;
- cancellation and refund events update only designs already bound to the same shop/order, without deleting their R2 files;
- duplicate webhook deliveries and repeated events return 200 without duplicating production rows or moving a design to another order.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run workers/shopify/orderLifecycleWebhooks.test.js workers/router.test.js
```

Expected: FAIL because the webhook route and handler are missing.

- [ ] **Step 3: Implement raw-body verification and idempotent linking**

Read the request body once with a strict byte limit. Compute:

```js
base64(HMAC_SHA256(rawBody, SHOPIFY_API_SECRET))
```

Decode the provided header and compare equal-length byte arrays in constant time. Validate `X-Shopify-Shop-Domain`, `X-Shopify-Topic`, `X-Shopify-Webhook-Id` and optional `X-Shopify-Event-Id`. For a paid event, verify every trusted custom line against D1 and R2, then execute one D1 batch containing guarded design updates and `INSERT OR IGNORE` for the delivery receipt. For cancellation/refund events, update only rows already associated with that order; preserve all object keys for later review and download.

Add to `shopify.app.toml`:

```toml
[access_scopes]
scopes = "read_orders,read_cart_transforms,write_cart_transforms,read_validations,write_validations,write_app_proxy"

[[webhooks.subscriptions]]
topics = ["orders/paid", "orders/cancelled", "refunds/create"]
uri = "/webhooks/shopify/orders"
```

Use the relative URI so Shopify resolves it against the private app `application_url`; do not add a second hard-coded Worker domain.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npx vitest run workers/shopify/orderLifecycleWebhooks.test.js workers/router.test.js
npm --prefix shopify-app run verify:scaffold
git add workers/shopify/orderLifecycleWebhooks.js workers/shopify/orderLifecycleWebhooks.test.js workers/router.js workers/router.test.js shopify-app/shopify.app.toml shopify-app/scripts/verify-scaffold.mjs
git commit -m "feat: link shopify order lifecycle to production drafts"
```

### Task 8: Clean expired unpaid drafts without deleting paid files

**Files:**
- Create: `workers/production/cleanupDrafts.js`
- Create: `workers/production/cleanupDrafts.test.js`
- Modify: `workers/index.js`
- Modify: `workers/index.test.js`
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Write failing scheduled-cleanup tests**

Require the scheduled handler to select at most 100 expired `upload_pending` or `cart_draft` rows, plus `cleanup_pending` rows whose lease is older than `staleBefore`. For each candidate it must atomically claim the row with a cryptographically random `cleanupToken`, then delete its eight known R2 keys, then call `deleteClaimedDraft` with the same shop/design/expiry/token guard. Verify it skips `paid_pending_production`, `file_error`, cancelled, refunded and archived records.

An R2 delete failure or Worker interruption must leave the row in `cleanup_pending`; after the lease expires a later run can reclaim and retry it. Add a payment-versus-cleanup race test proving exactly one database transition wins: once cleanup is claimed, payment cannot bind the design; once payment is recorded, cleanup cannot claim or delete its files.

- [ ] **Step 2: Run RED**

```powershell
npx vitest run workers/production/cleanupDrafts.test.js workers/index.test.js
```

Expected: FAIL because the Worker has no scheduled handler.

- [ ] **Step 3: Add the cleanup handler and deployment bindings**

Export both Worker handlers:

```js
export default {
  fetch(request, env, ctx) {
    return getWorkerHandler(env)(request, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(cleanExpiredProductionDrafts(env, controller.scheduledTime));
  },
};
```

Keep `LOCAL_PRODUCTION_FILES` set to `true` in the checked-in default until release preparation. Add draft automatic-provisioning bindings without resource IDs:

```jsonc
"r2_buckets": [{ "binding": "PRODUCTION_ASSETS" }],
"d1_databases": [{
  "binding": "PRODUCTION_DB",
  "migrations_dir": "migrations"
}],
"triggers": { "crons": ["0 3 * * *"] }
```

Add `PRODUCTION_UPLOAD_RATE_LIMIT` as a native rate-limit binding. Do not store either Turnstile key or `SHOPIFY_API_SECRET` in the repository; release preparation sets them with `wrangler secret put`.

The streaming ZIP performs incremental CRC work twice and incremental SHA-256 work once. Require the Workers Paid plan before enabling production uploads and configure a deliberate Standard Usage Model CPU ceiling in `wrangler.jsonc`:

```jsonc
"limits": { "cpu_ms": 30000 }
```

Keep uploads disabled when the account/plan cannot support this limit. Local tests do not enforce Cloudflare CPU limits; the release checkpoint must verify the deployed plan and observe upload CPU time.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npx vitest run workers/production/cleanupDrafts.test.js workers/index.test.js workers/router.test.js
git add workers/production/cleanupDrafts.js workers/production/cleanupDrafts.test.js workers/index.js workers/index.test.js wrangler.jsonc
git commit -m "feat: clean expired production drafts"
```

### Task 9: Deployment documentation, full verification and stage checkpoint

**Files:**
- Create: `docs/deployment/phase3-production-storage.md`
- Create: `project-logs/changes/2026-08-04-phase3-cloud-order-linking.md`
- Create: `project-logs/chat/2026-08-04-phase3-cloud-order-linking.md`
- Modify: `shopify-app/README.md`
- Modify: `docs/superpowers/specs/2026-07-30-shopify-3d-app-production-workflow-design.md`

- [ ] **Step 1: Document the exact activation order and rollback**

The deployment guide must require this order:

1. Verify a non-live app-development store, confirm Workers Paid with the configured `cpu_ms` limit, and record the current Worker/App versions. Production uploads stay disabled if the plan or CPU setting is not confirmed.
2. Create or automatically provision the private R2 bucket and D1 database.
3. Apply `migrations/0001_production_designs.sql` locally, then remotely only after explicit approval.
4. Configure Turnstile with an explicit allowed-hostname list (do not use Any Hostname), then set `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `SHOPIFY_API_SECRET` and the existing quote secret without printing their values.
5. Build and dry-run the Worker and Shopify App.
6. Deploy a test Worker/App version, register `orders/paid`, and perform a Shopify test payment.
7. Verify D1 `upload_pending -> cart_draft` linkage, direct stream-to-R2 behavior, R2 manifest/ZIP SHA-256 metadata and Worker CPU/memory usage at both a representative package size and the 32 MiB boundary; do not expose raw R2 paths.
8. Roll back by restoring the previous Worker/App version and disabling the webhook subscription; preserve R2/D1 data.

State explicitly that pushing Git does not authorize resource creation, migrations, webhook subscription, Shopify App deployment or production Worker deployment.

- [ ] **Step 2: Run focused and full automated verification**

```powershell
npm test
npm run build
npm run build:showcase
npm --prefix shopify-app test
npx wrangler deploy --dry-run
git diff --check
```

Expected: all Vitest and Shopify tests pass, both Vite builds pass, both Rust Functions pass, Wrangler bundles without secrets, and the diff has no whitespace errors.

- [ ] **Step 3: Run local storage/migration checks**

Use the checked-in migration against Wrangler local state and inspect the schema:

```powershell
npx wrangler d1 migrations apply PRODUCTION_DB --local
npx wrangler d1 execute PRODUCTION_DB --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Expected: `production_designs`, `shopify_webhook_deliveries` and Wrangler's migration table exist. Do not use `--remote` in this phase without explicit approval.

- [ ] **Step 4: Perform an in-memory end-to-end contract test**

Drive one real seven-file browser artifact through the Worker handler with fake Turnstile, R2 and D1 bindings, then issue a quote and a correctly signed `orders/paid` webhook. Assert the same `designId` appears in upload response, KV quote record, App Proxy line property and final D1 paid record; corrupting the R2 bundle before the webhook must produce `file_error`.

- [ ] **Step 5: Update logs and commit the stage checkpoint**

Record file ownership, RED/GREEN evidence, test counts, build results, local migration evidence, known deployment blockers, rollback and the fact that phase 4 Admin UI is not included.

```powershell
git add docs/deployment/phase3-production-storage.md project-logs/changes/2026-08-04-phase3-cloud-order-linking.md project-logs/chat/2026-08-04-phase3-cloud-order-linking.md shopify-app/README.md docs/superpowers/specs/2026-07-30-shopify-3d-app-production-workflow-design.md
git commit -m "docs: close phase 3 cloud order linking"
```

### Release gate

Do not merge, push, provision R2/D1, apply remote migrations, set Shopify webhooks, deploy the Shopify App, deploy the Worker, or run a real payment until all automated checks pass and the user separately approves the corresponding external action.
