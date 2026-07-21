# Product 3D Configurator Launcher Acceptance Fixture

## Product fixture

- Product variants: `S`, `M`, `L`, `XL`.
- The launcher supports these native product-form shapes, each using `name="id"` and a variant ID as the value:
  1. `select[name="id"]`
  2. checked `input[name="id"]` (such as a radio input)
  3. `input[type="hidden"][name="id"]`
- The active native product-form selection can change before the launcher is clicked.

## Expected launcher behavior

1. The launcher reads the active native product-form at click time, prioritizing `select[name="id"]`, then checked `input[name="id"]`, then `input[type="hidden"][name="id"]` only when neither of the first two is available.
2. It opens `https://jersey-3d-configurator.jason1064969838.workers.dev/`.
3. Its URL query includes the current `variantId`, a complete lowercase size-to-ID `variantMap`, the Shopify permanent-domain `shop`, the product handle as `productHandle`, and the cart route as `returnPath`.
4. For example, after selecting `XL`, `variantId` matches the `xl` entry in `variantMap`.
