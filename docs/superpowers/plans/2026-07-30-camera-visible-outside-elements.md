# Camera-Visible Outside Elements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the customer configurator by hiding the advanced bottom-pattern controls, prevent front/back elements from being selected through the garment, and ensure personalization and artwork render only on the garment exterior.

**Architecture:** Add one shared Three.js ray-intersection policy that rejects back-facing hits and compares element depth with the nearest outward-facing garment surface. Reuse the existing decal-triangle facing filter for both personalization and artwork, switch element materials to `FrontSide`, and preserve the hidden bottom-pattern state/production pipeline for backward compatibility.

**Tech Stack:** React 19, Three.js 0.185, Vitest 4, Testing Library, Vite 8

---

## Scope and file map

This plan implements only Phase 1 of the approved app design. It does not add cloud storage, Shopify order webhooks, admin pages, model administration, or PDF/CDR export.

**Create:**

- `src/features/configurator/scene/surfaceVisibility.js` — shared outward-facing and garment-occlusion picking policy.
- `src/features/configurator/scene/surfaceVisibility.test.js` — deterministic unit tests for front/back and depth behavior.
- `project-logs/changes/2026-07-30-camera-visible-outside-elements.md` — scoped change and verification record.
- `docs/superpowers/handoffs/2026-07-30-camera-visible-outside-elements-handoff.md` — implementation state and next-phase boundary.

**Modify:**

- `src/features/configurator/scene/garmentRenderer.js` — use visibility-aware picking for text/number layers and garment dragging; make print materials exterior-only.
- `src/features/configurator/scene/garmentRenderer.test.js` — cover occluded print rejection, visible print acceptance, and material sides.
- `src/features/configurator/scene/decorationEditor.js` — use visibility-aware picking/default placement and filter artwork decal triangles.
- `src/features/configurator/scene/decorationEditor.test.js` — cover artwork occlusion, outward garment hits, `FrontSide`, and filtered geometry.
- `src/features/configurator/scene/decorationEditorGarmentModels.test.js` — verify exterior artwork geometry against both real GLB models, front and back.
- `src/features/configurator/scene/personalizationDecal.js` — export the already-tested triangle-facing filter for artwork reuse.
- `src/features/configurator/scene/personalizationDecal.test.js` — define the public filter contract.
- `src/features/configurator/ui/ConfiguratorPage.jsx` — remove the advanced bottom-pattern panel from the customer UI only.
- `src/features/configurator/ui/ConfiguratorPage.test.jsx` — assert the panel is hidden while preserving saved-design and production compatibility tests.

**Retain unchanged:**

- `src/features/configurator/ui/BottomPatternPanel.jsx`
- `src/features/configurator/ui/BottomPatternPanel.test.jsx`
- Bottom-pattern schema, saved-design parsing, baking, and production-bundle code.
- Garment base materials using `THREE.DoubleSide`; changing the imported garment itself is outside this fix and risks holes on real models.

## Acceptance criteria

- Looking at the front cannot select a back element hidden by the garment.
- Looking at the back cannot select a front element hidden by the garment.
- At an oblique camera angle, an element remains selectable when it is genuinely visible and not occluded by the garment.
- Dragging starts and continues only on the nearest outward-facing garment surface.
- Text, numbers, and artwork do not render on the reverse side of their generated geometry.
- Artwork decal geometry contains no triangles facing opposite its requested surface normal.
- The customer Design panel does not show “Continuous bottom pattern” or its detailed controls.
- Existing saved designs with `bottomPattern.enabled: true` still load, save, bake, and pass production references to cart.
- Both `chelsea-jersey.glb` and `fn8788-jersey.glb` pass front/back exterior regression tests.
- Main-worktree tests and both app/Shopify production builds pass.

### Task 1: Add a shared camera-visible surface policy

**Files:**

- Create: `src/features/configurator/scene/surfaceVisibility.js`
- Create: `src/features/configurator/scene/surfaceVisibility.test.js`

- [ ] **Step 1: Write failing tests for facing and occlusion**

Create `surfaceVisibility.test.js`:

```js
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  findNearestFacingIntersection,
  findVisibleElementIntersection,
  getWorldIntersectionNormal,
  isIntersectionFacingRay,
} from './surfaceVisibility.js';

function createMesh(name) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  mesh.name = name;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function createHit(object, distance, normal = new THREE.Vector3(0, 0, 1)) {
  return {
    distance,
    face: { normal },
    object,
    point: new THREE.Vector3(),
  };
}

function createRaycaster(results) {
  return {
    intersectObjects: vi.fn((objects) => results.get(objects[0]) ?? []),
    ray: { direction: new THREE.Vector3(0, 0, -1) },
  };
}

describe('surface visibility', () => {
  it('transforms an intersection normal into world space', () => {
    const mesh = createMesh('rotated');
    mesh.rotation.y = Math.PI;
    mesh.updateMatrixWorld(true);
    expect(getWorldIntersectionNormal(createHit(mesh, 1)).z).toBeCloseTo(-1);
  });

  it('rejects a surface whose outside normal points away from the camera ray', () => {
    const mesh = createMesh('element');
    const front = createHit(mesh, 1, new THREE.Vector3(0, 0, 1));
    const back = createHit(mesh, 1, new THREE.Vector3(0, 0, -1));
    const rayDirection = new THREE.Vector3(0, 0, -1);
    expect(isIntersectionFacingRay(front, rayDirection)).toBe(true);
    expect(isIntersectionFacingRay(back, rayDirection)).toBe(false);
  });

  it('returns the nearest outward-facing intersection', () => {
    const mesh = createMesh('garment');
    const back = createHit(mesh, 0.5, new THREE.Vector3(0, 0, -1));
    const front = createHit(mesh, 0.8, new THREE.Vector3(0, 0, 1));
    const raycaster = createRaycaster(new Map([[mesh, [back, front]]]));
    expect(findNearestFacingIntersection(raycaster, [mesh])).toBe(front);
  });

  it('rejects a back element hidden behind the nearest garment surface', () => {
    const element = createMesh('back element');
    const garment = createMesh('front garment');
    const elementHit = createHit(element, 2);
    const garmentHit = createHit(garment, 1);
    const raycaster = createRaycaster(new Map([
      [element, [elementHit]],
      [garment, [garmentHit]],
    ]));
    expect(findVisibleElementIntersection({
      elements: [element],
      garmentMeshes: [garment],
      raycaster,
    })).toBeNull();
  });

  it('accepts an exterior element just in front of the garment surface', () => {
    const element = createMesh('front element');
    const garment = createMesh('front garment');
    const elementHit = createHit(element, 0.99);
    const garmentHit = createHit(garment, 1);
    const raycaster = createRaycaster(new Map([
      [element, [elementHit]],
      [garment, [garmentHit]],
    ]));
    expect(findVisibleElementIntersection({
      elements: [element],
      garmentMeshes: [garment],
      raycaster,
    })).toBe(elementHit);
  });

  it('accepts a genuinely visible oblique element when no garment blocks the ray', () => {
    const element = createMesh('side element');
    const garment = createMesh('garment');
    const elementHit = createHit(element, 1);
    const raycaster = createRaycaster(new Map([
      [element, [elementHit]],
      [garment, []],
    ]));
    expect(findVisibleElementIntersection({
      elements: [element],
      garmentMeshes: [garment],
      raycaster,
    })).toBe(elementHit);
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing module failure**

Run:

```powershell
npx vitest run src/features/configurator/scene/surfaceVisibility.test.js
```

Expected: FAIL because `surfaceVisibility.js` does not exist.

- [ ] **Step 3: Implement the shared policy**

Create `surfaceVisibility.js`:

```js
import * as THREE from 'three';

export const SURFACE_FACING_THRESHOLD = 0.08;
export const ELEMENT_SURFACE_EPSILON = 0.04;

export function getWorldIntersectionNormal(hit) {
  if (!hit?.object?.matrixWorld || !hit?.face?.normal?.isVector3) return null;
  return hit.face.normal.clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
    .normalize();
}

export function isIntersectionFacingRay(
  hit,
  rayDirection,
  threshold = SURFACE_FACING_THRESHOLD,
) {
  if (!rayDirection?.isVector3 || rayDirection.lengthSq() === 0) return false;
  const normal = getWorldIntersectionNormal(hit);
  if (!normal) return false;
  return normal.dot(rayDirection.clone().normalize()) <= -threshold;
}

export function findNearestFacingIntersection(raycaster, objects, recursive = false) {
  if (!raycaster || !Array.isArray(objects) || objects.length === 0) return null;
  return raycaster.intersectObjects(objects, recursive)
    .find((hit) => isIntersectionFacingRay(hit, raycaster.ray.direction)) ?? null;
}

export function findVisibleElementIntersection({
  elements,
  garmentMeshes,
  raycaster,
  recursive = false,
  surfaceEpsilon = ELEMENT_SURFACE_EPSILON,
}) {
  if (!raycaster || !Array.isArray(elements) || elements.length === 0) return null;
  const candidates = raycaster.intersectObjects(elements, recursive)
    .filter((hit) => isIntersectionFacingRay(hit, raycaster.ray.direction));
  if (candidates.length === 0) return null;

  const garmentHit = findNearestFacingIntersection(
    raycaster,
    Array.isArray(garmentMeshes) ? garmentMeshes : [],
    recursive,
  );
  return candidates.find((candidate) => (
    !garmentHit || candidate.distance <= garmentHit.distance + surfaceEpsilon
  )) ?? null;
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/surfaceVisibility.test.js
```

Expected: all six tests pass.

- [ ] **Step 5: Commit the shared policy**

```powershell
git add -- src/features/configurator/scene/surfaceVisibility.js src/features/configurator/scene/surfaceVisibility.test.js
git commit -m "test: define camera-visible surface policy"
```

### Task 2: Prevent hidden text and numbers from being selected

**Files:**

- Modify: `src/features/configurator/scene/garmentRenderer.test.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js`

- [ ] **Step 1: Add failing renderer picking and material tests**

Add focused tests beside the existing print interaction tests. Build a front-facing print plane and garment plane on the same ray, then assert:

```js
it('does not pick a print layer hidden behind the garment', () => {
  const host = document.createElement('div');
  const renderer = new GarmentRenderer(host);
  const print = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  );
  print.position.z = -1;
  print.userData.printId = 'back-print';
  print.updateMatrixWorld(true);
  const garment = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  garment.updateMatrixWorld(true);
  renderer.camera.position.set(0, 0, 2);
  renderer.camera.lookAt(0, 0, 0);
  renderer.camera.updateMatrixWorld(true);
  renderer.printLayers.set('back-print', { plane: print });
  renderer.decorationMeshes = [garment];
  renderer.renderer.domElement.getBoundingClientRect = () => ({
    bottom: 100, height: 100, left: 0, right: 100, top: 0, width: 100,
  });

  expect(renderer.pickPrint({ clientX: 50, clientY: 50 })).toBeNull();
  renderer.dispose();
});

it('picks a print layer that is visibly outside the garment', () => {
  const host = document.createElement('div');
  const renderer = new GarmentRenderer(host);
  const print = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  );
  print.position.z = 0.02;
  print.updateMatrixWorld(true);
  const garment = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  garment.updateMatrixWorld(true);
  renderer.camera.position.set(0, 0, 2);
  renderer.camera.lookAt(0, 0, 0);
  renderer.camera.updateMatrixWorld(true);
  renderer.printLayers.set('front-print', { plane: print });
  renderer.decorationMeshes = [garment];
  renderer.renderer.domElement.getBoundingClientRect = () => ({
    bottom: 100, height: 100, left: 0, right: 100, top: 0, width: 100,
  });

  expect(renderer.pickPrint({ clientX: 50, clientY: 50 })?.object).toBe(print);
  renderer.dispose();
});
```

Extend an existing `updatePrintLayerEntry` test to assert:

```js
expect(layer.plane.material.side).toBe(THREE.FrontSide);
expect(layer.decal.material.side).toBe(THREE.FrontSide);
```

- [ ] **Step 2: Run focused renderer tests and confirm failure**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentRenderer.test.js -t "does not pick a print layer hidden behind the garment|picks a print layer that is visibly outside the garment|uses exterior-only print materials"
```

Expected: hidden back print is selected and the materials are still `DoubleSide`.

- [ ] **Step 3: Integrate the shared visibility helpers**

Import:

```js
import {
  findNearestFacingIntersection,
  findVisibleElementIntersection,
} from './surfaceVisibility.js';
```

Change both print materials in `updatePrintLayerEntry`:

```js
side: THREE.FrontSide,
```

Replace `pickJersey` and `pickPrint` with:

```js
pickJersey(event) {
  const rect = this.renderer.domElement.getBoundingClientRect();
  this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  this.raycaster.setFromCamera(this.pointer, this.camera);
  return findNearestFacingIntersection(this.raycaster, this.decorationMeshes);
}

pickPrint(event) {
  const rect = this.renderer.domElement.getBoundingClientRect();
  this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  this.raycaster.setFromCamera(this.pointer, this.camera);
  return findVisibleElementIntersection({
    elements: [...this.printLayers.values()].map((layer) => layer.plane),
    garmentMeshes: this.decorationMeshes,
    raycaster: this.raycaster,
  });
}
```

Do not change the garment material configuration in `prepareGarmentMaterial`.

- [ ] **Step 4: Run the complete renderer tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentRenderer.test.js
```

Expected: all renderer tests pass, including existing drag, rotation, and copy behavior.

- [ ] **Step 5: Commit the personalization picking fix**

```powershell
git add -- src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "fix: block hidden personalization picking"
```

### Task 3: Make artwork geometry exterior-only

**Files:**

- Modify: `src/features/configurator/scene/personalizationDecal.test.js`
- Modify: `src/features/configurator/scene/personalizationDecal.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.js`

- [ ] **Step 1: Add a failing public triangle-filter contract test**

Import `filterFacingDecalTriangles` in `personalizationDecal.test.js`. Add:

```js
it('keeps only decal triangles facing the requested exterior normal', () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 0, 1, 0, 1, 0, 0,
  ], 3));
  source.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1,
    0, 0, 0, 1, 1, 0,
  ], 2));

  const filtered = filterFacingDecalTriangles(
    source,
    new THREE.Vector3(0, 0, 1),
    1,
  );

  expect(filtered.getAttribute('position').count).toBe(3);
  expect(filtered.getAttribute('uv').count).toBe(3);
});
```

- [ ] **Step 2: Run the focused test and verify the private-export failure**

Run:

```powershell
npx vitest run src/features/configurator/scene/personalizationDecal.test.js -t "keeps only decal triangles facing the requested exterior normal"
```

Expected: FAIL because `filterFacingDecalTriangles` is not exported.

- [ ] **Step 3: Export the existing implementation without duplicating it**

Change only the declaration:

```js
export function filterFacingDecalTriangles(source, targetNormal, windingSign) {
```

Keep `FACING_NORMAL_THRESHOLD`, the iteration, UV copying, and existing personalization call unchanged.

- [ ] **Step 4: Add failing artwork exterior tests**

Import the exported filter in `decorationEditor.js` only after the tests establish the behavior. In `decorationEditor.test.js`, update the existing surface tests:

```js
expect(createRegionSurface(new THREE.Texture()).material.side).toBe(THREE.FrontSide);
```

and:

```js
const surface = createDecalSurface(texture, mesh, placement, transform);
expect(surface.material.side).toBe(THREE.FrontSide);
const positions = surface.geometry.getAttribute('position');
for (let index = 0; index + 2 < positions.count; index += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(positions, index);
  const b = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
  const c = new THREE.Vector3().fromBufferAttribute(positions, index + 2);
  const triangleNormal = b.sub(a).cross(c.sub(a)).normalize();
  expect(triangleNormal.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThanOrEqual(0.08);
}
```

Use the existing box garment, front placement, texture, and transform fixtures in that test so the assertion exercises a curved/wrapped `DecalGeometry`, not a synthetic geometry.

- [ ] **Step 5: Run artwork tests and confirm `DoubleSide`/back-triangle failures**

Run:

```powershell
npx vitest run src/features/configurator/scene/decorationEditor.test.js -t "creates"
```

Expected: material-side assertions fail; raw `DecalGeometry` includes triangles that do not meet the facing threshold.

- [ ] **Step 6: Filter artwork decal geometry and use exterior-only materials**

Add:

```js
import { filterFacingDecalTriangles } from './personalizationDecal.js';
```

Change `createRegionSurface` and `createDecalSurface` materials:

```js
side: THREE.FrontSide,
```

Replace `createDecalGeometry` with:

```js
function createDecalGeometry(mesh, placement, transform, aspect = 1) {
  const orientation = getDecalOrientation(placement, transform.rotation);
  const size = 0.6 * toSpriteTransform(transform).scale;
  const rawGeometry = new DecalGeometry(
    mesh,
    toVector(placement.position),
    new THREE.Euler().setFromQuaternion(orientation),
    new THREE.Vector3(size * aspect, size, 0.12),
  );
  const targetNormal = toVector(
    placement.normal ?? getRegionFrame(placement.region).normal,
  ).normalize();
  const geometry = filterFacingDecalTriangles(
    rawGeometry,
    targetNormal,
    Math.sign(mesh.matrixWorld.determinant()) || 1,
  );
  rawGeometry.dispose();
  return geometry;
}
```

- [ ] **Step 7: Run both decal test files**

Run:

```powershell
npx vitest run src/features/configurator/scene/personalizationDecal.test.js src/features/configurator/scene/decorationEditor.test.js
```

Expected: all tests pass and no existing personalization projection behavior regresses.

- [ ] **Step 8: Commit the exterior geometry fix**

```powershell
git add -- src/features/configurator/scene/personalizationDecal.js src/features/configurator/scene/personalizationDecal.test.js src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js
git commit -m "fix: keep artwork on garment exterior"
```

### Task 4: Apply camera-visible picking to artwork and drag targets

**Files:**

- Modify: `src/features/configurator/scene/decorationEditor.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.js`

- [ ] **Step 1: Add failing artwork visibility tests**

Create a `DecorationEditor` with a perspective camera at `(0, 0, 2)`, a garment plane at `z = 0`, and front/back artwork planes. Set their `decorationId` values and `editor.decorations`, then assert:

```js
expect(editor.pickDecoration({ clientX: 50, clientY: 50 })?.decoration.id)
  .toBe('front-artwork');
```

After removing the front artwork and leaving the back artwork at `z = -1`, assert:

```js
expect(editor.pickDecoration({ clientX: 50, clientY: 50 })).toBeNull();
```

Add a garment test with a nearer back-facing hit followed by an outward-facing hit and assert `pickGarment` chooses the outward-facing hit. Reuse the new policy’s real `Raycaster` behavior rather than stubbing `pickDecoration`.

- [ ] **Step 2: Run the focused tests and verify hidden artwork is selectable**

Run:

```powershell
npx vitest run src/features/configurator/scene/decorationEditor.test.js -t "picks only camera-visible artwork|ignores a back-facing garment drag target"
```

Expected: FAIL because `pickDecoration` raycasts only artwork and `pickGarment` accepts the first raw hit.

- [ ] **Step 3: Integrate shared picking in `DecorationEditor`**

Import:

```js
import {
  findNearestFacingIntersection,
  findVisibleElementIntersection,
} from './surfaceVisibility.js';
```

Replace:

```js
pickDecoration(event) {
  this.updatePointer(event);
  this.raycaster.setFromCamera(this.pointer, this.camera);
  const hit = findVisibleElementIntersection({
    elements: [...this.surfaces.values()],
    garmentMeshes: this.garmentMeshes,
    raycaster: this.raycaster,
  });
  if (!hit) return null;
  const decoration = this.decorations.find(
    (item) => item.id === hit.object.userData.decorationId,
  );
  return decoration ? { decoration, point: hit.point.clone() } : null;
}

pickGarment(event) {
  this.updatePointer(event);
  this.raycaster.setFromCamera(this.pointer, this.camera);
  return findNearestFacingIntersection(this.raycaster, this.garmentMeshes);
}
```

In `getDefaultDecorationPlacement`, replace the raw `[0]` selection:

```js
const raycaster = new THREE.Raycaster(origin, direction.clone().negate());
const hit = findNearestFacingIntersection(raycaster, meshes);
```

In `findGarmentMeshForPlacement`, replace the raw `[0]` selection:

```js
return findNearestFacingIntersection(raycaster, meshes)?.object ?? null;
```

- [ ] **Step 4: Run all decoration editor tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/decorationEditor.test.js
```

Expected: all tests pass, including click-vs-drag threshold, grab offset, default placement, and selection flash behavior.

- [ ] **Step 5: Commit artwork picking isolation**

```powershell
git add -- src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js
git commit -m "fix: isolate artwork selection by visibility"
```

### Task 5: Hide advanced bottom-pattern controls without removing compatibility

**Files:**

- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`

- [ ] **Step 1: Change the customer-layout test to require the panel to be absent**

Replace the existing positive assertion:

```js
expect(screen.getByRole('region', { name: 'Continuous bottom pattern' })).toBeInTheDocument();
```

with:

```js
expect(screen.queryByRole('region', { name: 'Continuous bottom pattern' }))
  .not.toBeInTheDocument();
expect(screen.queryByRole('checkbox', { name: 'Enable continuous bottom pattern' }))
  .not.toBeInTheDocument();
```

Rename the test to:

```js
it('keeps only the simple jersey appearance controls under Design', async () => {
```

- [ ] **Step 2: Add a test helper that enables the hidden state through the renderer contract**

Add near `createDeferred`:

```js
async function enableHiddenBottomPattern() {
  await waitFor(() => expect(rendererHarness.options).not.toBeNull());
  let update;
  act(() => {
    update = rendererHarness.options.onStatePatch({
      overrides: { bottomPattern: { enabled: true } },
    });
  });
  await act(async () => { await update; });
  await waitFor(() => {
    expect(rendererHarness.updateStates.at(-1).overrides.bottomPattern.enabled).toBe(true);
  });
}
```

Replace the five UI checkbox setup sequences in the patterned save/cart tests with:

```js
await enableHiddenBottomPattern();
```

Keep the `shouldPrepareBottomPatternAsset` unit test and all patterned save/cart assertions. This proves older loaded designs and internal/admin state remain production-compatible even though shoppers cannot configure the option.

- [ ] **Step 3: Run the focused UI tests and confirm the panel is still rendered**

Run:

```powershell
npx vitest run src/features/configurator/ui/ConfiguratorPage.test.jsx -t "keeps only the simple jersey appearance controls under Design|patterned"
```

Expected: the absence assertion fails before the UI change.

- [ ] **Step 4: Remove only the customer-facing panel**

Delete:

```js
import { BottomPatternPanel } from './BottomPatternPanel.jsx';
```

Delete the now-unused callback:

```js
const patchBottomPattern = (patch) => updateState({ overrides: { bottomPattern: patch } });
```

Delete only this JSX block:

```jsx
<BottomPatternPanel
  pattern={state.overrides?.bottomPattern}
  onChange={patchBottomPattern}
/>
```

Do not delete `shouldPrepareBottomPatternAsset`, saved-file handling, baking, production bundle generation, or the standalone panel component/tests.

- [ ] **Step 5: Run the complete page and panel tests**

Run:

```powershell
npx vitest run src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/ui/BottomPatternPanel.test.jsx
```

Expected: the Design panel is simplified and legacy production behavior remains covered.

- [ ] **Step 6: Commit the UI simplification**

```powershell
git add -- src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx
git commit -m "fix: hide advanced bottom pattern controls"
```

### Task 6: Validate exterior behavior against both real jersey models

**Files:**

- Modify: `src/features/configurator/scene/decorationEditorGarmentModels.test.js`

- [ ] **Step 1: Add a reusable triangle-facing assertion**

Add:

```js
function expectGeometryToFace(geometry, expectedNormalZ) {
  const positions = geometry.getAttribute('position');
  const targetNormal = new THREE.Vector3(0, 0, expectedNormalZ);
  expect(positions.count).toBeGreaterThan(0);
  for (let index = 0; index + 2 < positions.count; index += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, index);
    const b = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
    const c = new THREE.Vector3().fromBufferAttribute(positions, index + 2);
    const faceNormal = b.sub(a).cross(c.sub(a));
    if (faceNormal.lengthSq() === 0) continue;
    expect(faceNormal.normalize().dot(targetNormal)).toBeGreaterThanOrEqual(0.08);
  }
}
```

Call it in every existing `it.each` case:

```js
expect(surface.material.side).toBe(THREE.FrontSide);
expectGeometryToFace(surface.geometry, expectedNormalZ);
```

- [ ] **Step 2: Run real-model tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/decorationEditorGarmentModels.test.js
```

Expected: all eight combinations pass:

- Chelsea front badge/upload
- Chelsea back badge/upload
- FN8788 front badge/upload
- FN8788 back badge/upload

- [ ] **Step 3: Commit the real-model regression coverage**

```powershell
git add -- src/features/configurator/scene/decorationEditorGarmentModels.test.js
git commit -m "test: verify exterior artwork on jersey models"
```

### Task 7: Perform local WebGL acceptance and full verification

**Files:**

- Create: `project-logs/changes/2026-07-30-camera-visible-outside-elements.md`
- Create: `docs/superpowers/handoffs/2026-07-30-camera-visible-outside-elements-handoff.md`
- Verify all Phase 1 files listed above.

- [ ] **Step 1: Run the full main-worktree test suite**

Run:

```powershell
npx vitest run --exclude=".worktrees/**"
```

Expected: all main-worktree tests pass.

- [ ] **Step 2: Run both production builds**

Run:

```powershell
npm run build
```

Expected: Vite app build, Shopify build, and Shopify CSS export all exit with code 0.

- [ ] **Step 3: Start the local app for real WebGL inspection**

Run:

```powershell
npm run dev -- --host 127.0.0.1
```

Use the printed port in the in-app browser. Do not assume the stale `localhost:52240` tab still points to the current process.

- [ ] **Step 4: Inspect both models with this exact manual matrix**

For `chelsea-jersey.glb` and `fn8788-jersey.glb`:

1. Add one text/player element and one artwork item to the front.
2. Rotate to the back and verify clicking their projected screen positions does not select them.
3. Add one text/player element and one artwork item to the back.
4. Rotate to the front and verify clicking their projected screen positions does not select them.
5. Rotate to roughly 45° and verify each genuinely visible side element can still be selected.
6. Drag every element across curved torso areas and confirm it stays on the outer surface.
7. Orbit close to the collar/hem and confirm no artwork appears inside the garment.
8. Open Design and confirm the continuous bottom-pattern panel is absent.

Capture screenshots for any failure before changing code. If the same symptom appears twice, stop and reassess the visibility threshold/model topology instead of tuning constants blindly.

- [ ] **Step 5: Inspect runtime errors and resource cleanup**

Confirm:

- no uncaught browser console errors;
- no failed GLB/texture requests;
- no selection of an occluded front/back element;
- no visibly reversed element surfaces;
- disposing/reloading the scene produces no React unmounted-state warning.

- [ ] **Step 6: Write the change record**

Create `project-logs/changes/2026-07-30-camera-visible-outside-elements.md` with:

```md
# 2026-07-30 Camera-visible outside elements

## Goal

Hide the advanced bottom-pattern UI, block through-garment element selection, and keep generated elements on exterior-facing geometry.

## Changed

- Added shared outward-facing and garment-occlusion ray picking.
- Applied the policy to text, number, artwork, and garment drag targets.
- Reused the personalization triangle filter for artwork decals.
- Switched generated element materials to `THREE.FrontSide`.
- Hid the bottom-pattern panel while retaining saved-design and production compatibility.

## Verification

- `npx vitest run --exclude=".worktrees/**"`: PASS
- `npm run build`: PASS
- Chelsea real-model front/back/45° manual matrix: PASS
- FN8788 real-model front/back/45° manual matrix: PASS

## Boundaries

- Garment base materials remain `THREE.DoubleSide`.
- Factory PDF/CDR, R2/D1, Shopify paid-order processing, and model administration remain later phases.
- Production deployment requires explicit user confirmation.
```

Replace `PASS` with the real results only after those checks succeed. Do not conceal failures.

- [ ] **Step 7: Write the handoff**

Create `docs/superpowers/handoffs/2026-07-30-camera-visible-outside-elements-handoff.md` recording:

- branch and final commit;
- exact modified/created files;
- automated and browser verification results;
- any model-specific visual caveats;
- the fact that Phase 2 begins with UV reference PDF/JSON/ZIP, not 1:1 factory output;
- production deployment status and URL/version only if separately approved and completed.

- [ ] **Step 8: Review the scoped diff**

Run:

```powershell
git diff --check
git status --short
git log --oneline -8
```

Expected: no whitespace errors. Stage only Phase 1 files; leave pre-existing user changes in the handoff, lockfile, `.superpowers/`, and unrelated logs untouched.

- [ ] **Step 9: Commit verification documents**

```powershell
git add -- project-logs/changes/2026-07-30-camera-visible-outside-elements.md docs/superpowers/handoffs/2026-07-30-camera-visible-outside-elements-handoff.md
git commit -m "docs: record visible element verification"
```

- [ ] **Step 10: Stop at the production deployment gate**

Report the local verification result and ask for explicit production deployment confirmation. Do not run a remote deploy command, update a Shopify live theme, or change the public URL as part of this plan without that confirmation.
