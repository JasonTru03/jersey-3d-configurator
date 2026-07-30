# Personalization controls and artwork drag performance design

## Goal

Fix three related customer-facing problems without changing personalization data,
pricing, image quality, saved design formats, or Shopify cart behavior:

1. Keep edit, duplicate, delete, and rotate controls visible without overlap.
2. Arrange the player editor as one `Side` row followed by one `Name + Number`
   row.
3. Make artwork dragging responsive by separating transient 3D preview work from
   the final persisted configuration update.

## Confirmed problems and root causes

### Overlapping delete and rotate controls

`PersonalizationToolbarOverlay` currently asks
`getPersonalizationDockLayout()` and
`getPersonalizationRotateHandleLayout()` to position the action dock and rotate
handle independently. Both helpers avoid the stage edge and the top view toolbar,
but neither receives the other control's rectangle. On a narrow projected
selection, the preferred upper-right rotate handle overlaps the third dock
button, which hides the delete action.

### Player editor row order

`.print-fields` is a two-column grid. The side fieldset, name label, and number
label are three ordinary grid children, so auto-placement produces
`Side + Name` on the first row and `Number` on the second row.

### Artwork drag backlog

Every accepted artwork `pointermove` currently calls
`DecorationEditor.emitPatch()`. That immediately enters the ordinary
`onStatePatch` path, whose default behavior merges configuration state, requests
an updated quote, records history, re-renders React, calls
`GarmentRenderer.update()`, and rebuilds decal geometry. Pointer events can
arrive faster than those state mutations complete, so work queues up behind the
pointer and the artwork visibly lags.

## Design

### 1. Collision-aware personalization control layout

Keep the existing visual model:

- edit, duplicate, and delete remain in the compact action dock;
- rotate remains a separate 44px `DRAG` handle connected to the selection frame;
- resize remains attached to the lower-right frame corner.

Replace independent dock/rotate positioning with one layout result that knows
both rectangles. The resolver will:

1. calculate the dock's clamped grid layout;
2. try the existing upper-right rotate position;
3. reject candidates that intersect any dock button or the stage view toolbar;
4. try, in order, the dock's right side, dock's left side, and a position below
   the dock;
5. clamp the selected candidate inside the stage with at least an 8px edge gap
   and at least an 8px gap from the dock.

If a very narrow stage forces the dock to wrap, the same candidate rules use the
wrapped dock rectangle. The connector line follows the final rotate position.
No action is removed, resized, or hidden.

### 2. Player editor grid

Keep the existing two-column sizing (`Name` flexible, `Number` compact), but make
the side selector span both columns only inside the player `.print-fields`
editor. The resulting order is:

1. `Side`: full-width row with Front and Back;
2. `Name`: flexible-width first column;
3. `Number`: compact second column;
4. drag guidance: full-width final row.

The custom text editor and other field grids remain unchanged. Existing 44px
input and side-button touch targets remain unchanged.

### 3. Two-phase artwork drag

Artwork dragging will use the same preview/commit principle already used by
personalization rotation and resize:

- **Pointer down:** store the selected artwork's original decoration and reset
  transient drag state.
- **Pointer move:** retain only the latest pointer coordinates and schedule at
  most one preview per animation frame.
- **Preview frame:** raycast the latest pointer, compute the placement, and
  rebuild only the selected artwork's in-scene decal surface. Do not call
  `onDecorationsChange`, quote, history, or React state.
- **Pointer up:** flush one pending preview if necessary, then emit exactly one
  final decoration update through the existing state path.
- **Pointer cancel/unmount:** cancel the scheduled frame, restore the original
  in-scene decoration, and emit no configuration update.

The preview continues using `DecalGeometry`, the existing exterior-facing
triangle filter, the uploaded texture, and the current placement/grab-offset
logic. Image resolution, texture sampling, exterior-only behavior, and saved
placement data therefore remain unchanged.

The animation-frame scheduler coalesces high-frequency pointer input; it does not
lower output quality or impose an artificial 30fps limit. Pointer-up flushing
prevents the final cursor position from being dropped when release occurs before
the scheduled frame.

## State and error handling

- Only a completed drag creates one state mutation and one undo checkpoint.
- A click that does not pass the existing four-pixel drag threshold creates no
  mutation.
- A drag whose pointer never intersects a valid visible garment surface creates
  no mutation.
- Pointer cancellation restores the surface from the last persisted decoration.
- A missing selected surface, deleted decoration, or disposed editor cancels the
  preview safely instead of emitting a partial placement.
- Existing selection, camera-visible picking, and exterior-only projection rules
  remain authoritative during preview and commit.

## Test strategy

Tests are written before implementation and must first fail for the reported
behavior.

### Toolbar layout

- Reproduce a narrow projected frame where the current rotate handle intersects
  the delete button.
- Assert edit, duplicate, delete, and rotate rectangles are pairwise disjoint.
- Assert the edit, duplicate, delete, and rotate controls remain inside the
  stage at left, right, top, and wrapped dock boundaries.
- Assert the rotate connector uses the resolved collision-free position.

### Player editor

- Assert the side selector is the first full-width row.
- Assert name and number occupy the same second row.
- Preserve existing accessible labels, values, disabled state, and side
  selection behavior.

### Artwork drag

- Dispatch many pointer moves before animation frames run and assert they
  coalesce to one latest-position preview.
- Assert 60 preview moves produce zero persisted decoration callbacks before
  release and exactly one callback on release.
- Assert the committed placement matches the final preview.
- Assert pointer cancel restores the original surface and commits nothing.
- Assert click-only selection and visibility/exterior-placement tests remain
  unchanged.

Final verification includes focused tests, the full Vitest suite, application and
Shopify builds, browser inspection of the two layouts, and manual dragging on
both Chelsea and FN8788 models.

## Scope and release

This change does not alter garment models, artwork files, personalization prices,
quote composition, saved design schemas, factory export plans, Shopify theme
markup, cart properties, or checkout.

Implementation will use an isolated feature branch and worktree. After tests and
browser acceptance, merging into `showcase` and publishing a new Cloudflare
version require a fresh explicit release confirmation. Rollback is the current
`showcase` commit `289caae` and Cloudflare Worker version
`3657240c-45e9-4864-8d18-a5f9b0c2a394`.
