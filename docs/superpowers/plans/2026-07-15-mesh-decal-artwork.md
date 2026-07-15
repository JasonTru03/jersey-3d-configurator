# Mesh-projected Artwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed-coordinate artwork planes with decals projected onto the loaded garment mesh, while preserving saved designs and clear slot-limit feedback.

**Architecture:** `GarmentRenderer` owns the loaded mesh list and passes it into `DecorationEditor`. The editor derives default and drag positions with mesh raycasts, stores a serializable `placement`, and rebuilds `DecalGeometry` for each artwork. The React panel stays responsible for user feedback and state changes, not 3D placement calculations.

**Tech Stack:** React 19, Three.js 0.185 (`Raycaster`, `DecalGeometry`), Vitest, Vite.

---

### Task 1: Mesh-placement primitives and decal rendering

**Files:**
- Modify: `src/features/configurator/scene/decorationEditor.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js`

- [ ] **Step 1: Write the failing mesh-placement tests**

Add tests that build a `THREE.BoxGeometry` mesh, call `getDefaultDecorationPlacement(meshes, 'front')`, and assert the returned position lies on the mesh with a positive-Z normal. Add a test that `createDecalSurface(texture, mesh, placement, transform)` returns a `THREE.Mesh` whose material has `depthTest === true`, `depthWrite === false`, and `polygonOffset === true`.

- [ ] **Step 2: Run the targeted tests and verify red**

Run: `npm test -- src/features/configurator/scene/decorationEditor.test.js`  
Expected: FAIL because `getDefaultDecorationPlacement` and `createDecalSurface` are not exported.

- [ ] **Step 3: Implement the smallest mesh-projection API**

In `decorationEditor.js`, replace fixed `REGION_FRAMES` surface generation with:

```js
export function getDefaultDecorationPlacement(meshes, region) {
  const direction = REGION_DIRECTIONS[region] ?? REGION_DIRECTIONS.front;
  const box = new THREE.Box3();
  meshes.forEach((mesh) => box.expandByObject(mesh));
  const center = box.getCenter(new THREE.Vector3());
  const distance = box.getSize(new THREE.Vector3()).length() || 1;
  const raycaster = new THREE.Raycaster(center.clone().addScaledVector(direction, distance * 2), direction.clone().negate());
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? placementFromIntersection(hit, region) : null;
}
```

Create decals using `DecalGeometry` with a material configured for transparent depth-tested polygon-offset rendering. `GarmentRenderer` must call `decorationEditor.setGarmentMeshes(this.modelMeshes)` after fitting the GLB and before its next decoration update.

- [ ] **Step 4: Run the targeted tests and verify green**

Run: `npm test -- src/features/configurator/scene/decorationEditor.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit and push the first checkpoint**

Run:

```powershell
git add src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.js
git commit -m "feat: project artwork onto garment meshes"
git push origin codex/interactive-jersey-editor
```

### Task 2: Persisted placement, dragging, and old-design migration

**Files:**
- Modify: `src/features/configurator/config/decorations.js`
- Modify: `src/features/configurator/config/decorations.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.js`

- [ ] **Step 1: Write failing persistence and drag tests**

Add a test that `createDecoration(...)` has `placement: null`; a test that `patchDecoration(decoration, { placement })` preserves all three position and normal components; and a test that calling the editor's mesh-hit conversion with no hit returns the existing placement unchanged.

- [ ] **Step 2: Run targeted tests and verify red**

Run: `npm test -- src/features/configurator/config/decorations.test.js src/features/configurator/scene/decorationEditor.test.js`  
Expected: FAIL because `placement` is neither initialized nor preserved.

- [ ] **Step 3: Implement placement persistence and interaction**

Add `placement: null` in `createDecoration`. In `patchDecoration`, preserve a supplied `placement` unchanged and set it to `null` when the patch changes `region`. In `DecorationEditor.update`, replace a missing or stale-region placement with `getDefaultDecorationPlacement(this.garmentMeshes, decoration.region)` and emit the normalized decoration once. During drag, raycast `garmentMeshes`; only emit a patch when it hits and persist `{ region, position, normal }` rounded to four decimals.

- [ ] **Step 4: Run targeted tests and verify green**

Run: `npm test -- src/features/configurator/config/decorations.test.js src/features/configurator/scene/decorationEditor.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit and push the second checkpoint**

Run:

```powershell
git add src/features/configurator/config/decorations.js src/features/configurator/config/decorations.test.js src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js
git commit -m "feat: persist mesh artwork placements"
git push origin codex/interactive-jersey-editor
```

### Task 3: Slot-limit feedback and complete verification

**Files:**
- Modify: `src/features/configurator/ui/DecorationPanel.jsx`
- Modify: `src/features/configurator/ui/DecorationPanel.test.jsx`
- Create: `project-logs/changes/2026-07-15-mesh-decal-artwork.md`
- Modify: `project-logs/bugs/2026-07-14-decoration-surface-placement.md`

- [ ] **Step 1: Write the failing panel tests**

Render the panel with eight decorations and assert that `8 / 8 artwork slots used` is visible. Click a preset and assert `You can add up to 8 artworks. Remove one to continue.` appears while `updateState` has not been called with a ninth item.

- [ ] **Step 2: Run the panel test and verify red**

Run: `npm test -- src/features/configurator/ui/DecorationPanel.test.jsx`  
Expected: FAIL because the current buttons are disabled and no slot count or limit message is rendered.

- [ ] **Step 3: Implement visible limit behavior and document the result**

Keep the preset and upload trigger clickable. Make `addPreset` set the limit message before returning when full; make the upload trigger set the same message without opening the file picker when full; render `N / 8 artwork slots used`. Add the change log and mark the bug log fixed pending public visual acceptance.

- [ ] **Step 4: Run full automated verification**

Run:

```powershell
npm test
npm run build:showcase
git diff --check
```

Expected: all Vitest suites pass, production Vite build succeeds, and no whitespace errors are reported.

- [ ] **Step 5: Commit and push the final implementation checkpoint**

Run:

```powershell
git add src/features/configurator/ui/DecorationPanel.jsx src/features/configurator/ui/DecorationPanel.test.jsx project-logs/changes/2026-07-15-mesh-decal-artwork.md project-logs/bugs/2026-07-14-decoration-surface-placement.md docs/superpowers/plans/2026-07-15-mesh-decal-artwork.md
git commit -m "fix: make artwork placement reliable"
git push origin codex/interactive-jersey-editor
```

Public deployment remains a separate user-approved merge from `codex/interactive-jersey-editor` into `showcase` after browser acceptance.
