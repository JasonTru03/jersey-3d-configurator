# Toolbar Layout and Artwork Drag Performance

Date: 2026-07-30

## Scope

This batch addresses three customer-facing issues:

1. the separate `DRAG` handle could cover the edit/duplicate/delete toolbar,
   including the delete button;
2. the player editor placed `Side`, `Name`, and `Number` on an awkward first
   row;
3. artwork dragging persisted every pointer movement through the full React,
   quote, history, renderer, and decal rebuild path, causing queued catch-up and
   visible lag.

It also routes browser pointer cancellation through the new non-committing
artwork cancellation path.

## Root causes and delivered behavior

### Personalization controls

The dock and rotate handle previously calculated their positions independently.
On narrow selections or near stage edges, the rotate handle could resolve over
the third dock button.

The layout module now returns one joint result. It:

- keeps edit, duplicate, delete, rotate, and resize available at their existing
  sizes;
- tries the preferred rotate position, then the dock right, dock left, and dock
  bottom positions;
- clamps candidates before collision checks;
- validates the stage boundary, an 8 px dock gap, and the stage toolbar
  obstacle;
- searches deterministic safe boundary positions when the preferred candidates
  are constrained;
- returns an explicit non-collision-free state instead of throwing when the
  geometry is physically impossible;
- lets the overlay reuse the last valid layout during a transient impossible
  measurement and recover when the stage becomes valid again.

### Player field layout

The player side selector was participating in the same two-column grid as the
name and number fields.

A scoped player-editor rule now makes `Side` span both columns. The existing
`1fr 86px` grid then places `Name` and `Number` together on the following row.
The rule does not affect the global side selector or custom-text editor.

### Artwork drag lifecycle

Each artwork `pointermove` previously called the persisted decoration callback.
That caused state merging, quote work, history work, React updates, renderer
updates, and decal geometry rebuilding for every raw pointer event.

Artwork dragging now has two phases:

- pointer movement stores only the latest primitive coordinates and schedules
  at most one animation frame;
- the frame updates the selected scene decal directly as a transient preview,
  without persisting or quoting;
- pointer release synchronously flushes the latest position and persists one
  final decoration;
- pointer cancellation restores the original persisted surface with no commit;
- missing surfaces and disposal safely cancel pending preview work.

The change preserves the existing texture object and resolution, material,
decal geometry path, rotation, scale, source, kind, grab offset, camera-visible
selection, and exterior-facing triangle policy.

`GarmentRenderer.handlePointerCancel` now calls
`DecorationEditor.handlePointerCancel`, while retaining print-preview rollback,
pending gesture cleanup, and orbit-control reconciliation.

## Files changed

- `src/features/configurator/scene/personalizationToolbarLayout.js`
- `src/features/configurator/scene/PersonalizationToolbarOverlay.jsx`
- `src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx`
- `src/features/configurator/ui/configurator.css`
- `src/features/configurator/ui/configuratorLayout.test.js`
- `src/features/configurator/scene/decorationEditor.js`
- `src/features/configurator/scene/decorationEditor.test.js`
- `src/features/configurator/scene/garmentRenderer.js`
- `src/features/configurator/scene/garmentRenderer.test.js`

Planning records:

- `docs/superpowers/specs/2026-07-30-toolbar-layout-artwork-drag-performance-design.md`
- `docs/superpowers/plans/2026-07-30-toolbar-layout-artwork-drag-performance.md`

## Verification

### Focused automated acceptance

Command:

```powershell
npx vitest run src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx src/features/configurator/ui/configuratorLayout.test.js src/features/configurator/ui/PersonalizePanel.test.jsx src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/decorationEditorGarmentModels.test.js src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/scene/ProductStage.test.jsx --reporter=dot
```

Result: 7 files passed, 217 tests passed, exit code 0.

### Full suite

Command:

```powershell
npx vitest run --exclude=".worktrees/**" --reporter=dot
```

Result: 61 files passed, 746 tests passed, exit code 0.

Existing non-failing test output remains:

- React `act(...)` warnings in pre-existing mutation tests;
- expected failure-injection service error messages;
- jsdom `Not implemented: navigation to another Document`.

### Build

Command:

```powershell
npm run build
```

Result: exit code 0.

- app bundle built successfully;
- Shopify bundle built successfully;
- existing non-blocking notices remain for the large application chunk and
  Shopify `inlineDynamicImports`.

### Cloudflare deployment dry run

Command:

```powershell
npx wrangler deploy --dry-run
```

Result: exit code 0. Wrangler read 14 files from this worktree's `dist`,
resolved the intended Worker bindings, and exited at the dry-run boundary.
The proxy-environment warning is non-blocking.

### Browser acceptance

Local branch URL: `http://127.0.0.1:52241/`

Desktop acceptance:

- Chelsea model front, back, and angled views;
- edit, duplicate, delete, and `DRAG` visible and separated;
- measured desktop dock/rotate gap: 8 px or greater;
- `data-layout-collision-free="true"` on the tested layouts;
- `Side` occupied one full row;
- `Name` and `Number` shared the next row;
- preset Crest artwork rapidly dragged on Chelsea front and back;
- release retained the final position;
- no browser console warning or error entries.

Mobile acceptance:

- viewport override: 390 x 844;
- stage width: 341 px;
- edit, duplicate, delete, and `DRAG` remained inside the stage and separated;
- measured mobile dock/rotate gap: 10 px;
- `data-layout-collision-free="true"`;
- `Side` occupied one full row;
- `Name` and `Number` shared the next row.

The standalone product UI currently loads `chelsea-jersey.glb` and does not
offer a customer model switch. Browser acceptance therefore does not claim a
manual FN8788 run. FN8788 front/back exterior decal geometry remains covered by
`decorationEditorGarmentModels.test.js`, which loads the real
`fn8788-jersey.glb`.

Pointer cancellation is covered deterministically at editor and renderer
integration levels because the browser control surface does not expose a direct
pointer-cancel gesture.

## Commits

Feature code checkpoint:

```text
2f3a319 fix: cancel transient artwork dragging
dd7e320 perf: coalesce artwork drag previews
b7b14e5 fix: align player personalization fields
243ec7c fix: recover from constrained control layouts
248da12 fix: handle constrained personalization controls
bf0a5f6 fix: keep personalization controls visible
```

Design and plan:

```text
92d6437 docs: plan toolbar and artwork drag fixes
6d227ee docs: design toolbar and artwork drag fixes
```

## Release checkpoint

- Source branch: `codex/toolbar-layout-artwork-drag-performance`
- Feature code commit: `2f3a31981f70bb796929cbb0d0682a3a5a081828`
- `showcase` merge commit: `8cb12bad060a6cad6597e3bdbbe36fbe51b66d41`
- Rollback/source checkpoint: `289caae`
- Production Worker version before this batch:
  `3657240c-45e9-4864-8d18-a5f9b0c2a394`
- Manual Cloudflare upload version:
  `79120885-c22b-4e1e-a7bb-9ecad22c6833`
- Production URL:
  `https://jersey-3d-configurator.jason1064969838.workers.dev/`

The feature was merged into `showcase`, pushed to `origin/showcase`, and
deployed to Cloudflare after explicit user confirmation. The live Shopify theme
was not modified or synchronized in this release.

Post-release verification:

- `showcase` was merged at
  `8cb12bad060a6cad6597e3bdbbe36fbe51b66d41`;
- pushing `showcase` triggers the repository's automated Cloudflare
  deployment, so the active version ID can advance after documentation-only
  commits and must be read with `wrangler deployments status`;
- the production root returned HTTP 200;
- production HTML referenced `index-DWgFfN6G.css` and
  `index-CPzcALwL.js`;
- production JS and CSS SHA-256 values matched the local build;
- the production browser loaded the configurator DOM and
  `Chelsea Match Jersey` heading.

## Known non-blocking limits

- The overlay's first-ever 0 x 0 measurement still uses the provisional layout
  until a real stage measurement arrives. Normal measured invalid states are
  explicit and recoverable.
- A last valid overlay layout may be shown briefly during a transient impossible
  resize and is marked non-collision-free until a valid layout returns.
- The current browser acceptance covers the standalone Chelsea model; FN8788
  remains covered by the real-model automated geometry suite.
