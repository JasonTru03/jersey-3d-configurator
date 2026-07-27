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

The shared seven-field `StoreConfig` contract requires exactly the four jersey
size entries and between 1 and 64 surcharge entries. Every variant ID is a
canonical positive unsigned 64-bit decimal string; IDs are unique within each
map and the jersey and surcharge maps are disjoint. The Node configuration
script and both Rust Functions enforce the same limits before accepting config.

`valid-two-component.json` therefore acts as the cross-language compatibility
fixture for the exact header encoding, component ordering, compact JSON, and
HMAC message bytes. The hostile fixtures each alter one cart invariant while
retaining the original JavaScript-produced token.

Expiry admission is enforced with millisecond precision by the Worker/App Proxy
for the quote's exact seven-day TTL before these lines enter Shopify. The design
record remains in Cloudflare storage for 180 days. Cart Transform also validates
`issuedAt < expiresAt` and performs a conservative offline replay check using
`shop.localTime.date`. It rejects only when the shop date is later than the
expiry UTC date plus one full grace day. This date/timezone boundary can add up
to roughly three calendar days (about 60 hours in the worst alignment), but it
cannot change the signed components or price. The exact rejection formula is
`currentShopDay > expiryUtcDay + 1`.
`old-expired.json` and `expiry-grace.json` protect both sides of that boundary.

The merged parent adds `_jersey_components`, the same canonical compact
component JSON covered by the token HMAC. Validation can therefore rebuild the
signature from a merged line without trusting browser-supplied component text.
Its encoded value is capped at 255 bytes.

`Size`, `Template`, `Colors`, `Print`, `Custom Text`, `Extras`, and `Artwork`
(plus the all-or-none production-file fields) are copied only from the base
component. Empty display values may be omitted by Shopify and therefore do not
block a valid merge; production-file fields remain all-or-none. These strings
remain buyer-facing display data and are not part of the HMAC.
Fulfillment must ignore those strings and resolve the trusted Worker design
record by the signed `designId`.

The transform accepts only USD, matching the Worker's integer minor-unit
contract, and compares the fixed-point sum of Shopify's pre-discount line
`subtotalAmount` values with the signed `totalMinor`. Native discounts may lower
`totalAmount` without invalidating the quote. It also
caps cart lines, bundle groups, components per group, output operations, and
attribute byte lengths before allocating merge output. A conservative,
deterministic 19,000-byte JSON upper bound is accumulated across all merge
operations; if any candidate would exceed it, the entire invocation returns no
operations so Shopify's 20 KB Function output limit is never approached
partially.
