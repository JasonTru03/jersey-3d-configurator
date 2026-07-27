# Third-party template notice

The Shopify Function extension scaffolds in this directory were rendered from
the official `Shopify/function-examples` repository at commit
`19ccafceda1d0052c2c90c0a1e4db3fe37b16c27`:

- `extensions/secure-jersey-transform` comes from
  `checkout/rust/cart-transform/default`.
- `extensions/secure-jersey-validation` comes from
  `checkout/rust/cart-checkout-validation/default`.

The Liquid template placeholders and conditional naming fields were rendered as
follows:

- Transform `handle` and package/artifact name:
  `secure-jersey-transform`.
- Transform localized `name`: `Secure Jersey Transform`.
- Validation `handle` and package/artifact name:
  `secure-jersey-validation`.
- Validation localized `name`: `Secure Jersey Validation`.
- The optional `uid` line was omitted because no extension UID was supplied.
- Files ending in `.liquid` were rendered to their corresponding scaffold
  filenames without the `.liquid` suffix.

The source templates are licensed under the MIT license. The exact upstream
license text from that commit is included as
`LICENSE.shopify-function-examples.md`.
