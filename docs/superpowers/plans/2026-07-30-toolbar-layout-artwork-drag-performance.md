# Toolbar Layout and Artwork Drag Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep personalization controls collision-free, arrange the player fields
as `Side` then `Name + Number`, and make artwork dragging preview smoothly while
persisting only once on release.

**Architecture:** Keep the existing overlay, player editor, and decal renderer
boundaries. Add one joint dock/rotate layout result, one scoped CSS grid rule, and
a transient animation-frame preview inside `DecorationEditor`; the existing
configuration update path remains the single source of truth for the final
artwork placement.

**Tech Stack:** React 19, Three.js 0.185, Vitest 4, Testing Library, CSS Grid,
Vite 8.

---

## File map

- `src/features/configurator/scene/personalizationToolbarLayout.js`: calculate
  the dock rectangle and a collision-free rotate-handle position.
- `src/features/configurator/scene/PersonalizationToolbarOverlay.jsx`: consume
  the joint controls layout and draw the connector to its resolved handle.
- `src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx`:
  reproduce the narrow-frame overlap and stage-edge cases.
- `src/features/configurator/ui/configurator.css`: make the player side selector
  span the two-column player grid.
- `src/features/configurator/ui/configuratorLayout.test.js`: enforce the intended
  player editor grid contract.
- `src/features/configurator/scene/decorationEditor.js`: coalesce transient
  artwork previews and commit one final decoration on release.
- `src/features/configurator/scene/decorationEditor.test.js`: verify preview,
  commit, cancel, and frame-coalescing behavior.
- `src/features/configurator/scene/garmentRenderer.js`: route pointer cancellation
  to the editor's non-committing cancellation path.
- `src/features/configurator/scene/garmentRenderer.test.js`: protect the renderer
  pointer-cancel integration.
- `project-logs/changes/2026-07-30-toolbar-layout-artwork-drag-performance.md`:
  record the delivered behavior, verification evidence, and release checkpoint.

### Task 1: Make the personalization controls collision-aware

**Files:**
- Modify: `src/features/configurator/scene/personalizationToolbarLayout.js:1-123`
- Modify: `src/features/configurator/scene/PersonalizationToolbarOverlay.jsx:45-145`
- Modify: `src/features/configurator/scene/PersonalizationToolbarOverlay.jsx:330-386`
- Test: `src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx:35-225`

- [ ] **Step 1: Add a failing narrow-selection collision test**

Add a rotate rectangle helper beside `getDockButtonRects()`:

```jsx
function getRotateRect(rotateControl) {
  const left = Number.parseFloat(
    rotateControl.style.getPropertyValue('--print-rotate-position-left'),
  );
  const top = Number.parseFloat(
    rotateControl.style.getPropertyValue('--print-rotate-position-top'),
  );
  return makeRect({ left: left - 22, top, width: 44, height: 44 });
}
```

Add this test to `PersonalizationToolbarOverlay.test.jsx`:

```jsx
it('keeps the rotate handle clear of the delete button on a narrow selection', async () => {
  const view = renderToolbarInStage({
    stageWidth: 640,
    stageHeight: 400,
    toolbarRect: null,
    anchor: { visible: true, left: 102, top: 114, width: 128, height: 84 },
  });

  try {
    const dock = screen.getByTestId('print-control-dock');
    const rotate = screen.getByTestId('print-rotate-control');
    await waitFor(() => {
      const buttonRects = getDockButtonRects(dock);
      const rotateRect = getRotateRect(rotate);
      expect(buttonRects.every((buttonRect) => !intersects(buttonRect, rotateRect))).toBe(true);
    });
  } finally {
    view.unmount();
    view.restoreRects();
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx
```

Expected: the new test fails because the preferred rotate rectangle intersects
the third 44px dock button.

- [ ] **Step 3: Return a joint dock/rotate layout**

In `personalizationToolbarLayout.js`, add these helpers and export:

```js
function getDockRect(layout) {
  const rows = Math.ceil(CONTROL_COUNT / layout.columns);
  const width = getGridSize(layout.columns);
  const height = getGridSize(rows);
  return {
    bottom: layout.top + height,
    left: layout.left - width / 2,
    right: layout.left + width / 2,
    top: layout.top,
  };
}

function getControlRect(layout) {
  return {
    bottom: layout.top + CONTROL_SIZE,
    left: layout.left - CONTROL_SIZE / 2,
    right: layout.left + CONTROL_SIZE / 2,
    top: layout.top,
  };
}

function rectanglesHaveGap(first, second, gap = DOCK_EDGE_GAP) {
  return first.right + gap <= second.left
    || second.right + gap <= first.left
    || first.bottom + gap <= second.top
    || second.bottom + gap <= first.top;
}

export function getPersonalizationControlsLayout(candidate, anchor, stageArea) {
  const dock = getPersonalizationDockLayout(candidate, anchor, stageArea);
  const dockRect = getDockRect(dock);
  const rotateHandle = getPersonalizationRotateHandleLayout(
    anchor,
    stageArea,
    dockRect,
  );
  return { dock, rotateHandle };
}
```

Replace `getPersonalizationRotateHandleLayout` with:

```js
export function getPersonalizationRotateHandleLayout(
  anchor,
  stageArea,
  dockRect = null,
) {
  const preferred = {
    left: anchor.left + anchor.width,
    top: anchor.top - ROTATE_HANDLE_OFFSET,
  };
  const candidates = dockRect
    ? [
        preferred,
        {
          left: dockRect.right + DOCK_EDGE_GAP + CONTROL_SIZE / 2,
          top: dockRect.top,
        },
        {
          left: dockRect.left - DOCK_EDGE_GAP - CONTROL_SIZE / 2,
          top: dockRect.top,
        },
        {
          left: anchor.left + anchor.width,
          top: dockRect.bottom + DOCK_EDGE_GAP,
        },
      ]
    : [preferred];
  const resolveCandidate = (candidate) => {
    if (!stageArea) {
      return {
        left: candidate.left,
        top: Math.max(DOCK_EDGE_GAP, candidate.top),
      };
    }
    const halfSize = CONTROL_SIZE / 2;
    return {
      left: clamp(
        candidate.left,
        DOCK_EDGE_GAP + halfSize,
        Math.max(
          DOCK_EDGE_GAP + halfSize,
          stageArea.width - DOCK_EDGE_GAP - halfSize,
        ),
      ),
      top: clamp(
        candidate.top,
        DOCK_EDGE_GAP,
        Math.max(
          DOCK_EDGE_GAP,
          stageArea.height - DOCK_EDGE_GAP - CONTROL_SIZE,
        ),
      ),
    };
  };
  const resolved = candidates.map(resolveCandidate);
  const clearCandidate = resolved.find((layout) => {
    const rectangle = getControlRect(layout);
    return (!dockRect || rectanglesHaveGap(rectangle, dockRect))
      && (!stageArea?.obstacle
        || !rectanglesIntersect(rectangle, stageArea.obstacle));
  });
  return clearCandidate ?? resolved.at(-1);
}
```

Because each candidate is clamped before collision testing, a stage-edge clamp
cannot silently move the handle back over the delete button.

- [ ] **Step 4: Use the joint layout in the overlay**

Replace the two independent layout calls:

```jsx
const controlsLayout = getPersonalizationControlsLayout(
  getDockPosition(anchor),
  anchor,
  stageArea,
);
const dockLayout = controlsLayout.dock;
const rotateHandleLayout = controlsLayout.rotateHandle;
```

Keep all existing CSS variables and connector coordinates, so rendering and
gesture callbacks remain unchanged.

- [ ] **Step 5: Add edge and wrapped-dock assertions**

Extend the existing right-edge and 120px-stage tests to compute the rotate
rectangle and assert:

```jsx
expect(buttonRects.every((buttonRect) => !intersects(buttonRect, rotateRect))).toBe(true);
expect(rotateRect.left).toBeGreaterThanOrEqual(8);
expect(rotateRect.right).toBeLessThanOrEqual(stageWidth - 8);
expect(rotateRect.top).toBeGreaterThanOrEqual(8);
expect(rotateRect.bottom).toBeLessThanOrEqual(stageHeight - 8);
```

- [ ] **Step 6: Run the focused overlay tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx src/features/configurator/ui/configuratorLayout.test.js
```

Expected: all selected tests pass and every edit/duplicate/delete/rotate
rectangle stays within the stage without intersections.

- [ ] **Step 7: Commit the collision fix**

```powershell
git add src/features/configurator/scene/personalizationToolbarLayout.js src/features/configurator/scene/PersonalizationToolbarOverlay.jsx src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx
git commit -m "fix: keep personalization controls visible"
```

### Task 2: Put Side above Name and Number

**Files:**
- Modify: `src/features/configurator/ui/configurator.css:542-580`
- Modify: `src/features/configurator/ui/configurator.css:683-689`
- Test: `src/features/configurator/ui/configuratorLayout.test.js:85-125`

- [ ] **Step 1: Add a failing CSS contract test**

Add:

```js
it('puts player side on its own row before name and number', () => {
  expect(ruleBody(css, '.print-fields')).toContain('grid-template-columns: 1fr 86px');
  expect(ruleBody(
    css,
    '.personalize-editor .print-fields > .personalization-side-selector',
  )).toContain('grid-column: 1 / -1');
});
```

- [ ] **Step 2: Run the layout test and verify RED**

Run:

```powershell
npx vitest run src/features/configurator/ui/configuratorLayout.test.js
```

Expected: failure because the scoped side-selector grid rule does not exist.

- [ ] **Step 3: Add the scoped full-row rule**

Immediately after `.personalize-editor .print-fields` add:

```css
.personalize-editor .print-fields > .personalization-side-selector {
  grid-column: 1 / -1;
}
```

Do not modify the global `.personalization-side-selector` rule or the custom text
editor.

- [ ] **Step 4: Run layout and player editor tests**

Run:

```powershell
npx vitest run src/features/configurator/ui/configuratorLayout.test.js src/features/configurator/ui/PersonalizePanel.test.jsx
```

Expected: both files pass; accessible labels, values, side mutations, and
disabled states remain unchanged.

- [ ] **Step 5: Commit the player grid fix**

```powershell
git add src/features/configurator/ui/configurator.css src/features/configurator/ui/configuratorLayout.test.js
git commit -m "fix: align player personalization fields"
```

### Task 3: Preview artwork in animation frames and commit once

**Files:**
- Modify: `src/features/configurator/scene/decorationEditor.js:259-280`
- Modify: `src/features/configurator/scene/decorationEditor.js:410-485`
- Modify: `src/features/configurator/scene/decorationEditor.js:510-526`
- Test: `src/features/configurator/scene/decorationEditor.test.js:190-360`

- [ ] **Step 1: Add deterministic frame controls to the test fixture**

Create this helper in `decorationEditor.test.js`:

```js
function createFrameScheduler() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    cancelFrame: vi.fn((id) => callbacks.delete(id)),
    flushLatest() {
      const entries = [...callbacks.entries()];
      callbacks.clear();
      entries.forEach(([, callback]) => callback(0));
    },
    pendingCount() {
      return callbacks.size;
    },
    requestFrame: vi.fn((callback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    }),
  };
}
```

Add a complete real-geometry drag fixture:

```js
function createDragEditor({
  cancelFrame,
  onDecorationsChange,
  requestFrame,
}) {
  const scene = new THREE.Scene();
  const domElement = document.createElement('canvas');
  domElement.getBoundingClientRect = () => ({
    bottom: 100,
    height: 100,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
  });
  const garment = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  garment.updateMatrixWorld(true);
  const decoration = {
    id: 'crest',
    kind: 'pattern',
    label: 'Crest',
    placement: {
      normal: { x: 0, y: 0, z: 1 },
      position: { x: 0, y: 0, z: 1 },
      region: 'front',
    },
    region: 'front',
    rotation: 0,
    scale: 1,
    source: 'crest',
  };
  const editor = new DecorationEditor({
    camera: createFrontCamera(),
    cancelFrame,
    domElement,
    onDecorationsChange,
    requestFrame,
    scene,
  });
  const surface = createDecalSurface(
    new THREE.Texture(),
    garment,
    decoration.placement,
    decoration,
  );
  surface.userData.decorationId = decoration.id;
  surface.userData.garmentMesh = garment;
  surface.userData.placement = decoration.placement;
  editor.setGarmentMeshes([garment]);
  editor.surfaces.set(decoration.id, surface);
  editor.decorations = [decoration];
  editor.pickDecoration = () => ({
    decoration,
    point: new THREE.Vector3(0, 0, 1),
  });
  editor.pickGarment = ({ clientX, clientY }) => ({
    face: { normal: new THREE.Vector3(0, 0, 1) },
    object: garment,
    point: new THREE.Vector3(
      (clientX - 100) / 100,
      (clientY - 100) / 100,
      1,
    ),
  });
  cleanupAfterTest(() => {
    editor.dispose();
    garment.geometry.dispose();
    garment.material.dispose();
  });
  return editor;
}
```

`DecorationEditor` accepts the injected `requestFrame` and `cancelFrame`; normal
production construction uses safe module-level animation-frame defaults.

- [ ] **Step 2: Add failing preview/commit tests**

Add one test that sends 60 pointer moves before flushing frames:

```js
it('coalesces artwork pointer moves and persists only once on release', () => {
  const scheduler = createFrameScheduler();
  const onDecorationsChange = vi.fn();
  const editor = createDragEditor({
    ...scheduler,
    onDecorationsChange,
  });

  editor.handlePointerDown({ clientX: 100, clientY: 100 });
  for (let index = 0; index < 60; index += 1) {
    editor.handlePointerMove({
      clientX: 105 + index,
      clientY: 103 + index,
    });
  }

  expect(scheduler.pendingCount()).toBe(1);
  scheduler.flushLatest();
  expect(onDecorationsChange).not.toHaveBeenCalled();

  editor.handlePointerUp();

  expect(onDecorationsChange).toHaveBeenCalledOnce();
  expect(onDecorationsChange).toHaveBeenCalledWith([
    expect.objectContaining({
      id: 'crest',
      placement: expect.objectContaining({
        position: expect.any(Object),
      }),
    }),
  ]);
});
```

Add a cancellation test:

```js
it('restores the persisted artwork after a cancelled preview', () => {
  const scheduler = createFrameScheduler();
  const onDecorationsChange = vi.fn();
  const editor = createDragEditor({ ...scheduler, onDecorationsChange });
  const originalPlacement = editor.decorations[0].placement;

  editor.handlePointerDown({ clientX: 100, clientY: 100 });
  editor.handlePointerMove({ clientX: 140, clientY: 150 });
  scheduler.flushLatest();
  editor.handlePointerCancel();

  expect(onDecorationsChange).not.toHaveBeenCalled();
  expect(editor.surfaces.get('crest').userData.placement).toEqual(originalPlacement);
});
```

Add disposal and missing-surface coverage:

```js
it('drops pending artwork preview work when its surface disappears or the editor disposes', () => {
  const scheduler = createFrameScheduler();
  const onDecorationsChange = vi.fn();
  const editor = createDragEditor({ ...scheduler, onDecorationsChange });
  const surface = editor.surfaces.get('crest');

  editor.handlePointerDown({ clientX: 100, clientY: 100 });
  editor.handlePointerMove({ clientX: 150, clientY: 150 });
  editor.surfaces.delete('crest');

  expect(() => scheduler.flushLatest()).not.toThrow();
  expect(editor.handlePointerUp()).toBe(true);
  expect(onDecorationsChange).not.toHaveBeenCalled();
  editor.surfaces.set('crest', surface);

  editor.handlePointerDown({ clientX: 100, clientY: 100 });
  editor.handlePointerMove({ clientX: 160, clientY: 160 });
  editor.dispose();

  expect(scheduler.pendingCount()).toBe(0);
  expect(onDecorationsChange).not.toHaveBeenCalled();
});
```

`createDragEditor()` uses the existing front-facing test mesh and a real decal
surface so the assertions exercise the actual placement and geometry path.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run src/features/configurator/scene/decorationEditor.test.js
```

Expected: the coalescing test observes 60 persisted updates instead of zero, and
`handlePointerCancel` is not defined.

- [ ] **Step 4: Add transient drag state and frame injection**

Add safe module-level defaults:

```js
const requestDecorationFrame = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame.bind(globalThis)
  : (callback) => setTimeout(callback, 16);
const cancelDecorationFrame = typeof cancelAnimationFrame === 'function'
  ? cancelAnimationFrame.bind(globalThis)
  : clearTimeout;
```

Extend the constructor options and add the new properties immediately after the
existing callback assignments:

```js
constructor({
  camera,
  cancelFrame = cancelDecorationFrame,
  domElement,
  onDecorationsChange,
  onSelectionChange,
  requestFrame = requestDecorationFrame,
  scene,
}) {
  this.requestFrame = requestFrame;
  this.cancelFrame = cancelFrame;
  this.dragFrame = null;
  this.pendingDragPointer = null;
  this.previewDecoration = null;
}
```

On pointer down, store:

```js
this.pendingDrag = {
  id: decoration.id,
  x: event.clientX,
  y: event.clientY,
  grabOffset: getDecorationGrabOffset(
    picked?.point,
    decoration.placement,
    decoration.rotation,
  ),
  originalDecoration: decoration,
};
this.pendingDragPointer = null;
this.previewDecoration = null;
```

- [ ] **Step 5: Replace move-time persistence with scheduled preview**

`handlePointerMove()` keeps the threshold check, then stores only primitive
coordinates:

```js
this.pendingDragPointer = {
  clientX: event.clientX,
  clientY: event.clientY,
};
if (this.dragFrame === null) {
  this.dragFrame = this.requestFrame(() => {
    this.dragFrame = null;
    this.flushDecorationPreview();
  });
}
return true;
```

Add `flushDecorationPreview()`:

```js
flushDecorationPreview() {
  const pointer = this.pendingDragPointer;
  const drag = this.pendingDrag;
  this.pendingDragPointer = null;
  if (!pointer || !drag || !this.selectedId) return null;
  const decoration = this.decorations.find((item) => item.id === drag.id);
  const surface = this.surfaces.get(drag.id);
  if (!decoration || !surface) return null;
  const placement = getPlacementFromIntersection(
    this.pickGarment(pointer),
    decoration.region,
    null,
  );
  if (!placement) return null;
  const previewDecoration = patchDecoration(decoration, {
    placement: applyDecorationGrabOffset(
      placement,
      drag.grabOffset,
      decoration.rotation,
    ),
  });
  this.applyDecoration(
    surface,
    previewDecoration,
    previewDecoration.placement,
  );
  this.previewDecoration = previewDecoration;
  return previewDecoration;
}
```

Do not call `emitPatch()` from the preview path.

- [ ] **Step 6: Commit once on release and restore on cancel**

Add a private cleanup helper:

```js
clearDragFrame() {
  if (this.dragFrame !== null) this.cancelFrame(this.dragFrame);
  this.dragFrame = null;
}
```

Change `handlePointerUp()` to:

```js
handlePointerUp() {
  const hadPointerGesture = Boolean(this.pendingDrag);
  if (!hadPointerGesture) return false;
  this.clearDragFrame();
  this.flushDecorationPreview();
  const finalDecoration = this.previewDecoration;
  this.dragging = false;
  this.pendingDrag = null;
  this.pendingDragPointer = null;
  this.previewDecoration = null;
  if (finalDecoration) this.emitDecoration(finalDecoration);
  return true;
}
```

Add the one-shot commit helper:

```js
emitDecoration(nextDecoration) {
  const next = this.decorations.map((decoration) => (
    decoration.id === nextDecoration.id ? nextDecoration : decoration
  ));
  this.onDecorationsChange?.(next);
}
```

Add:

```js
handlePointerCancel() {
  if (!this.pendingDrag) return false;
  const original = this.pendingDrag.originalDecoration;
  const surface = original ? this.surfaces.get(original.id) : null;
  this.clearDragFrame();
  this.pendingDragPointer = null;
  this.previewDecoration = null;
  this.dragging = false;
  this.pendingDrag = null;
  if (surface && original?.placement) {
    this.applyDecoration(surface, original, original.placement);
  }
  return true;
}
```

`dispose()` must call `clearDragFrame()` before disposing surfaces. A click that
never crosses the threshold clears without committing because
`previewDecoration` remains `null`.

- [ ] **Step 7: Run decoration editor tests and verify GREEN**

Run:

```powershell
npx vitest run src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/decorationEditorGarmentModels.test.js
```

Expected: coalescing, one-commit, cancellation, real-model exterior geometry,
selection, and grab-offset tests all pass.

- [ ] **Step 8: Commit the artwork preview lifecycle**

```powershell
git add src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js
git commit -m "perf: coalesce artwork drag previews"
```

### Task 4: Route pointer cancellation without committing artwork

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.js:1167-1242`
- Test: `src/features/configurator/scene/garmentRenderer.test.js:20-80`
- Test: `src/features/configurator/scene/garmentRenderer.test.js:500-620`

- [ ] **Step 1: Add a failing renderer cancellation test**

Ensure the test renderer's editor mock includes:

```js
handlePointerCancel: vi.fn(() => true),
```

Then add:

```js
it('cancels an artwork preview without routing it through pointer-up commit', () => {
  const renderer = createPointerRenderer({ decorationHit: true });

  renderer.handlePointerDown({ clientX: 100, clientY: 100, preventDefault: vi.fn() });
  renderer.handlePointerCancel();

  expect(renderer.decorationEditor.handlePointerCancel).toHaveBeenCalledOnce();
  expect(renderer.decorationEditor.handlePointerUp).not.toHaveBeenCalled();
  expect(renderer.controls.enabled).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentRenderer.test.js
```

Expected: `handlePointerUp` is called from the current cancel path and the new
expectation fails.

- [ ] **Step 3: Route cancellation to the new editor method**

Replace:

```js
this.decorationEditor?.handlePointerUp();
```

inside `GarmentRenderer.handlePointerCancel` with:

```js
this.decorationEditor?.handlePointerCancel?.();
```

Keep print-preview restoration and orbit-control reconciliation unchanged.

- [ ] **Step 4: Run renderer and stage regression tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/scene/ProductStage.test.jsx
```

Expected: both files pass; artwork cancellation, print dragging, selection,
rotation, resize, and state callbacks remain correct.

- [ ] **Step 5: Commit renderer integration**

```powershell
git add src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "fix: cancel transient artwork dragging"
```

### Task 5: Verify the complete batch and record delivery

**Files:**
- Create: `project-logs/changes/2026-07-30-toolbar-layout-artwork-drag-performance.md`
- Verify: all task files

- [ ] **Step 1: Run focused acceptance tests**

```powershell
npx vitest run src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx src/features/configurator/ui/configuratorLayout.test.js src/features/configurator/ui/PersonalizePanel.test.jsx src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/decorationEditorGarmentModels.test.js src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/scene/ProductStage.test.jsx
```

Expected: all selected files pass.

- [ ] **Step 2: Run the full test suite**

```powershell
npx vitest run --exclude=".worktrees/**"
```

Expected: every current project test passes with zero failures.

- [ ] **Step 3: Build both deployable bundles**

```powershell
npm run build
npx wrangler deploy --dry-run
```

Expected: application and Shopify builds exit `0`; Wrangler reads the intended
`jersey-3d-configurator` Worker assets and exits after dry run. The existing
large-chunk and `inlineDynamicImports` warnings remain non-blocking.

- [ ] **Step 4: Perform browser acceptance**

Run the local Vite page and verify at desktop width and a 390px mobile viewport:

1. select a player set whose projected width reproduces the screenshot;
2. confirm edit, duplicate, delete, and `DRAG` are visible, separated, and
   clickable at front, back, 45-degree, and stage-edge positions;
3. confirm `Side` is one row and `Name + Number` is the next row;
4. drag preset and uploaded artwork rapidly across Chelsea front/back and
   FN8788 front/back;
5. confirm the artwork follows without queued catch-up, release keeps the final
   position, and pointer cancellation restores the old position;
6. confirm the browser console has no application error or warning entries.

- [ ] **Step 5: Write the change log**

Create
`project-logs/changes/2026-07-30-toolbar-layout-artwork-drag-performance.md`
with:

- root causes and final behavior for all three fixes;
- files changed;
- focused/full test counts and build results;
- browser models, views, and viewport results;
- current feature commit;
- known non-blocking build notices;
- rollback point `289caae` and Worker version
  `3657240c-45e9-4864-8d18-a5f9b0c2a394`;
- explicit statement that merge, push, and deployment have not yet occurred.

- [ ] **Step 6: Run final repository checks**

```powershell
git diff --check
git status --short
git log --oneline 289caae..HEAD
```

Expected: no whitespace errors; only the intended log is uncommitted before its
commit.

- [ ] **Step 7: Commit verification evidence**

```powershell
git add project-logs/changes/2026-07-30-toolbar-layout-artwork-drag-performance.md
git commit -m "docs: record toolbar and drag verification"
```

- [ ] **Step 8: Stop at the release gate**

Report the feature branch, commits, automated results, browser evidence, known
risks, and rollback point. Request fresh confirmation before merging into
`showcase`, pushing `origin/showcase`, or creating a new Cloudflare deployment.
