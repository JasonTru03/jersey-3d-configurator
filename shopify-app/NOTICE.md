# Third-party template notice

The Shopify Function extension scaffolds in this directory retain files
originally rendered from the official `Shopify/function-examples` repository at commit
`19ccafceda1d0052c2c90c0a1e4db3fe37b16c27`:

- `extensions/secure-jersey-transform` comes from
  `checkout/rust/cart-transform/default`.
- `extensions/secure-jersey-validation` comes from
  `checkout/rust/cart-checkout-validation/default`.

Those archived templates used the 2025-01 Function API. The Rust entry points,
targets, result operations, and committed schema snapshots were rebuilt for the
2026-07 API using Shopify's official references:

- `https://shopify.dev/docs/api/functions/2026-07/cart-transform`
- `https://shopify.dev/docs/api/functions/2026-07/cart-and-checkout-validation`

The original Liquid placeholders and conditional naming fields were rendered
as follows:

- Transform `handle` and package/artifact name:
  `secure-jersey-transform`.
- Transform localized `name`: `Secure Jersey Transform`.
- Validation `handle` and package/artifact name:
  `secure-jersey-validation`.
- Validation localized `name`: `Secure Jersey Validation`.
- The optional `uid` line was omitted because no extension UID was supplied.
- Files ending in `.liquid` were rendered to their corresponding scaffold
  filenames without the `.liquid` suffix.

The 2026-07 rebuild changed the transform target to `cart.transform.run`, the
validation target to `cart.validations.generate.run`, and the validation output
to `CartValidationsGenerateRunResult.operations` with a `validationAdd`
operation. Both Rust functions use Shopify's `typegen`, `query`, and
`shopify_function` macros. The deployable build uses `shopify_function` 2.2.0
and the `wasm32-unknown-unknown` target required by Shopify's current Wasm API.

The source templates are licensed under the MIT license. The exact upstream
license text from that commit is included as
`LICENSE.shopify-function-examples.md`.
