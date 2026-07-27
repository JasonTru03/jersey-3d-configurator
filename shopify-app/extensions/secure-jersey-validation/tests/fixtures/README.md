# Cart and Checkout Validation fixtures

The validation fixtures use the same production JavaScript quote tokens,
seven-field app-owned store configuration, compact component contract, and test
secret documented by the Cart Transform fixtures.

Both supported Shopify pipeline shapes are covered:

- raw base and surcharge component groups before a merge;
- merged parent lines carrying canonical `_jersey_components`.

Pricing verification uses Shopify's pre-discount `subtotalAmount`, not the
discounted `totalAmount`. The `valid-discounted-*` fixtures prove that native
discounts remain usable, while `wrong-subtotal.json` proves that changing the
trusted catalog subtotal remains blocked.

The Worker/App Proxy admits a quote only during its exact seven-day TTL and the
Cloudflare design record is retained for 180 days. Because Shopify Functions do
not expose a dynamic epoch value for comparison with a signed header, validation
uses `shop.localTime.date` and rejects only after the shop date is later than the
expiry UTC date plus one full grace day. This may add up to roughly three
calendar days (about 60 hours in the worst alignment), but the HMAC, variants,
quantities, currency, and subtotal remain fixed throughout, so the grace does
not create a lower-price path. The exact rejection formula is
`currentShopDay > expiryUtcDay + 1`.
`old-expired-*` and `expiry-grace-*` cover the reject and grace boundaries.

The same fail-closed rule runs during `CART_INTERACTION`,
`CHECKOUT_INTERACTION`, and `CHECKOUT_COMPLETION`. Missing surcharge fixtures at
all three buyer-journey stages protect that invariant.
