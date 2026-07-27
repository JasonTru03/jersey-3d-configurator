# Cart Transform fixtures

The signed fixture tokens are generated with the production JavaScript contract in
`workers/shopify/quoteContract.js`, not with a second Rust-only signing format.

Shared test configuration:

- shop: `testcsj.myshopify.com`
- shop fingerprint: `shop_5DHRxuwnMgPX`
- signing secret: `task8-transform-test-secret-32-bytes-minimum`
- schema: `1`
- product ID: `fn8788-jersey`
- currency: `USD`
- complete jersey and surcharge variant maps

`valid-two-component.json` therefore acts as the cross-language compatibility
fixture for the exact header encoding, component ordering, compact JSON, and
HMAC message bytes. The hostile fixtures each alter one cart invariant while
retaining the original JavaScript-produced token.

Expiry admission is enforced with millisecond precision by the Worker/App Proxy
before these lines enter Shopify. Cart Transform validates the signed
`issuedAt < expiresAt` structure but deliberately does not invalidate an
already-admitted cart as time passes. `same-day-short-lived.json` protects that
boundary.

The merged parent adds `_jersey_components`, the same canonical compact
component JSON covered by the token HMAC. Validation can therefore rebuild the
signature from a merged line without trusting browser-supplied component text.
Its encoded value is capped at 255 bytes.

`Size`, `Template`, `Colors`, `Print`, `Custom Text`, `Extras`, and `Artwork`
(plus the all-or-none production-file fields) are copied only from the base
component. They remain buyer-facing display data and are not part of the HMAC.
Fulfillment must ignore those strings and resolve the trusted Worker design
record by the signed `designId`.

The transform accepts only the configured currency and compares the
fixed-point sum of Shopify line totals with the signed `totalMinor`. It also
caps cart lines, bundle groups, components per group, output operations, and
attribute byte lengths before allocating merge output.
