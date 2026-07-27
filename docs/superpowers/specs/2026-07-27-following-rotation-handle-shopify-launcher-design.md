# Following Rotation Handle and Reliable Shopify Launcher Design

## Goal

Improve two customer-facing entry points without changing personalization data, pricing, or cart handoff:

1. Make the selected personalization controls visibly belong to and continuously follow the selected object.
2. Keep `Start 3D customization` working after Horizon replaces product-form DOM while a customer changes variants.

## Confirmed interaction

- Edit, duplicate, and delete remain a compact action group immediately above the projected selection frame.
- Rotation becomes a separate handle attached to the frame's upper-right area with a short connector.
- The rotate handle shows a grip cue and a visible `DRAG` hint; its cursor changes from `grab` to `grabbing`.
- The action group and rotate handle recalculate from every new projected anchor, including during an active rotation gesture.
- Pointer capture remains on the rotate handle, so movement continues even though the handle's screen position follows the changing frame.
- Icons remain upright while the projected frame changes shape or orientation.
- Existing keyboard rotation, resize, edit, duplicate, delete, undo/redo, pricing, and saved transforms remain unchanged.

## Toolbar architecture

`PersonalizationToolbarOverlay` continues to own pointer gesture state. The existing frozen dock state is removed. Layout becomes two independently rendered controls:

- a three-button action dock positioned by `getPersonalizationDockLayout`;
- one rotate handle positioned by a dedicated layout helper and rendered outside the action dock.

Both layouts use the latest `anchor` and measured stage area. Boundary clamping keeps the controls in the stage. The rotate connector is presentational and has no pointer target of its own.

## Shopify root cause

The section launcher currently moves its DOM node into Horizon's product details and binds a click listener directly to the current button node. Horizon morphs or replaces that region after variant selection. The replacement button remains visible but no longer owns the original listener. The current missing-variant branch also ends silently.

## Shopify launcher architecture

- Render the launcher control as an anchor with an initial complete configurator URL so navigation has a native browser fallback.
- Install one document-level delegated click listener, guarded by a document dataset flag, rather than binding to a replaceable button node.
- On every click, resolve the nearest applicable product form and read the current variant in this order:
  1. `form.elements.id`;
  2. selected `select[name="id"]`, checked radio, or hidden variant input;
  3. the page URL `variant` query parameter;
  4. the launcher initial variant ID rendered by Liquid.
- Build the final Worker URL from the clicked launcher's current data attributes and selected variant.
- If a variant still is not available, keep the native fallback URL instead of discarding the click.
- Preserve the existing launcher placement beside the quantity/add-to-cart controls and preserve the variant and surcharge maps.

The repository's Horizon block receives the same delegated-navigation behavior so the reusable block and currently installed section do not diverge.

## Test strategy

- Component tests first prove that the rotate handle is outside the ordinary action dock, exposes a drag cue, and follows anchor changes during an active captured gesture.
- Layout tests cover three-button dock sizing and rotate-handle stage clamping.
- Liquid source tests first prove native anchor fallback, delegated click handling, live variant lookup, URL fallback, and absence of an element-level click listener.
- Run focused Vitest tests, then the complete test suite and both production builds.
- Browser acceptance covers repeated rotation while the frame changes, desktop/mobile boundaries, variant selection followed by launcher navigation, and the resulting configurator query parameters.

## Release boundary and rollback

- Cloudflare and Shopify theme publication are separate release operations.
- Validate the built configurator locally and upload the launcher to the unpublished Shopify theme first.
- Read back the unpublished theme asset and test the real product-page click after changing size.
- Request the final publication confirmation before changing the Cloudflare production Worker or Shopify live theme.
- Rollback uses the current Worker version `110d64b1-9eee-4d7c-b7bc-4a9807c4e09f` and the live-theme backup under `project-logs/backups/2026-07-27-launcher-click-diagnosis/`.

## Scope boundary

This work does not change text decal fitting, garment orbit behavior, Shopify pricing, surcharge products, cart properties, design documents, or unrelated theme layout.
