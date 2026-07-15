# Name Set Object Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent Name set objects with edit, rotate, delete, duplicate, resize, and drag controls to the standalone configurator.

**Architecture:** A small `printItems` state module converts legacy single-print data to immutable objects. Three.js renders and raycasts planes; React owns the accessible overlay and sends all changes through `updateState` history.

**Tech Stack:** React, Three.js, Vitest, Testing Library, lucide-react, Vite.

---

## File structure

- Create `config/printItems.js` and `config/printItems.test.js` for migration, copy, patch, remove, scale and rotation rules.
- Modify `config/productDefinitions.js`, `designs/designDocument.js`, `scene/garmentRenderer.js`, `scene/ProductStage.jsx`, `ui/ConfiguratorPage.jsx`, their tests, and `ui/configurator.css`.
- Create `scene/PrintToolbarOverlay.jsx`, `scene/PrintToolbarOverlay.test.jsx`, and `project-logs/changes/2026-07-15-name-set-object-toolbar.md`.
- Do not modify `shopify/` files.

### Task 1: Print object model

**Files:** Create `src/features/configurator/config/printItems.js` and `.test.js`; modify `productDefinitions.js`.

- [ ] Write failing tests for legacy conversion, scale clamp, rotation normalization, unique copies and eight-item limit.

```js
expect(getPrintItems({ printName: 'PLAYER', printNumber: '16', printPlacement: { x: 0, y: .36, z: .5 } }))
  .toMatchObject([{ id: 'print-1', scale: 1, rotation: 0 }]);
expect(patchPrintItem([createPrintItem({ id: 'print-1' })], 'print-1', { scale: 5, rotation: 375 })[0])
  .toMatchObject({ scale: 1.8, rotation: 15 });
```

- [ ] Run `npm test -- src/features/configurator/config/printItems.test.js`; expect module-not-found failure.
- [ ] Implement and export `MAX_PRINT_ITEMS = 8`, `MIN_PRINT_SCALE = .55`, `MAX_PRINT_SCALE = 1.8`, `createPrintItem`, `getPrintItems`, `patchPrintItem`, `removePrintItem`, `duplicatePrintItem`, and `legacyFirstItemFields`.
- [ ] Add the current PLAYER/16 placement as `defaultState.overrides.printItems[0]`, retaining all three legacy fields.
- [ ] Run the focused test; expect PASS. Commit: `git add src/features/configurator/config/printItems.js src/features/configurator/config/printItems.test.js src/features/configurator/config/productDefinitions.js && git commit -m "feat: add print item state model"`.

### Task 2: Design-file compatibility

**Files:** Modify `src/features/configurator/designs/designDocument.js` and `.test.js`.

- [ ] Write failing tests: a version-1 document with only legacy fields loads as one `printItems` object; saved multi-item state mirrors first item to `printName`, `printNumber`, and `printPlacement`.
- [ ] Run `npm test -- src/features/configurator/designs/designDocument.test.js`; expect assertion failure.
- [ ] Import `getPrintItems` and `legacyFirstItemFields`. In `parseDesignDocument`, normalize merged overrides. In `createDesignDocument`, normalize before cloning.
- [ ] Run focused tests; expect PASS. Commit: `git add src/features/configurator/designs/designDocument.js src/features/configurator/designs/designDocument.test.js && git commit -m "feat: preserve print objects in design files"`.

### Task 3: Multiple selectable 3D planes

**Files:** Modify `src/features/configurator/scene/garmentRenderer.js` and `.test.js`.

- [ ] Write failing helper test that `getNextPrintPlacement(candidates, [{ x: 0, y: .36, z: .5 }])` picks a point at least `.24` away.
- [ ] Run `npm test -- src/features/configurator/scene/garmentRenderer.test.js`; expect missing-export failure.
- [ ] Replace one `printPlane` with `this.printLayers = new Map()`. Render one canvas texture/plane per item, apply `item.scale` and normal-axis `item.rotation`, remove stale planes, and raycast planes for selection.
- [ ] Add callbacks `onPrintSelectionChange`, `onPrintTransform`, `onPrintDuplicateRequest`, `onPrintDelete`, and `onPrintEdit`. Copy only succeeds with a valid non-overlapping surface placement.
- [ ] Run focused tests; expect PASS. Commit: `git add src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js && git commit -m "feat: render selectable print objects"`.

### Task 4: Five-control overlay

**Files:** Create `src/features/configurator/scene/PrintToolbarOverlay.jsx` and `.test.jsx`; modify `scene/ProductStage.jsx` and `ui/configurator.css`.

- [ ] Write failing test that buttons named `Edit print`, `Rotate print right`, `Delete print`, `Duplicate print`, and `Resize print` exist and rotate calls `onRotate('print-1', 15)`.
- [ ] Run `npm test -- src/features/configurator/scene/PrintToolbarOverlay.test.jsx`; expect component-not-found failure.
- [ ] Implement overlay using `Pencil`, `RotateCw`, `Trash2`, `Copy`, `Maximize2`; the resize handle uses pointer drag and emits scale, clamped by Task 1.
- [ ] In `ProductStage`, store `activePrintId`, pass renderer callbacks, show the overlay only for an existing selected object, and clear it if Print is None.
- [ ] Add red outline styling and 30px controls below 720px. Run focused test; expect PASS. Commit: `git add src/features/configurator/scene/PrintToolbarOverlay.jsx src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.jsx src/features/configurator/ui/configurator.css && git commit -m "feat: add name set object toolbar"`.

### Task 5: Page-state adapters and editing

**Files:** Modify `src/features/configurator/ui/ConfiguratorPage.jsx` and `.test.jsx`.

- [ ] Write failing tests that toolbar edit focuses the Name input, duplicate makes a different id, delete removes the active object, and Undo restores it.
- [ ] Run `npm test -- src/features/configurator/ui/ConfiguratorPage.test.jsx`; expect missing callback failure.
- [ ] Use Task 1 helpers in page callbacks. Every operation calls `updateState({ overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) } })`. Toolbar edit selects Print and focuses the name input ref. `PrintFields` edits the active object or first object.
- [ ] Run focused tests; expect PASS. Commit: `git add src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx && git commit -m "feat: connect name set toolbar actions"`.

### Task 6: Delivery and release

**Files:** Create `project-logs/changes/2026-07-15-name-set-object-toolbar.md`.

- [ ] Log five controls, eight-object maximum, legacy-file compatibility, standalone-only scope, and rollback commit.
- [ ] Run `npm test`, `npm run build:showcase`, `git diff --check`, and `git status --short`; expect tests/build pass, no whitespace output, only task files.
- [ ] Commit and push: `git add project-logs/changes/2026-07-15-name-set-object-toolbar.md && git commit -m "docs: record name set toolbar delivery" && git push origin codex/name-set-toolbar-design && git push backup codex/name-set-toolbar-design`.
- [ ] After user release authorization, merge to `showcase`, rerun tests/build there, push both remotes, and verify the Cloudflare bundle contains `Edit print`.

## Plan self-review

- Tasks 1–2 cover state and old files; Task 3 covers safe 3D placement; Task 4 covers all controls and mobile layout; Task 5 covers edits and history; Task 6 covers verification and release.
- No `TODO`, `TBD`, or unassigned error handling remains.
- All tasks consistently use `printItems`, `activePrintId`, `placement`, `scale`, and `rotation`.
