# Secure Shopify Customization Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each 3D jersey design to a server-priced Shopify bundle that appears as one cart line and is rejected at checkout if any price component is removed, replaced, duplicated, or altered.

**Architecture:** The Cloudflare Worker strictly normalizes the submitted design, recomputes the quote, stores the design record, and signs a short-lived cart contract. A Shopify App Proxy adds every contracted component from the shop origin; a Rust Cart Transform Function merges the components, and a Rust Cart and Checkout Validation Function independently verifies the signed contract and Shopify-calculated amount.

**Tech Stack:** React 19, Vite 8, Vitest 4, Cloudflare Workers/KV, Web Crypto HMAC-SHA256, Shopify CLI 4.5.2, Shopify Functions in Rust/Wasm, Admin GraphQL API, App Proxy.

---

## File structure

### Existing application and Worker

- Modify `src/features/configurator/shopify/cartHandoff.js`: keep launch parsing and surcharge decomposition; replace direct cart permalink creation with secure quote request data and returned handoff URL validation.
- Modify `src/features/configurator/shopify/cartHandoff.test.js`: retain surcharge-combination regression coverage and add signed-handoff client tests.
- Create `src/features/configurator/shopify/cartQuoteClient.js`: perform the quote request and validate the same-shop handoff URL.
- Create `src/features/configurator/shopify/cartQuoteClient.test.js`: cover success, API failure, malformed response, and foreign-shop redirect.
- Modify `src/features/configurator/ui/DesignReviewDialog.jsx` and its test: await secure quote creation, show progress/error, then navigate.
- Create `workers/shopify/designNormalizer.js`: strict allow-list normalization for every billable design field.
- Create `workers/shopify/designNormalizer.test.js`: reject unknown billable selections, excess text, malformed state, and unsupported product IDs.
- Create `workers/shopify/quoteContract.js`: canonical serialization, HMAC sign/verify, expiry, timing-safe comparison, and contract schema validation.
- Create `workers/shopify/quoteContract.test.js`: signature, tampering, expiry, and canonical-order coverage.
- Create `workers/shopify/quotePricing.js`: server-owned variant allow-list and trusted quote/component calculation.
- Create `workers/shopify/quotePricing.test.js`: compare trusted totals with the existing product catalog and reject mapping gaps.
- Create `workers/shopify/cartQuotes.js`: `POST /api/cart-quotes`, durable design record write, short-lived token response, size/body limits, and rate limiting.
- Create `workers/shopify/cartQuotes.test.js`: endpoint and storage-failure coverage.
- Create `workers/shopify/appProxy.js`: Shopify proxy HMAC verification and same-origin `/cart/add.js` handoff HTML.
- Create `workers/shopify/appProxy.test.js`: proxy tampering, token tampering, escaping, and complete item payload coverage.
- Create `workers/router.js` and `workers/router.test.js`: route quote/proxy/design-assets/static requests without expanding `workers/index.js` responsibilities.
- Modify `workers/index.js`: compose the focused router only.
- Modify `wrangler.jsonc`: declare non-secret bindings and document secret names.

### Reusable Shopify app

- Create `shopify-app/shopify.app.toml`: app URL, scopes, App Proxy path, and extension declarations.
- Create `shopify-app/package.json`: pinned Shopify CLI commands.
- Create `shopify-app/extensions/secure-jersey-transform/`: Rust Cart Transform Function and fixtures.
- Create `shopify-app/extensions/secure-jersey-validation/`: Rust Cart and Checkout Validation Function and fixtures.
- Create `shopify-app/scripts/configure-store.mjs`: read store configuration, write app-owned configuration metafield, and register both Functions idempotently.
- Create `shopify-app/scripts/read-store-config.mjs`: read back registration IDs and non-secret configuration fingerprints.

### Documentation and records

- Create `docs/deployment/secure-shopify-bundle-installation.md`: test-store installation, secrets, scopes, product mapping, deployment, verification, rollback, and cross-store migration.
- Create `docs/deployment/secure-shopify-bundle-acceptance.md`: normal and hostile-cart acceptance checklist.
- Create `project-logs/bugs/2026-07-27-removable-customization-surcharge.md`: root cause, exploit path, severity, fix state, and verification evidence.
- Create `project-logs/changes/2026-07-27-secure-shopify-customization-bundle.md`: files, deployment IDs, tests, residual risks, and rollback snapshot references.

## Task 1: Freeze the trusted design and pricing contract

**Files:**
- Create: `workers/shopify/designNormalizer.js`
- Create: `workers/shopify/designNormalizer.test.js`
- Create: `workers/shopify/quotePricing.js`
- Create: `workers/shopify/quotePricing.test.js`
- Read: `src/features/configurator/config/productDefinitions.js`
- Read: `src/features/configurator/config/pricing.js`
- Read: `src/features/configurator/config/customTextItems.js`

- [ ] **Step 1: Write failing strict-normalization tests**

```js
it('rejects a billable selection outside the catalog', () => {
  expect(() => normalizeBillableDesign({
    productId: 'fn8788-jersey', layout: 'm', material: 'forged-free',
    lighting: 'none', extras: {}, overrides: {},
  })).toThrow('Unsupported material.');
});

it('caps custom text at the editor-supported item count', () => {
  const items = Array.from({ length: MAX_CUSTOM_TEXT_ITEMS + 1 }, (_, i) => ({
    id: `text-${i}`, text: 'A',
  }));
  expect(() => normalizeBillableDesign(validState({ customTextItems: items })))
    .toThrow('Too many custom text items.');
});
```

- [ ] **Step 2: Run the focused tests and verify the new modules are missing**

Run: `npm test -- workers/shopify/designNormalizer.test.js workers/shopify/quotePricing.test.js`

Expected: FAIL because `designNormalizer.js` and `quotePricing.js` do not exist.

- [ ] **Step 3: Implement an allow-list normalizer and trusted component calculator**

```js
export function normalizeBillableDesign(input) {
  assertPlainObject(input, 'Invalid design state.');
  assertChoice(input.productId, ['fn8788-jersey'], 'Unsupported product.');
  assertChoice(input.layout, ['s', 'm', 'l', 'xl'], 'Unsupported size.');
  assertChoice(input.material, ['standard', 'stadium', 'player'], 'Unsupported material.');
  assertChoice(input.lighting, ['none', 'name-number', 'raised-print'], 'Unsupported print option.');
  return structuredClone({
    productId: input.productId,
    layout: input.layout,
    material: input.material,
    lighting: input.lighting,
    extras: normalizeExtras(input.extras),
    overrides: normalizeBillableOverrides(input.overrides),
  });
}

export function calculateTrustedComponents({ state, storeConfig }) {
  const normalized = normalizeBillableDesign(state);
  const quote = calculateQuote(jerseyProduct, normalized);
  const jerseyVariantId = storeConfig.jerseyVariants[normalized.layout];
  const surcharge = findSurchargeCombination(storeConfig.surchargeVariants, quote.customizationTotal);
  if (!jerseyVariantId || surcharge === null) throw new Error('Store pricing configuration is incomplete.');
  return { normalized, quote, jerseyVariantId: String(jerseyVariantId), surcharge };
}
```

- [ ] **Step 4: Run pricing and existing quote tests**

Run: `npm test -- workers/shopify/designNormalizer.test.js workers/shopify/quotePricing.test.js src/features/configurator/config/pricing.test.js`

Expected: PASS with all trusted totals matching existing UI totals.

- [ ] **Step 5: Commit the contract checkpoint**

```powershell
git add workers/shopify/designNormalizer.js workers/shopify/designNormalizer.test.js workers/shopify/quotePricing.js workers/shopify/quotePricing.test.js
git commit -m "feat: validate trusted jersey pricing inputs"
```

## Task 2: Implement the signed quote contract

**Files:**
- Create: `workers/shopify/quoteContract.js`
- Create: `workers/shopify/quoteContract.test.js`

- [ ] **Step 1: Write failing signature and tamper tests**

```js
it('verifies the canonical payload and rejects a cheaper component substitution', async () => {
  const contract = validContract();
  const token = await signQuoteContract(contract, 'test-secret');
  await expect(verifyQuoteContract(token, contract.components, 'test-secret', NOW))
    .resolves.toMatchObject({ totalMinor: 10700 });
  const [payload, signature] = token.split('.');
  const cheaper = contract.components.map((item, index) => index === 1
    ? { ...item, variantId: '4900000000000008' }
    : item);
  await expect(verifyQuoteContract(`${payload}.${signature}`, cheaper, 'test-secret', NOW))
    .rejects.toThrow('Invalid quote signature.');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- workers/shopify/quoteContract.test.js`

Expected: FAIL because contract functions are absent.

- [ ] **Step 3: Implement versioned canonical JSON and Web Crypto HMAC**

```js
export const QUOTE_SCHEMA_VERSION = 1;

export async function signQuoteContract(contract, secret) {
  const payload = encodeBase64Url(JSON.stringify(compactHeader(validateContract(contract))));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = `${payload}.${canonicalComponents(contract.components)}`;
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyQuoteContract(token, components, secret, now = Date.now()) {
  const [payload, supplied] = splitToken(token);
  const expected = await signPayload(`${payload}.${canonicalComponents(components)}`, secret);
  if (!timingSafeEqual(decodeBase64Url(supplied), expected)) throw new Error('Invalid quote signature.');
  const header = validateCompactHeader(JSON.parse(decodeBase64UrlText(payload)));
  if (header.expiresAt <= now) throw new Error('Quote has expired.');
  return { ...header, components: canonicalizeComponents(components) };
}
```

- [ ] **Step 4: Run signature tests**

Run: `npm test -- workers/shopify/quoteContract.test.js`

Expected: PASS for valid, reordered, altered, malformed, and expired cases.

- [ ] **Step 5: Commit**

```powershell
git add workers/shopify/quoteContract.js workers/shopify/quoteContract.test.js
git commit -m "feat: sign secure Shopify cart quotes"
```

## Task 3: Add durable quote issuance

**Files:**
- Create: `workers/shopify/cartQuotes.js`
- Create: `workers/shopify/cartQuotes.test.js`
- Modify: `wrangler.jsonc`

- [ ] **Step 1: Write failing endpoint tests**

```js
it('stores the normalized design before returning a short-lived handoff', async () => {
  const runtime = quoteEnv();
  const response = await createCartQuotesHandler(runtime)(quoteRequest(validBody()));
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toMatchObject({
    designId: expect.stringMatching(/^dsg_/),
    handoffUrl: expect.stringMatching(/^https:\/\/testcsj\.myshopify\.com\/apps\/jersey-configurator\/cart-handoff\?token=/),
    expiresAt: expect.any(Number),
  });
  expect(runtime.DESIGN_QUOTES.put).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- workers/shopify/cartQuotes.test.js`

Expected: FAIL because the handler is absent.

- [ ] **Step 3: Implement `POST /api/cart-quotes` with validation, rate limit, persistence, and sign-after-write ordering**

```js
export function createCartQuotesHandler(env, clock = Date) {
  return async request => {
    enforceJsonRequest(request, 256_000);
    await consumeRateLimit(env.CART_QUOTE_RATE_LIMIT, request);
    const body = await request.json();
    const config = loadStoreConfig(env, body.shop);
    const priced = calculateTrustedComponents({ state: body.state, storeConfig: config });
    const contract = createContract({ priced, shop: body.shop, now: clock.now() });
    await env.DESIGN_QUOTES.put(contract.designId, JSON.stringify(createDesignRecord(body, priced, contract)));
    const token = await signQuoteContract(contract, env.CART_QUOTE_SIGNING_SECRET);
    return Response.json({ designId: contract.designId, expiresAt: contract.expiresAt,
      handoffUrl: `https://${body.shop}/apps/jersey-configurator/cart-handoff?token=${encodeURIComponent(token)}` },
    { status: 201 });
  };
}
```

- [ ] **Step 4: Add non-secret bindings**

```jsonc
"kv_namespaces": [
  { "binding": "DESIGN_QUOTES", "id": "CONFIGURE_PER_ENVIRONMENT" },
  { "binding": "CART_QUOTE_RATE_LIMIT", "id": "CONFIGURE_PER_ENVIRONMENT" }
]
```

Keep `CART_QUOTE_SIGNING_SECRET` and store Admin tokens in `wrangler secret`, not `wrangler.jsonc`.

- [ ] **Step 5: Run endpoint and regression tests**

Run: `npm test -- workers/shopify/cartQuotes.test.js workers/shopify/quoteContract.test.js workers/shopify/designNormalizer.test.js workers/shopify/quotePricing.test.js`

Expected: PASS, including missing-binding, write-failure, oversized-request, quota, and stale-config cases.

- [ ] **Step 6: Commit**

```powershell
git add workers/shopify/cartQuotes.js workers/shopify/cartQuotes.test.js wrangler.jsonc
git commit -m "feat: issue durable server-priced cart quotes"
```

## Task 4: Add the Shopify App Proxy cart handoff

**Files:**
- Create: `workers/shopify/appProxy.js`
- Create: `workers/shopify/appProxy.test.js`

- [ ] **Step 1: Write failing proxy and complete-component tests**

```js
it('renders one atomic cart add request with matching private bundle properties', async () => {
  const response = await createAppProxyHandler(env())(signedProxyRequest(validToken));
  const html = await response.text();
  expect(html).toContain("fetch('/cart/add.js'");
  expect(html).toContain('"_jersey_bundle_id":"bnd_');
  expect(html).toContain('"_jersey_component":"base"');
  expect(html).toContain('"_jersey_component":"surcharge"');
  expect(html).toContain('location.assign(\'/cart\')');
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- workers/shopify/appProxy.test.js`

Expected: FAIL because the App Proxy handler is absent.

- [ ] **Step 3: Implement Shopify proxy verification and escaped HTML handoff**

```js
export async function verifyAppProxy(request, apiSecret) {
  const url = new URL(request.url);
  const supplied = url.searchParams.get('signature') ?? '';
  const message = [...url.searchParams.entries()]
    .filter(([key]) => key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join('');
  if (!(await verifyHexHmac(message, supplied, apiSecret))) throw new Error('Invalid app proxy signature.');
}

export function createCartItems(contract, token, summary) {
  const common = { _jersey_bundle_id: contract.bundleId, _jersey_quote: token,
    _jersey_design_id: contract.designId, _jersey_schema: String(contract.version) };
  return [
    { id: contract.jerseyVariantId, quantity: 1, properties: { ...common,
      _jersey_component: 'base', ...summary } },
    ...contract.surcharge.map(item => ({ id: item.variantId, quantity: item.quantity,
      properties: { ...common, _jersey_component: 'surcharge' } })),
  ];
}
```

- [ ] **Step 4: Run proxy tests**

Run: `npm test -- workers/shopify/appProxy.test.js`

Expected: PASS for valid proxy, altered signature, foreign shop, altered quote, escaped summary, add failure, and success redirect.

- [ ] **Step 5: Commit**

```powershell
git add workers/shopify/appProxy.js workers/shopify/appProxy.test.js
git commit -m "feat: add atomic Shopify app proxy handoff"
```

## Task 5: Compose Worker routes without regressing design assets

**Files:**
- Create: `workers/router.js`
- Create: `workers/router.test.js`
- Modify: `workers/index.js`

- [ ] **Step 1: Write route-precedence tests**

```js
it.each([
  ['POST', '/api/cart-quotes', 'quote'],
  ['GET', '/apps/jersey-configurator/cart-handoff', 'proxy'],
  ['GET', '/api/design-assets/config', 'assets'],
  ['GET', '/', 'static'],
])('routes %s %s to %s', async (method, path, expected) => {
  expect(await routedName(method, path)).toBe(expected);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- workers/router.test.js workers/designAssets.test.js`

Expected: new router tests FAIL; existing design-assets tests PASS.

- [ ] **Step 3: Implement explicit route composition**

```js
export function createWorkerHandler(env) {
  const quote = createCartQuotesHandler(env);
  const proxy = createAppProxyHandler(env);
  const assets = createDesignAssetsHandler(env);
  return request => {
    const { pathname } = new URL(request.url);
    if (request.method === 'POST' && pathname === '/api/cart-quotes') return quote(request);
    if (request.method === 'GET' && pathname === '/apps/jersey-configurator/cart-handoff') return proxy(request);
    return assets(request);
  };
}
```

Set `workers/index.js` to call `createWorkerHandler(env)(request)`.

- [ ] **Step 4: Run all Worker tests**

Run: `npm test -- workers`

Expected: PASS with existing local-production-file behavior unchanged.

- [ ] **Step 5: Commit**

```powershell
git add workers/router.js workers/router.test.js workers/index.js
git commit -m "refactor: compose secure Worker routes"
```

## Task 6: Switch the configurator to secure quote handoff

**Files:**
- Create: `src/features/configurator/shopify/cartQuoteClient.js`
- Create: `src/features/configurator/shopify/cartQuoteClient.test.js`
- Modify: `src/features/configurator/shopify/cartHandoff.js`
- Modify: `src/features/configurator/shopify/cartHandoff.test.js`
- Modify: `src/features/configurator/ui/DesignReviewDialog.jsx`
- Modify: `src/features/configurator/ui/DesignReviewDialog.test.jsx`

- [ ] **Step 1: Write failing request and UI-state tests**

```js
it('posts the normalized design and accepts only a handoff on the launch shop', async () => {
  fetch.mockResolvedValue(Response.json({
    designId: 'dsg_1', expiresAt: Date.now() + 60_000,
    handoffUrl: 'https://testcsj.myshopify.com/apps/jersey-configurator/cart-handoff?token=signed',
  }, { status: 201 }));
  await expect(createSecureCartHandoff({ endpoint: '/api/cart-quotes', context, state, productionFiles }))
    .resolves.toMatchObject({ designId: 'dsg_1' });
});

it('keeps the review open and shows the quote error', async () => {
  quoteClient.mockRejectedValue(new Error('Secure cart quote expired.'));
  await user.click(screen.getByRole('button', { name: /Shopify cart/i }));
  expect(await screen.findByText('Secure cart quote expired.')).toBeVisible();
  expect(location.assign).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- src/features/configurator/shopify/cartQuoteClient.test.js src/features/configurator/shopify/cartHandoff.test.js src/features/configurator/ui/DesignReviewDialog.test.jsx`

Expected: FAIL on missing secure client and async UI state.

- [ ] **Step 3: Implement the secure client and preserve surcharge decomposition as a server utility**

```js
export async function createSecureCartHandoff({ endpoint, context, state, productionFiles }) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shop: context.shop, productHandle: context.productHandle,
      state, productionFiles }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Secure cart quote failed.');
  const handoff = new URL(body.handoffUrl);
  if (handoff.protocol !== 'https:' || handoff.hostname !== context.shop
    || handoff.pathname !== '/apps/jersey-configurator/cart-handoff') {
    throw new Error('Invalid secure cart handoff.');
  }
  return body;
}
```

- [ ] **Step 4: Implement loading/error behavior and navigate only after success**

```jsx
const handleShopifyCart = async () => {
  setCartState({ status: 'loading', error: '' });
  try {
    const result = await createSecureCartHandoff(cartRequest);
    window.location.assign(result.handoffUrl);
  } catch (error) {
    setCartState({ status: 'error', error: error.message });
  }
};
```

- [ ] **Step 5: Run focused and full frontend tests**

Run: `npm test -- src/features/configurator/shopify src/features/configurator/ui/DesignReviewDialog.test.jsx`

Expected: PASS; direct permalink assertions are replaced by secure endpoint assertions while surcharge-combination tests remain.

- [ ] **Step 6: Commit**

```powershell
git add src/features/configurator/shopify src/features/configurator/ui/DesignReviewDialog.jsx src/features/configurator/ui/DesignReviewDialog.test.jsx
git commit -m "feat: request secure Shopify cart handoffs"
```

## Task 7: Scaffold the reusable Shopify app

**Files:**
- Create: `shopify-app/shopify.app.toml`
- Create: `shopify-app/package.json`
- Create: `shopify-app/.gitignore`
- Create: `shopify-app/extensions/secure-jersey-transform/shopify.extension.toml`
- Create: `shopify-app/extensions/secure-jersey-validation/shopify.extension.toml`

- [ ] **Step 1: Create the app shell with pinned commands**

```json
{
  "name": "secure-jersey-shopify-app",
  "private": true,
  "scripts": {
    "shopify": "shopify",
    "build": "shopify app build",
    "deploy": "shopify app deploy",
    "test:functions": "cargo test --manifest-path extensions/secure-jersey-transform/Cargo.toml && cargo test --manifest-path extensions/secure-jersey-validation/Cargo.toml"
  },
  "devDependencies": { "@shopify/cli": "4.5.2" }
}
```

- [ ] **Step 2: Define least-privilege scopes and App Proxy**

```toml
application_url = "https://CONFIGURE_WORKER_DOMAIN/apps/secure-jersey"

[access_scopes]
scopes = "write_cart_transforms,write_cart_validations"

[app_proxy]
url = "https://CONFIGURE_WORKER_DOMAIN/apps/jersey-configurator"
prefix = "apps"
subpath = "jersey-configurator"
```

Before deployment, replace deployment configuration values through Shopify app environments rather than committing store secrets.

- [ ] **Step 3: Generate two Rust Function extensions using Shopify CLI**

Run:

```powershell
cd shopify-app
npx shopify app generate extension --template cart_transform --name secure-jersey-transform --flavor rust
npx shopify app generate extension --template cart_checkout_validation --name secure-jersey-validation --flavor rust
```

Expected: both extension directories contain `Cargo.toml`, `schema.graphql`, `shopify.extension.toml`, `src/`, and generated types.

- [ ] **Step 4: Build the untouched scaffolds**

Run: `cd shopify-app; npm install; npm run build`

Expected: Shopify CLI builds both Wasm extensions successfully.

- [ ] **Step 5: Commit**

```powershell
git add shopify-app
git commit -m "chore: scaffold secure jersey Shopify app"
```

## Task 8: Implement the Cart Transform Function

**Files:**
- Modify: `shopify-app/extensions/secure-jersey-transform/Cargo.toml`
- Modify: `shopify-app/extensions/secure-jersey-transform/src/run.graphql`
- Modify: `shopify-app/extensions/secure-jersey-transform/src/run.rs`
- Create: `shopify-app/extensions/secure-jersey-transform/src/contract.rs`
- Create: `shopify-app/extensions/secure-jersey-transform/tests/fixtures/*.json`

- [ ] **Step 1: Add failing Rust unit tests for exact grouping**

```rust
#[test]
fn complete_signed_group_emits_one_merge() {
    let output = run_fixture("valid-two-component.json");
    assert_eq!(output.operations.len(), 1);
    assert!(matches!(output.operations[0], Operation::LinesMerge(_)));
}

#[test]
fn removed_surcharge_emits_no_merge() {
    let output = run_fixture("missing-surcharge.json");
    assert!(output.operations.is_empty());
}
```

- [ ] **Step 2: Run and verify failing fixtures**

Run: `cargo test --manifest-path shopify-app/extensions/secure-jersey-transform/Cargo.toml`

Expected: FAIL until contract parsing and merge logic exist.

- [ ] **Step 3: Query private attributes, merchandise IDs, costs, and app-owned config**

```graphql
query RunInput {
  shop { config: metafield(namespace: "$app:secure_jersey", key: "config") { jsonValue } }
  cart {
    lines {
      id quantity cost { totalAmount { amount currencyCode } }
      bundleId: attribute(key: "_jersey_bundle_id") { value }
      quote: attribute(key: "_jersey_quote") { value }
      component: attribute(key: "_jersey_component") { value }
      merchandise { ... on ProductVariant { id } }
    }
  }
}
```

- [ ] **Step 4: Implement verify-then-merge logic**

```rust
pub fn transform(input: RunInput) -> Result<FunctionRunResult> {
    let config = StoreConfig::from_metafield(input.shop.config)?;
    let mut operations = Vec::new();
    for group in group_candidate_lines(input.cart.lines) {
        if let Ok(contract) = verify_group(&group, &config) {
            operations.push(Operation::LinesMerge(LinesMerge {
                cart_lines: exact_component_quantities(&group, &contract),
                parent_variant_id: contract.jersey_variant_gid(),
                title: Some("Custom 3D Football Jersey".into()),
                attributes: verified_parent_attributes(&contract),
                image: None,
                price: None,
            }));
        }
    }
    Ok(FunctionRunResult { operations })
}
```

- [ ] **Step 5: Run Rust tests and Shopify fixture execution**

Run:

```powershell
cargo test --manifest-path shopify-app/extensions/secure-jersey-transform/Cargo.toml
cd shopify-app
npx shopify app function run --path extensions/secure-jersey-transform --input extensions/secure-jersey-transform/tests/fixtures/valid-two-component.json
```

Expected: one merge for a valid group; zero merges for missing, substituted, duplicated, expired, or signature-altered groups.

- [ ] **Step 6: Commit**

```powershell
git add shopify-app/extensions/secure-jersey-transform
git commit -m "feat: merge verified jersey bundle components"
```

## Task 9: Implement checkout validation

**Files:**
- Modify: `shopify-app/extensions/secure-jersey-validation/Cargo.toml`
- Modify: `shopify-app/extensions/secure-jersey-validation/src/run.graphql`
- Modify: `shopify-app/extensions/secure-jersey-validation/src/run.rs`
- Create: `shopify-app/extensions/secure-jersey-validation/src/contract.rs`
- Create: `shopify-app/extensions/secure-jersey-validation/tests/fixtures/*.json`

- [ ] **Step 1: Write failing hostile-cart tests**

```rust
#[test]
fn removed_fee_is_blocked() {
    let output = run_fixture("missing-surcharge.json");
    assert_eq!(output.errors[0].target, "$.cart");
    assert!(output.errors[0].message.contains("add it again"));
}

#[test]
fn valid_bundle_has_no_errors() {
    assert!(run_fixture("valid-merged-bundle.json").errors.is_empty());
}
```

- [ ] **Step 2: Run and verify failure**

Run: `cargo test --manifest-path shopify-app/extensions/secure-jersey-validation/Cargo.toml`

Expected: FAIL before validation logic exists.

- [ ] **Step 3: Query signed attributes, line total, quantities, currency, and app config**

Use the same contract field names as Task 8 and include buyer-journey context plus merged parent attributes in `run.graphql`.

- [ ] **Step 4: Implement independent validation**

```rust
pub fn validate(input: RunInput) -> Result<FunctionRunResult> {
    let config = StoreConfig::from_metafield(input.shop.config)?;
    let errors = input.cart.lines.iter().filter_map(|line| {
        if !is_customization_marked(line) { return None; }
        verify_checkout_line(line, &config).err().map(|_| FunctionError {
            localized_message: "This customized jersey changed in the cart. Remove it and add it again from the 3D customizer.".into(),
            target: "$.cart".into(),
        })
    }).collect();
    Ok(FunctionRunResult { errors })
}
```

- [ ] **Step 5: Run the full hostile fixture matrix**

Run: `cd shopify-app; npm run test:functions; npm run build`

Expected: PASS for valid bundle and ordinary blank jersey; checkout errors for removed fee, lower-price substitution, altered quantity, duplicate component, wrong currency, stale schema, expired quote, and bad signature.

- [ ] **Step 6: Commit**

```powershell
git add shopify-app/extensions/secure-jersey-validation
git commit -m "feat: block altered jersey bundles at checkout"
```

## Task 10: Add idempotent store configuration and read-back

**Files:**
- Create: `shopify-app/scripts/configure-store.mjs`
- Create: `shopify-app/scripts/read-store-config.mjs`
- Create: `shopify-app/scripts/storeConfig.test.js`
- Modify: `shopify-app/package.json`

- [ ] **Step 1: Write failing config payload tests**

```js
it('builds an app-owned config without printing the signing secret', () => {
  const result = buildStoreConfig(inputFixture);
  expect(result.metafield.namespace).toBe('$app:secure_jersey');
  expect(result.metafield.key).toBe('config');
  expect(JSON.stringify(result.log)).not.toContain(inputFixture.signingSecret);
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- shopify-app/scripts/storeConfig.test.js`

Expected: FAIL because scripts are absent.

- [ ] **Step 3: Implement idempotent Admin GraphQL mutations**

```js
const mutations = {
  metafield: `mutation SetConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id key updatedAt } userErrors { field message } }
  }`,
  transform: `mutation CreateTransform($functionId: String!) {
    cartTransformCreate(functionId: $functionId) { cartTransform { id } userErrors { field message } }
  }`,
  validation: `mutation CreateValidation($validation: CartValidationCreateInput!) {
    cartValidationCreate(validation: $validation) { cartValidation { id } userErrors { field message } }
  }`,
};
```

Query first, update existing records where supported, and create only when absent. Abort on any `userErrors` and never log the access token or signing secret.

- [ ] **Step 4: Add read-back output**

Print shop domain, product/variant IDs, schema version, Function registration IDs, and SHA-256 secret fingerprint only.

- [ ] **Step 5: Run script tests**

Run: `npm test -- shopify-app/scripts/storeConfig.test.js`

Expected: PASS for create, already-configured, partial API failure, and redacted-log cases.

- [ ] **Step 6: Commit**

```powershell
git add shopify-app/scripts shopify-app/package.json
git commit -m "feat: configure secure bundle functions idempotently"
```

## Task 11: Complete local verification before touching the test store

**Files:**
- Modify only files implicated by test failures.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: all Vitest suites PASS.

- [ ] **Step 2: Run both application builds**

Run: `npm run build`

Expected: Vite app and Shopify exports build successfully.

- [ ] **Step 3: Run Shopify app tests and build**

Run: `cd shopify-app; npm run test:functions; npm run build`

Expected: both Rust suites and both Wasm builds PASS.

- [ ] **Step 4: Audit secrets and generated files**

Run:

```powershell
git grep -n -I -E '(shpat_|shpss_|SHOPIFY_API_SECRET=|CART_QUOTE_SIGNING_SECRET=)' -- . ':!docs/superpowers/plans/*'
git status --short
```

Expected: no credential values; status contains only intentional source/docs plus the pre-existing excluded local folders.

- [ ] **Step 5: Record the local checkpoint**

Run `git status --short` and record the tested commit hash in the change log. Verification fixes belong in the task that owns the affected file, with that task's focused tests rerun before its commit; a no-change verification run creates no empty commit.

## Task 12: Back up and install on the confirmed test store

**Files:**
- Create: `project-logs/backups/2026-07-27-secure-shopify-bundle/`
- Update: `project-logs/changes/2026-07-27-secure-shopify-customization-bundle.md`

- [ ] **Step 1: Pause at the managed-platform checkpoint**

Report the exact local commit, Function build hashes, target shop, app/client ID, Worker environment, product IDs, and planned writes. Receive confirmation that the target remains the test store before remote writes.

- [ ] **Step 2: Read and save the pre-change state**

Save redacted JSON/read-back for:

- shop domain and API version;
- installed app state;
- existing Cart Transform and Cart Validation registrations;
- current jersey and surcharge product/variant IDs and prices;
- current Worker deployment ID, bindings, and non-secret variables;
- current launcher theme ID and launcher section read-back.

- [ ] **Step 3: Provision isolated test bindings and secrets**

Run interactively with test-environment names:

```powershell
npx wrangler kv namespace create DESIGN_QUOTES
npx wrangler kv namespace create CART_QUOTE_RATE_LIMIT
npx wrangler secret put CART_QUOTE_SIGNING_SECRET
npx wrangler secret put SHOPIFY_API_SECRET
```

Record IDs and secret fingerprints, not secret values.

- [ ] **Step 4: Deploy and install the test app**

Run:

```powershell
cd shopify-app
npm run build
npx shopify app deploy
node scripts/configure-store.mjs --shop testcsj.myshopify.com --config .local/test-store.config.json
node scripts/read-store-config.mjs --shop testcsj.myshopify.com
```

Expected: one active Cart Transform, one active Validation, correct product mappings, and matching secret fingerprint.

- [ ] **Step 5: Deploy the exact tested Worker commit**

Run: `npx wrangler deploy`

Expected: deployment reports the intended Worker, bindings, and immutable version ID.

- [ ] **Step 6: Commit only redacted records**

```powershell
git add project-logs/changes/2026-07-27-secure-shopify-customization-bundle.md
git commit -m "docs: record secure bundle test installation"
```

Keep backup exports and `.local` secret/config files untracked.

## Task 13: Perform real storefront and hostile-cart acceptance

**Files:**
- Create: `docs/deployment/secure-shopify-bundle-acceptance.md`
- Create: `project-logs/bugs/2026-07-27-removable-customization-surcharge.md`
- Update: `project-logs/changes/2026-07-27-secure-shopify-customization-bundle.md`

- [ ] **Step 1: Verify the normal storefront journey**

For S, XL, zero customization, one surcharge, and a multi-surcharge composition:

1. launch from the product page;
2. complete the design;
3. add to cart;
4. confirm one visible cart line and exact configurator total;
5. confirm quantity and removal operate on the whole bundle;
6. proceed through checkout without placing a paid order unless the test gateway is explicitly enabled;
7. verify `designId` and summary in the resulting test order when a test order is permitted.

- [ ] **Step 2: Verify hostile cart mutations**

From browser DevTools on the test store, exercise:

```js
await fetch('/cart/change.js', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'TARGET_SURCHARGE_LINE_KEY', quantity: 0 }),
});
```

Also try cheaper variant substitution, quantity change, duplicate surcharge, altered private properties, expired token replay, and two simultaneous designs. Expected: the visible bundle stays atomic or checkout displays the configured validation error.

- [ ] **Step 3: Verify adjacent commerce behavior**

Check cart drawer and cart page, mobile and desktop, discount code, taxes, currency, accelerated checkout entry, browser back/refresh, and ordinary blank jersey purchase.

- [ ] **Step 4: Record evidence and defect status**

The bug log records root cause, critical severity, each reproduction, Function behavior, test-store URLs/IDs without secrets, and final verification status.

- [ ] **Step 5: Commit acceptance records**

```powershell
git add docs/deployment/secure-shopify-bundle-acceptance.md project-logs/bugs/2026-07-27-removable-customization-surcharge.md project-logs/changes/2026-07-27-secure-shopify-customization-bundle.md
git commit -m "docs: verify secure Shopify bundle acceptance"
```

## Task 14: Write reusable installation and migration documentation

**Files:**
- Create: `docs/deployment/secure-shopify-bundle-installation.md`
- Modify: `README.md` if the repository has a maintained top-level README by this checkpoint; otherwise link from the existing deployment-doc index or delivery log.

- [ ] **Step 1: Write the second-store checklist**

Document this exact order:

1. create/select Shopify app;
2. set app URLs and scopes;
3. map jersey and surcharge products;
4. create Cloudflare KV bindings;
5. generate the signing secret and set Worker/app-owned copies;
6. deploy Functions and Worker;
7. register Transform and Validation;
8. configure App Proxy;
9. read back every ID/fingerprint;
10. run normal and hostile acceptance;
11. preserve rollback values.

- [ ] **Step 2: Add copyable environment templates with placeholders only**

```text
SHOP_DOMAIN=TARGET.myshopify.com
WORKER_ORIGIN=https://TARGET_WORKER.workers.dev
JERSEY_PRODUCT_GID=gid://shopify/Product/TARGET
SURCHARGE_PRODUCT_GID=gid://shopify/Product/TARGET
CART_QUOTE_SIGNING_SECRET=<set with wrangler secret and app-owned metafield>
```

- [ ] **Step 3: Add verification and rollback commands**

Include `npm test`, `npm run build`, `npm run test:functions`, Shopify configuration read-back, Function deactivation, previous Worker version deployment, and previous cart-handoff restoration.

- [ ] **Step 4: Review the guide as a clean-room transfer**

Confirm every required store-specific value has a documented source, every secret has a server-only destination, every write has a read-back, and no step depends on this conversation.

- [ ] **Step 5: Commit**

```powershell
git add docs/deployment/secure-shopify-bundle-installation.md README.md
git commit -m "docs: add secure bundle store migration guide"
```

Stage `README.md` only when it exists and was intentionally updated.

## Task 15: User acceptance and GitHub handoff

**Files:**
- Update: `project-logs/changes/2026-07-27-secure-shopify-customization-bundle.md`

- [ ] **Step 1: Present the test-store acceptance location and exact scenarios**

Provide the user with the test product URL, tested design examples, expected totals, one-line cart expectation, and altered-cart checkout expectation.

- [ ] **Step 2: Wait for user acceptance**

Apply only acceptance-related corrections, rerun the affected focused tests plus full builds, and update evidence.

- [ ] **Step 3: Final repository verification**

Run:

```powershell
npm test
npm run build
cd shopify-app
npm run test:functions
npm run build
git status --short
git log -12 --oneline
```

Expected: all tests/builds PASS and no secrets or unrelated files are staged.

- [ ] **Step 4: Push only after explicit user approval**

```powershell
git push origin codex/continuous-bottom-pattern
```

Expected: GitHub accepts the branch without force; report the pushed commit and branch.

## Plan self-review

- Spec coverage: trusted pricing, durable `designId`, Cart Transform, checkout validation, App Proxy, test-store isolation, hostile verification, rollback, and second-store documentation each have an implementation task.
- Placeholder scan: deployment templates intentionally use documented `TARGET`/`CONFIGURE_*` values; implementation actions specify their source before remote writes.
- Type consistency: `_jersey_bundle_id`, `_jersey_quote`, `_jersey_design_id`, `_jersey_component`, schema version, `designId`, `bundleId`, `totalMinor`, jersey variant, and surcharge `{ variantId, quantity }` are shared across Worker, handoff, Transform, and Validation tasks.
- Scope: the three runtime parts form one payment-integrity chain and are tested as one deliverable; unrelated theme/UI redesign and second-store installation remain excluded.
