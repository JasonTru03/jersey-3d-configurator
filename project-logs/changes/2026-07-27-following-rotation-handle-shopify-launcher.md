# Following rotation handle and Shopify launcher repair

## Date

2026-07-27

## Goal

- Attach the personalization action controls to the projected selection frame and make drag rotation visually explicit.
- Repair `Start 3D customization` after Horizon replaces product-detail DOM during variant selection.

## Root causes

### Rotation controls

The action dock already used the projected selection anchor during ordinary renders, but rotation stored a frozen dock layout at pointer down. The frame could therefore change while the controls remained at the old screen position. Rotation also shared the same visual treatment as ordinary click actions.

### Shopify launcher

Both launcher variants bound `click` directly to the initial button node. Horizon can replace that node after a size change. The replacement remained visible but had no listener. The section implementation also ended the click silently when its form lookup missed the current variant.

## Implementation

### Personalization overlay

- The compact action dock now contains edit, duplicate, and delete.
- Rotation is a separate 44-pixel handle attached to the frame's upper-right point by a dashed connector.
- The handle contains a grip icon, rotation icon, and visible `DRAG` cue.
- The frozen-dock state was removed; dock and rotate-handle coordinates are recalculated from the latest projected anchor during an active captured pointer gesture.
- Pointer capture, incremental rotation, keyboard rotation, resize, deletion, and focus behavior are preserved.
- Three-button dock sizing and rotate-handle stage clamping are handled by `personalizationToolbarLayout.js`.

### Shopify launchers

- Both the native Horizon block and installed section now render a native anchor with a complete initial Worker URL.
- A guarded document-level delegated listener survives replacement of the launcher node.
- The live variant is resolved from `form.elements.id`, selected/checked/hidden variant fields, the page URL, then the Liquid-rendered initial variant.
- On click, the delegated listener updates the anchor `href` with the current variant and maps. The browser's native anchor navigation remains the delivery mechanism and fallback.
- The section still preserves the current quantity/add-to-cart placement behavior.

## TDD evidence

### Rotation overlay RED

`PersonalizationToolbarOverlay.test.jsx` first failed because:

- rotation remained inside the four-button dock;
- no rotate-control wrapper, connector, or `DRAG` cue existed;
- the dock stayed frozen after the anchor changed during pointer capture.

### Rotation overlay GREEN

Focused result: `23/23` component tests passed.

### Shopify launcher RED

The first source-contract tests failed because both launchers rendered buttons and used element-level click listeners. The executable DOM-replacement tests then failed with `variantId=111` after the form changed to `222`, reproducing the stale launcher behavior.

### Shopify launcher GREEN

Focused result: `6/6` launcher tests passed. The tests execute each inline launcher script, replace its launcher DOM node, change the form variant, click the replacement link, and verify the resulting URL contains `variantId=222` plus the variant map.

## Verification

| Check | Result |
| --- | --- |
| Full Vitest suite | `46` files, `464/464` tests passed |
| Application build | Passed; `dist/assets/index-DX-8Prsw.js` and `index-DIDfn8h6.css` |
| Shopify build | Passed; `dist/shopify/product-configurator.js` generated |
| Desktop local browser | Separate handle, connector, `DRAG` cue, three-button action dock, resize handle, and selection frame visible |
| 390 x 844 local browser | All overlay controls stayed inside the stage; rotate target remained `44 x 44` |
| Local browser console | No error or warning entries |
| Staging theme readback | Both uploaded assets exactly matched local SHA-256 hashes |
| Live theme readback | Still `7DD82A7E4A8E360D097F5014EBB9C4623146DC696B68A30F69EAF88C2CB39DBF`; live theme was not modified |

Existing non-blocking build notices remain: the Shopify bundle exceeds Vite's 500 kB advisory threshold and `inlineDynamicImports` is ignored while code splitting is disabled.

## Shopify staging evidence

- Store: `testcsj.myshopify.com`
- Unpublished theme: `152059117719` (`3D native launcher staging - 2026-07-23`)
- Backup before upload:
  - `project-logs/backups/2026-07-27-following-rotation-handle-shopify-launcher/staging-before`
- Final readback:
  - block SHA-256: `19464BF31CC6A667A2FA48411D7B24E25E90F5F6989BA798A7351C6FE4D7BA01`
  - section SHA-256: `25C1F26FFA05171FF6CD509DDF032DE9E16630E30B51F291A37CA03DD4443B26`
- Both readback hashes exactly matched the tracked local files.
- The storefront preview redirected both available browser sessions to `/password`. The real staging product click after a size change therefore remains a release-gate check once storefront preview access is present.

## Release boundary

- Cloudflare production Worker remains version `4990c4c2-a715-4030-b9ab-47fb4a0ff034`.
- Shopify live theme `152029888663` remains unchanged.
- Next release action requires confirmation: publish the configurator build to Cloudflare and replace the live theme section after the final staging/storefront click check.

## Modified files

- `src/features/configurator/scene/PersonalizationToolbarOverlay.jsx`
- `src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx`
- `src/features/configurator/scene/personalization-controls.css`
- `src/features/configurator/scene/personalizationToolbarLayout.js`
- `shopify/blocks/product-3d-configurator-launch.liquid`
- `shopify/blocks/product-3d-configurator-launch.test.js`
- `shopify/sections/product-3d-configurator-launch.liquid`
- design and implementation documents under `docs/superpowers/`
