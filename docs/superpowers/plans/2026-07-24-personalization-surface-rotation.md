# Personalization Surface and Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make personalization text follow the jersey surface, add direct list deletion, and replace click rotation with a stable continuous drag gesture.

**Architecture:** Keep the existing saved personalization schema and transparent plane as the interaction proxy. Add a visible `DecalGeometry` surface projected onto the garment, isolate angle unwrapping and snapping in pure helpers, and share one normalized removal patch between the 3D toolbar and Personalize list.

**Tech Stack:** React 19, Three.js, `DecalGeometry`, Lucide React, Vitest, Testing Library, Vite, Cloudflare Workers.

---

## File structure

- Create `src/features/configurator/scene/personalizationRotation.js` for pure pointer-angle, incremental unwrap, and soft-snap logic.
- Create `src/features/configurator/scene/personalizationRotation.test.js` for clockwise/counter-clockwise wrap and snap tests.
- Create `src/features/configurator/scene/personalizationDecal.js` for garment hit resolution and decal geometry creation.
- Create `src/features/configurator/scene/personalizationDecal.test.js` for surface-point, aspect, scale, rotation, and invalid-placement behavior.
- Modify `src/features/configurator/scene/PersonalizationToolbarOverlay.jsx` for drag rotation and the stable control dock.
- Modify `src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx` for pointer capture, frozen coordinates, repeated turns, and keyboard rotation.
- Modify `src/features/configurator/scene/garmentRenderer.js` for decal-plus-proxy layer lifecycle.
- Modify `src/features/configurator/scene/garmentRenderer.test.js` for visible decal, fallback plane, drag lifecycle, and disposal.
- Modify `src/features/configurator/config/personalizationItems.js` for a shared normalized removal patch.
- Modify `src/features/configurator/config/personalizationItems.test.js` for player/text removal behavior.
- Modify `src/features/configurator/scene/ProductStage.jsx` and its tests to consume the shared removal patch.
- Modify `src/features/configurator/ui/PersonalizePanel.jsx` and its tests for row-level trash buttons.
- Modify `src/features/configurator/ui/configurator.css` and `configuratorLayout.test.js` for the control dock and two-part list rows.
- Update the dated change log after browser acceptance.

### Task 1: Add continuous rotation math

**Files:**
- Create: `src/features/configurator/scene/personalizationRotation.js`
- Create: `src/features/configurator/scene/personalizationRotation.test.js`

- [ ] **Step 1: Write failing angle tests**

Create:

```js
import { describe, expect, it } from 'vitest';
import {
  beginRotationGesture,
  normalizeRotation,
  updateRotationGesture,
} from './personalizationRotation.js';

describe('personalization rotation gesture', () => {
  it('continues clockwise across the atan2 wrap boundary', () => {
    const start = beginRotationGesture({
      centerX: 100,
      centerY: 100,
      clientX: 0.015,
      clientY: 98.255,
      rotation: 40,
    });
    const update = updateRotationGesture(start, {
      clientX: 0.015,
      clientY: 101.745,
    });

    expect(update.rawRotation).toBeCloseTo(42, 1);
    expect(update.rotation).toBeCloseTo(42, 1);
  });

  it('continues counter-clockwise across the opposite wrap boundary', () => {
    const start = beginRotationGesture({
      centerX: 100,
      centerY: 100,
      clientX: 0.015,
      clientY: 101.745,
      rotation: 50,
    });
    const update = updateRotationGesture(start, {
      clientX: 0.015,
      clientY: 98.255,
    });

    expect(update.rawRotation).toBeCloseTo(48, 1);
  });

  it('soft-snaps within four degrees and releases outside the threshold', () => {
    const gesture = beginRotationGesture({
      centerX: 0,
      centerY: 0,
      clientX: 100,
      clientY: 0,
      rotation: 41,
    });
    const snapped = updateRotationGesture(gesture, { clientX: 100, clientY: 1 });
    const released = updateRotationGesture(snapped, { clientX: 98, clientY: 18 });

    expect(snapped.rotation).toBe(45);
    expect(released.rotation).not.toBe(45);
  });

  it('normalizes saved rotation without losing accumulated turns', () => {
    expect(normalizeRotation(765)).toBe(45);
    expect(normalizeRotation(-45)).toBe(315);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm test -- --run src/features/configurator/scene/personalizationRotation.test.js
```

Expected: module import fails because `personalizationRotation.js` is absent.

- [ ] **Step 3: Implement the pure gesture helpers**

Create:

```js
const FULL_TURN = 360;
const HALF_TURN = 180;
const SNAP_STEP = 45;
const SNAP_THRESHOLD = 4;

export function normalizeRotation(degrees) {
  return ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

export function beginRotationGesture({
  centerX,
  centerY,
  clientX,
  clientY,
  rotation = 0,
}) {
  return {
    centerX,
    centerY,
    pointerAngle: pointerAngle(centerX, centerY, clientX, clientY),
    rawRotation: Number(rotation) || 0,
    rotation: normalizeRotation(Number(rotation) || 0),
  };
}

export function updateRotationGesture(gesture, { clientX, clientY }) {
  const nextPointerAngle = pointerAngle(
    gesture.centerX,
    gesture.centerY,
    clientX,
    clientY,
  );
  const delta = normalizeDelta(nextPointerAngle - gesture.pointerAngle);
  const rawRotation = gesture.rawRotation + delta;
  return {
    ...gesture,
    pointerAngle: nextPointerAngle,
    rawRotation,
    rotation: snapRotation(rawRotation),
  };
}

function pointerAngle(centerX, centerY, clientX, clientY) {
  return Math.atan2(clientY - centerY, clientX - centerX) * HALF_TURN / Math.PI;
}

function normalizeDelta(delta) {
  return ((delta + HALF_TURN) % FULL_TURN + FULL_TURN) % FULL_TURN - HALF_TURN;
}

function snapRotation(rawRotation) {
  const snapTarget = Math.round(rawRotation / SNAP_STEP) * SNAP_STEP;
  return normalizeRotation(
    Math.abs(rawRotation - snapTarget) <= SNAP_THRESHOLD
      ? snapTarget
      : rawRotation,
  );
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

```powershell
npm test -- --run src/features/configurator/scene/personalizationRotation.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/features/configurator/scene/personalizationRotation.js `
  src/features/configurator/scene/personalizationRotation.test.js
git commit -m "feat: add continuous personalization rotation math"
```

### Task 2: Convert the rotate control into a stable drag handle

**Files:**
- Modify: `src/features/configurator/scene/PersonalizationToolbarOverlay.jsx`
- Modify: `src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css`
- Modify: `src/features/configurator/ui/configuratorLayout.test.js`

- [ ] **Step 1: Add failing toolbar behavior tests**

Add tests that render the toolbar with:

```jsx
const anchor = { visible: true, left: 100, top: 80, width: 200, height: 70 };
const item = { key: 'text:text-1', rotation: 40, scale: 1 };
```

Verify:

```jsx
it('captures the pointer and emits continuous rotation without click stepping', () => {
  const onRotate = vi.fn();
  render(<PersonalizationToolbarOverlay anchor={anchor} item={item} onRotate={onRotate} />);
  const rotate = screen.getByRole('button', { name: 'Drag to rotate personalization' });
  rotate.setPointerCapture = vi.fn();

  fireEvent.pointerDown(rotate, { pointerId: 7, clientX: 200, clientY: 45 });
  fireEvent.pointerMove(rotate, { pointerId: 7, clientX: 230, clientY: 80 });
  fireEvent.pointerMove(rotate, { pointerId: 7, clientX: 200, clientY: 115 });
  fireEvent.pointerUp(rotate, { pointerId: 7, clientX: 200, clientY: 115 });

  expect(rotate.setPointerCapture).toHaveBeenCalledWith(7);
  expect(onRotate).toHaveBeenCalled();
});
```

Verify the frozen dock:

```jsx
it('keeps the control dock fixed while the anchor changes during rotation', () => {
  const { rerender } = render(
    <PersonalizationToolbarOverlay anchor={anchor} item={item} onRotate={vi.fn()} />,
  );
  const rotate = screen.getByRole('button', { name: 'Drag to rotate personalization' });
  fireEvent.pointerDown(rotate, { pointerId: 3, clientX: 200, clientY: 45 });
  const before = screen.getByTestId('personalization-control-dock').getAttribute('style');

  rerender(
    <PersonalizationToolbarOverlay
      anchor={{ ...anchor, left: 40, width: 320 }}
      item={{ ...item, rotation: 90 }}
      onRotate={vi.fn()}
    />,
  );

  expect(screen.getByTestId('personalization-control-dock').getAttribute('style')).toBe(before);
});
```

Also test:

- `pointercancel` and `lostpointercapture` clear the gesture;
- ArrowLeft and ArrowRight adjust rotation by 5 degrees;
- a pointer click without movement does not apply the old 45-degree step.

- [ ] **Step 2: Run toolbar tests and verify RED**

```powershell
npm test -- --run src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx
```

Expected: missing drag label, pointer handlers, and stable dock.

- [ ] **Step 3: Implement the drag handle**

In `PersonalizationToolbarOverlay.jsx`:

- import `useState` in addition to `useRef`;
- import `beginRotationGesture`, `normalizeRotation`, and `updateRotationGesture`;
- replace the rotate `onClick` with pointer handlers;
- store this ref:

```js
const rotationStart = useRef(null);
const [frozenDock, setFrozenDock] = useState(null);
```

Start:

```js
const startRotation = (event) => {
  if (!onRotate) return;
  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;
  event.preventDefault();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  rotationStart.current = {
    pointerId: event.pointerId,
    moved: false,
    gesture: beginRotationGesture({
      centerX,
      centerY,
      clientX: event.clientX,
      clientY: event.clientY,
      rotation: item.rotation ?? 0,
    }),
  };
  setFrozenDock({
    left: centerX,
    top: Math.max(18, anchor.top - 42),
  });
};
```

Move:

```js
const rotate = (event) => {
  const start = rotationStart.current;
  if (!start || start.pointerId !== event.pointerId || !onRotate) return;
  event.preventDefault();
  const gesture = updateRotationGesture(start.gesture, event);
  rotationStart.current = { ...start, moved: true, gesture };
  onRotate(itemKey, gesture.rotation);
};
```

End:

```js
const clearRotation = (event) => {
  const start = rotationStart.current;
  if (!start || start.pointerId !== event.pointerId) return;
  rotationStart.current = null;
  setFrozenDock(null);
};
```

Keyboard:

```js
const rotateWithKeyboard = (event) => {
  if (!onRotate || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const delta = event.key === 'ArrowRight' ? 5 : -5;
  onRotate(itemKey, normalizeRotation((item.rotation ?? 0) + delta));
};
```

Render a stable dock:

```jsx
<div
  className="personalization-control-dock"
  data-testid="personalization-control-dock"
  style={{
    '--dock-left': `${frozenDock?.left ?? anchor.left + anchor.width / 2}px`,
    '--dock-top': `${frozenDock?.top ?? Math.max(18, anchor.top - 42)}px`,
  }}
>
  {/* edit, rotate, duplicate, delete */}
</div>
```

Keep only resize attached to the frame corner.

- [ ] **Step 4: Update CSS**

Replace corner positioning for edit/rotate/delete/duplicate with:

```css
.personalization-control-dock {
  position: absolute;
  top: var(--dock-top);
  left: var(--dock-left);
  display: flex;
  gap: 4px;
  transform: translateX(-50%);
  pointer-events: auto;
}

.personalization-control-dock .print-control {
  position: static;
}

.print-control--rotate {
  cursor: grab;
  touch-action: none;
}

.print-control--rotate:active {
  cursor: grabbing;
}
```

Retain `.print-control--resize` at the projected frame lower-right corner.

- [ ] **Step 5: Run focused tests and verify GREEN**

```powershell
npm test -- --run `
  src/features/configurator/scene/personalizationRotation.test.js `
  src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx `
  src/features/configurator/ui/configuratorLayout.test.js
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/features/configurator/scene/PersonalizationToolbarOverlay.jsx `
  src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx `
  src/features/configurator/ui/configurator.css `
  src/features/configurator/ui/configuratorLayout.test.js
git commit -m "feat: drag to rotate personalization"
```

### Task 3: Add a shared personalization removal patch and row delete action

**Files:**
- Modify: `src/features/configurator/config/personalizationItems.js`
- Modify: `src/features/configurator/config/personalizationItems.test.js`
- Modify: `src/features/configurator/scene/ProductStage.jsx`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`
- Modify: `src/features/configurator/ui/PersonalizePanel.jsx`
- Modify: `src/features/configurator/ui/PersonalizePanel.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css`

- [ ] **Step 1: Add failing normalized removal tests**

Add:

```js
it('builds a text removal patch without changing player data', () => {
  const state = {
    lighting: 'name-number',
    overrides: {
      printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }],
      customTextItems: [
        { id: 'text-1', text: 'FIRST' },
        { id: 'text-2', text: 'SECOND' },
      ],
    },
  };

  expect(getPersonalizationRemovalPatch(state, 'text:text-1')).toEqual({
    overrides: {
      customTextItems: [expect.objectContaining({ id: 'text-2' })],
    },
  });
});
```

Add a player test expecting normalized `printItems` and `legacyFirstItemFields`, plus a missing-key test returning `null`.

- [ ] **Step 2: Verify RED**

```powershell
npm test -- --run src/features/configurator/config/personalizationItems.test.js
```

Expected: `getPersonalizationRemovalPatch` is absent.

- [ ] **Step 3: Implement the shared patch**

In `personalizationItems.js`, import:

```js
import { getCustomTextItems, removeCustomTextItem } from './customTextItems.js';
import {
  getPrintItems,
  legacyFirstItemFields,
  removePrintItem,
} from './printItems.js';
```

Add:

```js
export function getPersonalizationRemovalPatch(state, key) {
  const item = findPersonalizationItem(getSelectablePersonalizationItems(state), key);
  if (!item) return null;
  if (item.itemKind === 'text') {
    return {
      overrides: {
        customTextItems: removeCustomTextItem(
          getCustomTextItems(state.overrides),
          item.sourceId,
        ),
      },
    };
  }
  const printItems = removePrintItem(getPrintItems(state.overrides), item.sourceId);
  return {
    overrides: {
      printItems,
      ...legacyFirstItemFields(printItems),
    },
  };
}
```

- [ ] **Step 4: Use the patch in ProductStage**

Replace its duplicate text/player deletion branch with:

```js
const patch = getPersonalizationRemovalPatch(state, id);
if (!patch) return;
reportedNullSelectionRef.current = id;
setActivePrintId(null);
setSelectedPrintId(null);
setPrintAnchor({ visible: false });
onPersonalizationSelect?.(null);
onStatePatch(patch);
```

Update `ProductStage.test.jsx` to verify text and player deletion still emit the expected patch.

- [ ] **Step 5: Add row trash-button tests**

In `PersonalizePanel.test.jsx`, verify:

```jsx
it('deletes a text item from its row and clears selected state', async () => {
  const onSelect = vi.fn();
  const updateState = vi.fn(async () => ({ ok: true }));
  render(
    <PersonalizePanel
      onSelect={onSelect}
      selectedKey="text:text-1"
      state={stateWithTwoTexts}
      updateState={updateState}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Delete FIRST' }));
  await waitFor(() => expect(updateState).toHaveBeenCalledWith({
    overrides: {
      customTextItems: [expect.objectContaining({ id: 'text-2' })],
    },
  }));
  expect(onSelect).toHaveBeenCalledWith(null);
});
```

Add:

- deleting a non-selected item preserves selection;
- deleting player uses normalized print patch;
- delete click does not trigger the row selection button;
- the delete control has a 44-pixel target through the CSS test.

- [ ] **Step 6: Implement the row action**

Import `Trash2` and `getPersonalizationRemovalPatch`.

Add:

```js
const deleteItem = async (item) => {
  const patch = getPersonalizationRemovalPatch(state, item.key);
  if (!patch) return;
  const result = await updateState(patch);
  if (result?.ok === false) return;
  if (selectedKey === item.key) onSelect(null);
};
```

Render each row:

```jsx
<li key={item.key}>
  <button
    aria-pressed={item.key === selectedKey}
    className="personalize-element-select"
    onClick={() => onSelect(item.key)}
    type="button"
  >
    {personalizationLabel(item)}
  </button>
  <button
    aria-label={`Delete ${personalizationLabel(item)}`}
    className="personalize-element-delete"
    onClick={() => deleteItem(item)}
    type="button"
  >
    <Trash2 aria-hidden="true" size={17} />
  </button>
</li>
```

CSS:

```css
.personalize-elements li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  gap: 6px;
}

.personalize-element-delete {
  display: grid;
  min-width: 44px;
  min-height: 44px;
  place-items: center;
}
```

- [ ] **Step 7: Run focused tests and verify GREEN**

```powershell
npm test -- --run `
  src/features/configurator/config/personalizationItems.test.js `
  src/features/configurator/scene/ProductStage.test.jsx `
  src/features/configurator/ui/PersonalizePanel.test.jsx `
  src/features/configurator/ui/configuratorLayout.test.js
```

Expected: removal and focus tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src/features/configurator/config/personalizationItems.js `
  src/features/configurator/config/personalizationItems.test.js `
  src/features/configurator/scene/ProductStage.jsx `
  src/features/configurator/scene/ProductStage.test.jsx `
  src/features/configurator/ui/PersonalizePanel.jsx `
  src/features/configurator/ui/PersonalizePanel.test.jsx `
  src/features/configurator/ui/configurator.css
git commit -m "feat: delete personalization from the element list"
```

### Task 4: Project visible personalization onto the garment surface

**Files:**
- Create: `src/features/configurator/scene/personalizationDecal.js`
- Create: `src/features/configurator/scene/personalizationDecal.test.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: Write failing surface projection tests**

Create tests using a curved or angled garment mesh:

```js
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createPersonalizationDecalGeometry,
  resolvePersonalizationSurface,
} from './personalizationDecal.js';

describe('personalization decal', () => {
  it('raycasts an offset legacy placement back onto the garment', () => {
    const garment = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.4));
    garment.updateMatrixWorld(true);
    const hit = resolvePersonalizationSurface([garment], {
      x: 0,
      y: 0,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    });

    expect(hit.point.z).toBeCloseTo(0.2, 3);
    expect(hit.normal.z).toBeCloseTo(1, 3);
  });

  it('creates a decal with text aspect, scale, and rotation', () => {
    const garment = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.4));
    garment.updateMatrixWorld(true);
    const surface = resolvePersonalizationSurface([garment], {
      x: 0,
      y: 0,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    });
    const geometry = createPersonalizationDecalGeometry({
      height: 0.2625,
      mesh: surface.mesh,
      normal: surface.normal,
      position: surface.point,
      rotation: 45,
      scale: 1.2,
      width: 1.05,
    });

    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    geometry.dispose();
  });

  it('returns null for incomplete placement data', () => {
    expect(resolvePersonalizationSurface([], null)).toBeNull();
  });
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm test -- --run src/features/configurator/scene/personalizationDecal.test.js
```

Expected: module import fails.

- [ ] **Step 3: Implement the surface helper**

Create `personalizationDecal.js`:

```js
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

const SURFACE_RAY_OFFSET = 0.18;
const DECAL_DEPTH = 0.08;

export function resolvePersonalizationSurface(meshes, placement) {
  if (!placement || !meshes.length) return null;
  const position = new THREE.Vector3(placement.x, placement.y, placement.z);
  const normal = new THREE.Vector3(
    placement.normal?.x ?? 0,
    placement.normal?.y ?? 0,
    placement.normal?.z ?? 1,
  );
  if (!Number.isFinite(position.x + position.y + position.z) || normal.lengthSq() === 0) {
    return null;
  }
  normal.normalize();
  const raycaster = new THREE.Raycaster(
    position.clone().addScaledVector(normal, SURFACE_RAY_OFFSET),
    normal.clone().negate(),
  );
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit?.face) return null;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  return {
    mesh: hit.object,
    point: hit.point.clone(),
    normal: hit.face.normal.clone().applyMatrix3(normalMatrix).normalize(),
  };
}

export function createPersonalizationDecalGeometry({
  height,
  mesh,
  normal,
  position,
  rotation,
  scale,
  width,
}) {
  const orientation = new THREE.Quaternion()
    .setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize())
    .multiply(new THREE.Quaternion().setFromAxisAngle(
      normal.clone().normalize(),
      THREE.MathUtils.degToRad(rotation ?? 0),
    ));
  return new DecalGeometry(
    mesh,
    position,
    new THREE.Euler().setFromQuaternion(orientation),
    new THREE.Vector3(width * scale, height * scale, DECAL_DEPTH),
  );
}
```

- [ ] **Step 4: Add failing renderer lifecycle tests**

Extend `garmentRenderer.test.js` to verify:

- each rendered text layer owns `plane` and `decal`;
- `plane.material.opacity === 0` after decal creation;
- the decal geometry contains projected vertices;
- missing garment mesh keeps the textured plane visible;
- rotation/scale replaces and disposes the previous decal geometry;
- deleting the item disposes proxy geometry, decal geometry, materials, and texture;
- dragging temporarily uses the plane and final placement restores the decal.

Use spies on `dispose` to prove lifecycle behavior rather than inspecting only map size.

- [ ] **Step 5: Verify renderer tests RED**

```powershell
npm test -- --run `
  src/features/configurator/scene/personalizationDecal.test.js `
  src/features/configurator/scene/garmentRenderer.test.js
```

Expected: layer has no decal and the flat plane stays visible.

- [ ] **Step 6: Implement decal-plus-proxy layers**

In `garmentRenderer.js`:

- import the surface helper;
- create a transparent proxy material and a textured decal material;
- keep `plane.userData` identity fields unchanged;
- add `decal` to each layer;
- after `applyStoredPrintPlacement`, call `syncPersonalizationDecal(layer, item)`;
- resolve the surface from `this.decorationMeshes` and item placement;
- replace only `layer.decal.geometry` when possible;
- use these material settings:

```js
const decalMaterial = new THREE.MeshBasicMaterial({
  map: texture,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  side: THREE.DoubleSide,
});
```

Fallback:

```js
if (!surface) {
  layer.plane.material.opacity = 1;
  layer.decal.visible = false;
  return;
}
layer.plane.material.opacity = 0;
layer.decal.visible = true;
```

During drag:

- show the proxy plane with the texture;
- hide the decal;
- store the latest garment hit;
- on pointer up, rebuild the active decal from the hit before emitting the saved placement.

Dispose both geometries and both materials in `disposePrintLayerEntry`.

- [ ] **Step 7: Run renderer tests and verify GREEN**

```powershell
npm test -- --run `
  src/features/configurator/scene/personalizationDecal.test.js `
  src/features/configurator/scene/garmentRenderer.test.js `
  src/features/configurator/scene/ProductStage.test.jsx
```

Expected: all surface, interaction, and lifecycle tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src/features/configurator/scene/personalizationDecal.js `
  src/features/configurator/scene/personalizationDecal.test.js `
  src/features/configurator/scene/garmentRenderer.js `
  src/features/configurator/scene/garmentRenderer.test.js
git commit -m "fix: conform personalization text to the jersey"
```

### Task 5: Complete automated and browser acceptance

**Files:**
- Modify: `project-logs/changes/2026-07-24-navigation-personalize-cart.md`

- [ ] **Step 1: Run focused and full verification**

```powershell
npm test -- --run `
  src/features/configurator/scene/personalizationRotation.test.js `
  src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx `
  src/features/configurator/scene/personalizationDecal.test.js `
  src/features/configurator/scene/garmentRenderer.test.js `
  src/features/configurator/scene/ProductStage.test.jsx `
  src/features/configurator/config/personalizationItems.test.js `
  src/features/configurator/ui/PersonalizePanel.test.jsx `
  src/features/configurator/ui/configuratorLayout.test.js
npm test -- --run
npm run build
npx wrangler deploy --dry-run
git diff --check
```

Expected:

- all Vitest files pass;
- App and Shopify builds pass;
- Wrangler dry-run passes;
- only the existing bundle-size warnings remain;
- no whitespace errors.

- [ ] **Step 2: Start the production-shaped local Worker**

Build, then start `wrangler dev --local --port 8787` with a hidden PowerShell process. Record the PID and stop that process tree after acceptance.

- [ ] **Step 3: Verify surface conformance**

At desktop `1908 × 942`:

1. Add `YOUR TEXT`.
2. Resize it to approximately the width shown in the user screenshot.
3. Inspect front, 45-degree, side, and back camera angles.
4. Confirm the decal follows the chest and does not form a visibly floating flat card.
5. Drag to a curved side area, release, and confirm the final decal follows the new surface.

Record screenshots and geometry observations outside tracked source directories.

- [ ] **Step 4: Verify rotation UX**

1. Select the text.
2. Pointer-down on the rotate handle.
3. Complete two clockwise turns crossing 45°, 180°, and the `-180° / 180°` boundary.
4. Complete two counter-clockwise turns.
5. Confirm movement remains monotonic in both directions.
6. Confirm the rotate handle stays under the pointer during the gesture.
7. Stop near 45°, confirm soft snap, then move beyond 49° and confirm free rotation resumes.
8. Release, start another drag, and confirm it begins from the saved angle.

- [ ] **Step 5: Verify row deletion and regressions**

- Delete a non-selected text row and preserve the selected row.
- Delete the selected row and confirm list focus.
- Delete a player row.
- Verify drag, resize, duplicate, undo/redo, save/open, Review pricing, desktop fixed footer, and mobile `390 × 844`.
- Confirm Shopify cart URL/properties and price totals are unchanged.

- [ ] **Step 6: Update the change log**

Append:

- root causes;
- files and responsibilities;
- RED/GREEN commands;
- full test/build/dry-run outcomes;
- surface-view evidence;
- rotation wrap/snap evidence;
- row-delete focus evidence;
- remaining production deployment state.

Keep UTF-8 without BOM and record only factual results.

- [ ] **Step 7: Commit acceptance evidence**

```powershell
git add project-logs/changes/2026-07-24-navigation-personalize-cart.md
git commit -m "test: record personalization surface acceptance"
```

- [ ] **Step 8: Present the local result before production deployment**

Report:

- commits;
- test totals;
- browser evidence;
- screenshots;
- exact live-impact scope;
- rollback commit.

Request the production deployment confirmation at this checkpoint.
