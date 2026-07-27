# Cart Transform fixtures

The signed fixture tokens are generated with the production JavaScript contract in
`workers/shopify/quoteContract.js`, not with a second Rust-only signing format.

Shared test configuration:

- shop: `testcsj.myshopify.com`
- shop fingerprint: `shop_5DHRxuwnMgPX`
- signing secret: `task8-transform-test-secret-32-bytes-minimum`
- schema: `1`

`valid-two-component.json` therefore acts as the cross-language compatibility
fixture for the exact header encoding, component ordering, compact JSON, and
HMAC message bytes. The hostile fixtures each alter one cart invariant while
retaining the original JavaScript-produced token.

Expiry admission is enforced with millisecond precision by the Worker/App Proxy
before these lines enter Shopify. Cart Transform validates the signed
`issuedAt < expiresAt` structure but deliberately does not invalidate an
already-admitted cart as time passes. `same-day-short-lived.json` protects that
boundary.
