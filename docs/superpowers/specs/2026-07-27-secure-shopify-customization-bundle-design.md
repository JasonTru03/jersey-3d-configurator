# Secure Shopify Customization Bundle Design

## Goal

Close the cart-pricing loophole where a shopper can remove the separate `3D Customization Surcharge` line while retaining the customized jersey and its production details.

The accepted result must:

- present one customized-jersey line and one total in cart and checkout;
- remove the jersey and all price components as one unit;
- derive customization pricing from trusted server rules rather than browser-supplied totals;
- reject altered, incomplete, expired, or mismatched customization bundles at checkout;
- preserve a durable `designId` and concise production summary on the Shopify order;
- be documented so the same app can be configured for another Shopify store;
- remain on the test store until storefront and checkout acceptance is complete.

## Current problem

`src/features/configurator/shopify/cartHandoff.js` currently creates a cart permalink containing the selected jersey variant plus one or more surcharge variants. The production properties are attached separately from the merchandise price. Shopify therefore treats the surcharge as an independently removable cart line.

Theme CSS or JavaScript that hides the surcharge remove control only changes the visible interface. Direct cart requests can still alter the components, so the correction belongs in Shopify's server-side cart and checkout pipeline.

## Approaches considered

### 1. Hidden customization-price variants

Add a second product option such as `Customization price` and generate `Size x Price` variants. This produces a single merchandise line, but creates variant maintenance, SKU, inventory, reporting, and price-synchronization overhead. A forged low-price variant can also carry untrusted customization properties.

### 2. Cart Transform only

Keep the jersey and surcharge components and merge them into one Shopify bundle line. This closes the ordinary remove-button path and avoids variant expansion. On its own, it does not establish that the browser-supplied design and selected surcharge amount agree.

### 3. Signed server quote + Cart Transform + Checkout Validation (selected)

Cloudflare recomputes and signs the quote, a Cart Transform Function merges the complete component set, and a Cart and Checkout Validation Function verifies the signed contract before checkout. This keeps Shopify as the source of charged merchandise prices while making the design-to-price relationship verifiable.

## Architecture

### Configurator application

The React configurator continues to calculate a live display quote for immediate feedback. At add-to-cart time it sends the normalized design state, selected size, and production summary to a new Worker quote endpoint. The browser total is advisory input only.

The existing Shopify launch context continues to identify the shop, jersey size variants, and surcharge variants. Server-side configuration independently restricts which shop, products, variants, and amounts are accepted.

### Cloudflare Worker

The Worker adds three focused responsibilities:

1. normalize and validate the submitted design;
2. recompute merchandise and customization amounts from a server-owned price catalog;
3. issue a seven-day signed quote containing the trusted cart contract.

Each accepted quote receives a random `designId` and `bundleId`. The normalized design record is stored for 180 days in a dedicated Cloudflare binding under `designId`. To stay within Shopify line-property limits, the cart carries a compact signed header containing schema version, shop fingerprint, bundle ID, design ID, total merchandise amount, currency, issued time, and expiry time. The signature also covers the canonical jersey and surcharge component IDs and quantities. Shopify Functions reconstruct that component list from the actual cart lines, so removing or replacing a component invalidates the signature without placing the full design or a long component document in cart properties.

The signing secret is stored as a Cloudflare secret and never appears in launch parameters, repository files, frontend bundles, or line-item display properties.

The Worker also serves the Shopify App Proxy cart-handoff endpoint. It verifies Shopify's proxy signature and the quote before returning a same-origin handoff page. That page submits all bundle components to `/cart/add.js` in one request, with matching private line properties, and then navigates to `/cart`.

### Shopify app

A small reusable Shopify app is added to the repository. It contains:

- one Cart Transform Function;
- one Cart and Checkout Validation Function;
- app configuration and installation scripts/documentation;
- automated Function fixtures covering valid and hostile cart states.

Store-specific product IDs, allowed surcharge variants, currency, quote verification secret, and schema version are stored in app-owned Shopify configuration/metafields. They are not hard-coded into shared Function logic.

### Cart Transform Function

The transform groups lines by the private `bundleId`. A group is merged only when its signed contract is structurally valid and the submitted jersey and surcharge components exactly match the contract.

The merged parent line carries:

- `designId`;
- signed quote contract;
- schema version;
- concise visible customization summary;
- a stable bundle title such as `Custom 3D Football Jersey`.

The displayed parent price is the Shopify-calculated sum of the actual component variants and quantities. Signature verification uses Shopify's pre-discount line `subtotalAmount`, so native discounts may reduce the buyer's `totalAmount` without invalidating the trusted catalog price. The Function does not invent a browser-provided price.

An incomplete or malformed group is left identifiable for validation rather than silently repaired.

### Cart and Checkout Validation Function

The validation Function evaluates every customization-marked cart line. It verifies:

- signature and schema version;
- target shop and currency;
- quote issue and expiry times;
- jersey variant, surcharge variants, and quantities;
- Shopify pre-discount line subtotal against the signed expected total;
- required `designId` and bundle identity;
- absence of orphaned or duplicate customization components.

Validation emits a clear buyer-facing error and blocks checkout when any invariant fails. A normal blank jersey with no customization marker remains a normal merchandise purchase. Production instructions explicitly treat unsigned custom properties as unverified and ignore them.

Shopify Functions perform this verification from their input and app-owned configuration; they do not depend on a network request to Cloudflare during checkout.

The App Proxy enforces the seven-day quote TTL with millisecond precision before
cart admission. Shopify Functions have no dynamic epoch input for comparing the
signed expiry, so their offline replay check uses `shop.localTime.date`. A quote
is rejected only when the shop date is later than the expiry UTC date plus one
full grace day. This conservative timezone boundary can admit a signed quote for
up to roughly three calendar days (about 60 hours in the worst timezone/expiry
alignment), but it never changes the signed components or price and therefore
does not create a lower-price path. After that boundary the cart is blocked and
the shopper must add the design again.

## Data flow

1. Shopify launches the 3D configurator with validated product and variant context.
2. The shopper completes a design and selects a size.
3. The configurator posts normalized state to `POST /api/cart-quotes`.
4. The Worker recalculates price, stores the design record, and returns a signed short-lived handoff URL.
5. The browser opens the store-domain App Proxy handoff URL.
6. The handoff verifies the request and atomically adds jersey and surcharge components with one `bundleId`.
7. Cart Transform merges the exact component group into one buyer-visible line.
8. Checkout Validation verifies the signed contract and Shopify-calculated total.
9. The order retains `designId`, verified summary, and bundle metadata for fulfillment.

## Failure handling

- Quote endpoint failures keep the shopper in the review dialog and display a retryable, plain-language error.
- Unknown stores, variants, amounts, currencies, or stale pricing versions produce an explicit pricing-configuration error.
- The App Proxy rejects quotes past the exact seven-day TTL; Shopify Functions
  reject definitely old carts after their documented date/timezone grace.
- Partial `/cart/add.js` responses are checked before redirecting; failed additions are surfaced rather than reported as successful.
- Invalid Shopify App Proxy signatures receive an error response without creating cart state.
- Invalid or incomplete bundles remain blocked at checkout with instructions to remove the affected customized jersey and add it again from the configurator.
- Quote and handoff endpoints use request-size limits, rate limits, and structured logs without recording signing secrets or full customer data.

## Scope and file boundaries

Expected implementation areas:

- `src/features/configurator/shopify/`: quote client and handoff contract;
- `src/features/configurator/config/`: shared deterministic pricing and normalized design inputs;
- `workers/`: quote issuance, signature handling, design persistence, App Proxy verification, and route composition;
- `shopify-app/`: app configuration plus Cart Transform and Validation Functions;
- `docs/deployment/`: test-store setup, secret/configuration procedure, cross-store migration, verification, and rollback;
- `project-logs/`: defect and delivery records.

Business logic will be split by responsibility rather than added wholesale to `cartHandoff.js` or `workers/index.js`. Existing local production-file behavior remains intact unless a stored design snapshot is required for the secure quote record.

## Delivery phases and checkpoints

### Phase 1: local contract and Function fixtures

- Define the signed quote schema and trusted pricing contract.
- Add red tests for removed surcharge, altered quantity, low-price substitution, expired token, duplicate component, and valid bundle.
- Implement the Cart Transform and Validation Functions locally.
- Checkpoint: all Function fixtures and existing application tests pass.

### Phase 2: Worker quote and handoff

- Add server-side price recomputation, signed quote issuance, design persistence, and App Proxy verification.
- Replace the direct multi-variant cart permalink with the signed store-domain handoff.
- Checkpoint: Worker and frontend integration tests cover success, expiry, tampering, storage failure, and cart-add failure.

### Phase 3: test-store installation

- Back up current Shopify app/theme/product configuration and record IDs before writes.
- Configure the app, app proxy, Function activation, test products, Worker bindings, and shared verification secret.
- Keep changes on the confirmed test store and preserve rollback values.
- Checkpoint: Shopify reads back the installed configuration and activated Functions.

### Phase 4: real storefront acceptance and documentation

- Verify desktop and mobile add-to-cart behavior, cart drawer/cart page, quantity changes, deletion, discounts, taxes, checkout, and order metadata.
- Perform adversarial checks by removing or changing components through cart APIs and confirm checkout rejection.
- Write reusable installation and migration documentation for another store.
- Checkpoint: the user reviews the test-store behavior before any GitHub push.

## Verification matrix

Required acceptance cases:

1. A valid customized jersey appears as one cart line with the configurator total.
2. Removing the visible line removes every underlying component.
3. Changing component quantity or substituting a cheaper surcharge is rejected at checkout.
4. Removing every surcharge component while retaining customization metadata is rejected at checkout.
5. The App Proxy rejects an exact-TTL replay, and Shopify Functions reject a
   replay once it is definitely beyond the documented offline grace.
6. Two different customized jerseys coexist without being cross-merged.
7. A standard blank jersey remains purchasable as ordinary merchandise.
8. Size-specific base prices, discounts, tax treatment, and currency remain consistent with Shopify merchandise.
9. The order exposes the correct `designId` and verified production summary.
10. Existing configurator editing, local file download, Shopify launcher, and non-Shopify showcase paths regress cleanly.

## Deployment and migration documentation

The repository documentation will cover:

- prerequisites and Shopify plan/API checks;
- creating or selecting the Shopify app and installing it on a test store;
- app scopes, App Proxy path, Function deployment, and activation;
- jersey and surcharge product mapping;
- Cloudflare KV/storage bindings and secrets;
- generating and synchronizing the quote verification secret;
- configuring store-specific IDs without editing shared source;
- test commands and hostile-cart acceptance steps;
- uninstall, Function deactivation, Worker rollback, and restoration of previous cart behavior;
- a store-to-store checklist for another AI or developer.

No secret values, customer records, access tokens, or store-private exports will be committed to GitHub.

## Rollback

- Deactivate the Cart Transform and Validation registrations for the test app.
- Restore the previous Worker deployment and direct cart permalink behavior.
- Restore backed-up Shopify configuration values.
- Retain design records for fulfillment/audit until the test data retention decision is made.
- Leave the live theme and production store untouched throughout test-store implementation.

## Explicit exclusions

- Publishing to GitHub before user acceptance.
- Installing into the second store during this task.
- Altering unrelated storefront design or configurator interactions.
- Rebuilding inventory, discount, fulfillment, or order-management systems.
- Treating hidden theme controls as a security boundary.
