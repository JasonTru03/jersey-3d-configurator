# Product 3D Configurator Launcher Acceptance Fixture

## Product fixture

- Product variants: `S`, `M`, `L`, `XL`.
- Each native Shopify product-form variant input uses `name="id"` and its variant ID as the value.
- The active native product-form selection can change before the launcher is clicked.

## Expected launcher behavior

1. The launcher reads the active native product-form `input[name="id"]` or `select[name="id"]` at click time.
2. It opens `https://jersey-3d-configurator.jason1064969838.workers.dev/`.
3. Its URL query includes the current `variantId`, a complete lowercase size-to-ID `variantMap`, the Shopify permanent-domain `shop`, the product handle as `productHandle`, and the cart route as `returnPath`.
4. For example, after selecting `XL`, `variantId` matches the `xl` entry in `variantMap`.