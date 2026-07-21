# Shopify Cart Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the independent 3D configurator send the selected fixed-price Shopify variant and short configuration summary to the test-store cart.

**Architecture:** A pure `cartHandoff` module parses safe launch parameters and builds a Shopify cart permalink with Base64URL-encoded line-item properties. `ConfiguratorPage` reads that context and exposes a cart button only when the launch context is valid. A new Liquid launcher section on the unpublished theme forwards the selected product variant and a size-to-variant map to the Worker without embedding the configurator.

**Tech Stack:** React 19, Vitest, Shopify Liquid, Shopify cart permalink, Vite.

---

### Task 1: Define and test cart handoff data rules

**Files:**
- Create: `src/features/configurator/shopify/cartHandoff.js`
- Create: `src/features/configurator/shopify/cartHandoff.test.js`

- [ ] **Step 1: Write failing tests for launch parsing and cart URL creation**

```js
import { describe, expect, it } from 'vitest';
import { createCartUrl, parseShopifyLaunch } from './cartHandoff.js';

describe('cart handoff', () => {
  it('uses the selected size variant and concise order properties', () => {
    const context = parseShopifyLaunch('?shop=testcsj.myshopify.com&productHandle=custom-3d-football-jersey&variantMap=%7B%22s%22%3A%2248039101890711%22%2C%22m%22%3A%2248039101923479%22%7D');
    const url = createCartUrl({ context, state: { layout: 's', extras: {}, overrides: { appearance: { template: 'solid', colors: { body: '#fff', sleeves: '#fff', shoulderSide: '#111', collar: '#111', pattern: '#d8c17a', number: '#111' } }, printName: 'PLAYER', printNumber: '10', decorations: [] } }, selected: { lighting: { shortLabel: 'Name set' }, extras: [] } });
    expect(url).toContain('/cart/48039101890711:1');
    expect(url).toContain('storefront=true');
  });

  it('rejects an invalid shop host or a missing selected-size variant', () => {
    expect(parseShopifyLaunch('?shop=example.com')).toBeNull();
    expect(() => createCartUrl({ context: { shop: 'testcsj.myshopify.com', variantMap: {} }, state: { layout: 'xl' }, selected: {} })).toThrow('selected size');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/features/configurator/shopify/cartHandoff.test.js`

Expected: FAIL because `cartHandoff.js` does not exist.

- [ ] **Step 3: Implement the pure module**

Implement `parseShopifyLaunch(search)` to accept only `*.myshopify.com`, decode a JSON `variantMap`, and require every mapped value to be numeric. Implement `createCartUrl({ context, state, selected })` to select `variantMap[state.layout]`, assemble only the 14 properties defined in the approved specification, Base64URL-encode the JSON property object, and return the `/cart/{variant}:1?...&storefront=true` URL.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/features/configurator/shopify/cartHandoff.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/configurator/shopify/cartHandoff.js src/features/configurator/shopify/cartHandoff.test.js
git commit -m "feat: build Shopify cart handoff URLs"
```

### Task 2: Add the review-dialog cart action

**Files:**
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`
- Modify: `src/features/configurator/ui/DesignReviewDialog.jsx`
- Modify: `src/features/configurator/ui/DesignReviewDialog.test.jsx`

- [ ] **Step 1: Write failing dialog tests**

Add tests that render a valid `shopifyContext`, assert an enabled `Add to Shopify cart` button and `$49.99 fixed Shopify price` note, then click the button and assert the supplied `onAddToCart` callback receives no arguments. Add a second render with `shopifyContext={null}` and assert the button is disabled with the launch-context explanation.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/features/configurator/ui/DesignReviewDialog.test.jsx`

Expected: FAIL because the dialog has no cart action props or button.

- [ ] **Step 3: Wire the launch context and browser redirect**

In `ConfiguratorPage.jsx`, parse `window.location.search` once with `parseShopifyLaunch`. Add `handleAddToCart` that calls `createCartUrl` from current `state` and `selected`, sets a visible error when URL generation fails, otherwise calls `window.location.assign(url)`. Pass `shopifyContext`, the handler, and a fixed price string to `DesignReviewDialog`.

In `DesignReviewDialog.jsx`, add the cart action beside Save design, show the fixed Shopify price separately from the existing configuration quote, and preserve the original local-save action. Do not pass cart secrets, full design JSON, or uploaded artwork data.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/features/configurator/ui/DesignReviewDialog.test.jsx src/features/configurator/hooks/useConfigurator.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/DesignReviewDialog.jsx src/features/configurator/ui/DesignReviewDialog.test.jsx
git commit -m "feat: add Shopify cart action to design review"
```

### Task 3: Add an independent Shopify product-page launcher

**Files:**
- Create: `shopify/sections/product-3d-configurator-launch.liquid`
- Create: `shopify/sections/product-3d-configurator-launch.test.md`

- [ ] **Step 1: Write the launcher acceptance fixture**

Create `product-3d-configurator-launch.test.md` containing the acceptance inputs: the product has S/M/L/XL variants; the active variant changes in the native product form; the launcher URL contains the current `variantId`, full `variantMap`, `shop`, and product handle; the destination is `https://jersey-3d-configurator.jason1064969838.workers.dev/`.

- [ ] **Step 2: Implement the Liquid section**

Create a section that renders only on its assigned product template. Serialize `product.variants` into a `data-variant-map` object keyed by lowercase option-1 size. Add a button/link script that reads the current product form `input[name="id"]` or `select[name="id"]`, builds the Worker URL with `shop: shop.permanent_domain`, `productHandle: product.handle`, `variantId`, `variantMap`, and `returnPath: routes.cart_url`, and navigates there. Include a schema with editable button label and enabled flag. Do not include Admin credentials, tokens, or theme asset uploads.

- [ ] **Step 3: Verify Liquid structure locally**

Run: `Select-String -Path shopify/sections/product-3d-configurator-launch.liquid -Pattern 'shop.permanent_domain|product.variants|variantMap|routes.cart_url'`

Expected: all four required constructs are present.

- [ ] **Step 4: Commit**

```bash
git add shopify/sections/product-3d-configurator-launch.liquid shopify/sections/product-3d-configurator-launch.test.md
git commit -m "feat: add Shopify configurator launcher section"
```

### Task 4: Verify and stage the unpublished Shopify theme

**Files:**
- Create: `project-logs/changes/2026-07-21-shopify-cart-handoff.md`

- [ ] **Step 1: Run project verification**

Run: `npm test && npm run build:showcase && npm run build:shopify && git diff --check`

Expected: tests and both builds exit with code 0; record any pre-existing bundle-size warning without treating it as failure.

- [ ] **Step 2: Upload only the launcher section to the copied unpublished theme**

Use the configured test-store credentials and theme ID `152001609879` only after `processing` is `false`. Upload `shopify/sections/product-3d-configurator-launch.liquid`; do not touch the live theme or publish any theme.

- [ ] **Step 3: Assign and preview manually**

Add the new section to the test product template in the copied theme, open its `preview_theme_id` URL, choose each size once, then verify the Worker opens with the matching size and that a configured item reaches `/cart` with `$49.99` and all summary properties. Do not proceed to checkout or create an order.

- [ ] **Step 4: Write the change log**

Record the copied theme ID, preview URL, exact product handle, tested sizes, affected files, test results, no-publish status, and rollback action (remove the section or stop using the preview theme).

- [ ] **Step 5: Commit the project log**

```bash
git add project-logs/changes/2026-07-21-shopify-cart-handoff.md
git commit -m "docs: record Shopify cart handoff verification"
```
