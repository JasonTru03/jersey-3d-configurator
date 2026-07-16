# Name Set Object-Anchored Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Name Set recover after deletion and keep its five-control toolbar attached to the selected 3D text object.

**Architecture:** A pure print-item helper will recreate one default text object when a printable option is reselected with an empty collection. The Three.js renderer will project the active print plane into stage-relative screen coordinates, derive a collision-safe placement, and emit only meaningfully changed anchors. React will render the existing toolbar with that anchor and hide it without a selected visible object.

**Tech Stack:** React, Three.js, Vitest, Testing Library, CSS.

---

### Task 1: Restore a default Name Set after deletion

**Files:**
- Modify: `src/features/configurator/config/printItems.js`
- Test: `src/features/configurator/config/printItems.test.js`
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`
- Test: `src/features/configurator/ui/ConfiguratorPage.test.jsx`

- [ ] **Step 1: Write the failing pure-function test**

Add this test and import `ensurePrintItems`:

```js
it('recreates a default print item when a printable option is selected after deletion', () => {
  expect(ensurePrintItems([])).toEqual([
    expect.objectContaining({ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }),
  ]);
  expect(ensurePrintItems([createPrintItem({ id: 'print-4', name: 'CUSTOM' })])).toEqual([
    expect.objectContaining({ id: 'print-4', name: 'CUSTOM' }),
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/features/configurator/config/printItems.test.js`
Expected: FAIL because `ensurePrintItems` is not exported.

- [ ] **Step 3: Add the smallest immutable recovery helper**

In `printItems.js`, add:

```js
export function ensurePrintItems(items) {
  if (items.length) return items;
  return [createPrintItem()];
}
```

This deliberately creates no object for `None`; its caller decides when a printable option was selected.

- [ ] **Step 4: Make printable option selection use the helper**

In `ConfiguratorPage.jsx`, import `ensurePrintItems`. Add `handleLightingSelect` inside `ConfiguratorPage`:

```js
const handleLightingSelect = (lighting) => {
  if (lighting === 'none') {
    updateState({ lighting });
    return;
  }
  const printItems = ensurePrintItems(getPrintItems(state.overrides));
  updateState({
    lighting,
    overrides: { printItems, ...legacyFirstItemFields(printItems) },
  });
};
```

Pass it from `ConfiguratorPage` to `ConfigPanel`, and use it for the lighting `OptionGrid` `onSelect` callback. Keep all layout, colourway, material and extra callbacks unchanged.

- [ ] **Step 5: Add the page regression test**

Add a test that selects `Name set`, deletes its only print through `Delete print`, selects `Name set` again, and asserts that `Edit print` is present again. Wait for each async UI update with `waitFor`.

- [ ] **Step 6: Run focused tests to verify they pass**

Run: `npm test -- --run src/features/configurator/config/printItems.test.js src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/scene/ProductStage.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit and push this checkpoint**

```powershell
git add src/features/configurator/config/printItems.js src/features/configurator/config/printItems.test.js src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx
git commit -m "fix: restore name set after deletion"
git push origin codex/name-set-object-anchored-toolbar
git push backup codex/name-set-object-anchored-toolbar
```

### Task 2: Project the active print into a stable toolbar anchor

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Test: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: Write failing anchor tests**

Export and test a pure `getPrintToolbarAnchor` function. Cover all four placements:

```js
it('flips a visible anchor away from the top-right edges', () => {
  expect(getPrintToolbarAnchor({ x: 320, y: 90 }, { width: 480, height: 360 })).toMatchObject({ placement: 'left-bottom', visible: true });
  expect(getPrintToolbarAnchor({ x: 180, y: 90 }, { width: 480, height: 360 })).toMatchObject({ placement: 'right-bottom', visible: true });
  expect(getPrintToolbarAnchor({ x: 320, y: 220 }, { width: 480, height: 360 })).toMatchObject({ placement: 'left-top', visible: true });
  expect(getPrintToolbarAnchor({ x: 180, y: 220 }, { width: 480, height: 360 })).toMatchObject({ placement: 'right-top', visible: true });
});
```

Also test that a projected `z` outside `[-1, 1]` yields `{ visible: false }`.

- [ ] **Step 2: Run the renderer test to verify it fails**

Run: `npm test -- --run src/features/configurator/scene/garmentRenderer.test.js`
Expected: FAIL because `getPrintToolbarAnchor` is not exported.

- [ ] **Step 3: Implement pure anchor conversion and placement selection**

Add exported constants for a stage safety inset and the approximate toolbar dimensions. Implement:

```js
export function getPrintToolbarAnchor(projected, { width, height }) {
  if (!width || !height || projected.z < -1 || projected.z > 1) return { visible: false };
  const x = clamp(Math.round((projected.x * 0.5 + 0.5) * width), TOOLBAR_SAFE_INSET, width - TOOLBAR_SAFE_INSET);
  const y = clamp(Math.round((-projected.y * 0.5 + 0.5) * height), TOOLBAR_SAFE_INSET, height - TOOLBAR_SAFE_INSET);
  const horizontal = x + TOOLBAR_WIDTH + TOOLBAR_GAP > width ? 'left' : 'right';
  const vertical = y - TOOLBAR_HEIGHT - TOOLBAR_GAP < 0 ? 'bottom' : 'top';
  return { visible: true, x, y, placement: `${horizontal}-${vertical}` };
}
```

Use a local numeric `clamp` helper that preserves safe bounds even for small stages.

- [ ] **Step 4: Emit anchors from the renderer only when changed**

Accept `onPrintAnchorChange` in the constructor. Add `this.lastPrintAnchor`, a reusable `THREE.Vector3`, and `syncPrintAnchor()` that:

1. Locates `this.printLayers.get(this.activePrintId)?.plane`.
2. Emits `{ visible: false }` if there is no active plane.
3. Calls `plane.getWorldPosition(vector).project(this.camera)` and `getPrintToolbarAnchor(vector, this.host.getBoundingClientRect())`.
4. Compares `visible`, `placement`, `x`, and `y` with `lastPrintAnchor`; calls the callback only after a changed value.

Call `syncPrintAnchor()` after `controls.update()` and before `renderer.render()` in `animate`, immediately after selection changes, and after `disposePrintLayer`.

- [ ] **Step 5: Run renderer tests to verify they pass**

Run: `npm test -- --run src/features/configurator/scene/garmentRenderer.test.js`
Expected: PASS.

- [ ] **Step 6: Commit and push this checkpoint**

```powershell
git add src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "feat: project selected print toolbar anchor"
git push origin codex/name-set-object-anchored-toolbar
git push backup codex/name-set-object-anchored-toolbar
```

### Task 3: Render the toolbar beside the selected Name Set

**Files:**
- Modify: `src/features/configurator/scene/ProductStage.jsx`
- Test: `src/features/configurator/scene/ProductStage.test.jsx`
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.jsx`
- Test: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css`

- [ ] **Step 1: Write the failing overlay anchor test**

Render the overlay with an item and anchor, then assert its DOM element has the expected placement class and CSS variables:

```jsx
render(<PrintToolbarOverlay anchor={{ visible: true, x: 180, y: 220, placement: 'right-top' }} item={{ id: 'print-1', scale: 1 }} {...callbacks} />);
expect(screen.getByRole('group', { name: 'Selected print controls' })).toHaveClass('is-right-top');
expect(screen.getByRole('group', { name: 'Selected print controls' })).toHaveStyle({ '--print-anchor-x': '180px', '--print-anchor-y': '220px' });
```

Add a second test showing it returns no group when `anchor.visible` is false.

- [ ] **Step 2: Run the overlay test to verify it fails**

Run: `npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
Expected: FAIL because the component does not accept an anchor or placement class.

- [ ] **Step 3: Add anchor-aware overlay rendering**

Extend the component signature with `anchor`. Keep the existing five buttons and handlers unchanged. Render only when both `item` and `anchor?.visible` exist:

```jsx
<div
  className={`print-toolbar-overlay is-${anchor.placement}`}
  role="group"
  aria-label="Selected print controls"
  style={{ '--print-anchor-x': `${anchor.x}px`, '--print-anchor-y': `${anchor.y}px` }}
>
```

- [ ] **Step 4: Connect `ProductStage` to the renderer anchor callback**

Create a `printAnchor` state initialized to `{ visible: false }`. Supply `onPrintAnchorChange: setPrintAnchor` when constructing `GarmentRenderer`, refresh that callback in the existing prop-update effect, and pass `anchor={printAnchor}` to `PrintToolbarOverlay`. In the delete handler, clear `activePrintId` and set `{ visible: false }` before patching state.

- [ ] **Step 5: Replace fixed toolbar CSS with four placements**

Remove `top: 42%`, `left: 50%`, and `translate(-50%, -50%)`. Base positioning on the CSS variables, and add these placement rules:

```css
.print-toolbar-overlay { left: var(--print-anchor-x); top: var(--print-anchor-y); }
.print-toolbar-overlay.is-right-top { transform: translate(10px, calc(-100% - 10px)); }
.print-toolbar-overlay.is-left-top { transform: translate(calc(-100% - 10px), calc(-100% - 10px)); }
.print-toolbar-overlay.is-right-bottom { transform: translate(10px, 10px); }
.print-toolbar-overlay.is-left-bottom { transform: translate(calc(-100% - 10px), 10px); }
```

- [ ] **Step 6: Add the stage regression test**

Mock `GarmentRenderer` so it captures `onPrintAnchorChange`. Assert that the toolbar is absent after emitting `{ visible: false }` and obtains `is-left-bottom` after emitting a visible anchor for the selected print. Retain the existing delete, rotate, duplicate, edit, and resize tests.

- [ ] **Step 7: Run focused component tests to verify they pass**

Run: `npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx`
Expected: PASS.

- [ ] **Step 8: Commit and push this checkpoint**

```powershell
git add src/features/configurator/scene/ProductStage.jsx src/features/configurator/scene/ProductStage.test.jsx src/features/configurator/scene/PrintToolbarOverlay.jsx src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/ui/configurator.css
git commit -m "feat: anchor name set toolbar to selected print"
git push origin codex/name-set-object-anchored-toolbar
git push backup codex/name-set-object-anchored-toolbar
```

### Task 4: Verify, record, and prepare the stable release

**Files:**
- Modify: `docs/superpowers/handoffs/2026-07-16-name-set-object-anchored-toolbar-handoff.md`

- [ ] **Step 1: Run all automated verification**

Run:

```powershell
npm test -- --run
npm run build:showcase
```

Expected: all Vitest tests pass and the showcase build succeeds. Record the known chunk-size warning only if it is still present.

- [ ] **Step 2: Perform browser verification**

Use the local showcase build and verify:

1. Select Name set, delete PLAYER / 16, select Name set again, and confirm a new object plus toolbar appear.
2. Drag, rotate and resize the selected object; verify the toolbar follows.
3. Rotate the model and switch all three views; verify the toolbar follows or hides when the object is not visible.
4. Place the object near top, right and top-right stage bounds; verify lower, left and lower-left flips.
5. At a mobile viewport, verify the toolbar remains inside the stage and every button stays reachable.

- [ ] **Step 3: Write the release handoff**

Document: the user-facing fixes, files changed, test/build results, manual-browser evidence, deployment procedure, and the fact that `package-lock.json` in the root worktree was intentionally untouched.

- [ ] **Step 4: Commit and push the verification record**

```powershell
git add docs/superpowers/handoffs/2026-07-16-name-set-object-anchored-toolbar-handoff.md
git commit -m "docs: hand off anchored name set toolbar"
git push origin codex/name-set-object-anchored-toolbar
git push backup codex/name-set-object-anchored-toolbar
```

- [ ] **Step 5: Release only after explicit merge confirmation**

Before merging, report the source branch, `showcase` target, verification result, expected Cloudflare deployment, and rollback commit. Merge and push `showcase` only after the user explicitly says to release; then verify the deployed Cloudflare URL.
