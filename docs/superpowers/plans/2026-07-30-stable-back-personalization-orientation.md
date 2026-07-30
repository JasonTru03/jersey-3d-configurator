# Stable Back Personalization Orientation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent player sets and custom text from visually rolling or flipping while they are dragged across curved back-facing jersey surfaces.

**Architecture:** Replace the underdetermined normal-only quaternion with one shared orientation helper that builds a right-handed surface frame from garment world-up and the hit normal, then applies the customer's stored rotation. Reuse the helper in decal projection, saved proxy restoration, and live drag placement so preview and committed rendering cannot disagree.

**Tech Stack:** JavaScript, Three.js, Vitest

---

### Task 1: Add the stable surface-frame helper

**Files:**
- Modify: `src/features/configurator/scene/personalizationDecal.test.js`
- Modify: `src/features/configurator/scene/personalizationDecal.js`

- [ ] **Step 1: Write the failing curved-back orientation test**

Add a test that calls `getPersonalizationDecalOrientation` for exact back and for back normals with small positive and negative Y components. Transform local up `(0, 1, 0)` by each quaternion and assert that it remains aligned with the positive projected garment-up vector:

```js
it('keeps local up stable across curved back-facing normals', () => {
  const garmentUp = new THREE.Vector3(0, 1, 0);
  [
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0.02, -0.9998).normalize(),
    new THREE.Vector3(0, -0.02, -0.9998).normalize(),
  ].forEach((normal) => {
    const orientation = getPersonalizationDecalOrientation(normal, 0);
    const actualUp = garmentUp.clone().applyQuaternion(orientation);
    const expectedUp = garmentUp.clone()
      .addScaledVector(normal, -garmentUp.dot(normal))
      .normalize();
    expect(actualUp.dot(expectedUp)).toBeGreaterThan(0.999999);
  });
});
```

- [ ] **Step 2: Run the test and verify the antiparallel implementation fails**

Run:

```powershell
npx vitest run src/features/configurator/scene/personalizationDecal.test.js -t "keeps local up stable across curved back-facing normals"
```

Expected: FAIL because a nearby back normal maps local up toward negative garment-up.

- [ ] **Step 3: Implement the deterministic orientation helper**

In `personalizationDecal.js`, project world-up onto the normal's tangent plane, fall back to world-forward only for a top/bottom-facing surface, build a right-handed basis, and apply the stored local-Z rotation:

```js
const GARMENT_UP = new THREE.Vector3(0, 1, 0);
const ORIENTATION_FALLBACK = new THREE.Vector3(0, 0, 1);
const MIN_TANGENT_LENGTH_SQ = 1e-8;

export function getPersonalizationDecalOrientation(normalValue, rotation = 0) {
  const normal = finiteVector(normalValue);
  const angle = Number(rotation);
  if (!normal || normal.lengthSq() === 0 || !Number.isFinite(angle)) {
    throw new TypeError('Personalization decal orientation requires a finite normal and rotation.');
  }
  normal.normalize();
  const up = GARMENT_UP.clone().addScaledVector(normal, -GARMENT_UP.dot(normal));
  if (up.lengthSq() < MIN_TANGENT_LENGTH_SQ) {
    up.copy(ORIENTATION_FALLBACK).addScaledVector(normal, -ORIENTATION_FALLBACK.dot(normal));
  }
  up.normalize();
  const right = up.clone().cross(normal).normalize();
  up.crossVectors(normal, right).normalize();
  const surfaceOrientation = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, normal),
  );
  return surfaceOrientation
    .multiply(new THREE.Quaternion().setFromAxisAngle(
      FORWARD,
      THREE.MathUtils.degToRad(angle),
    ))
    .normalize();
}
```

- [ ] **Step 4: Run the focused test and full decal tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/personalizationDecal.test.js
```

Expected: all tests in the file pass.

### Task 2: Reuse the helper in proxy restoration and live dragging

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js`

- [ ] **Step 1: Add a failing live-drag regression test**

Extend the existing rotated edge-drag test with a curved back-facing hit normal and assert that the plane's transformed local-up vector has a positive dot product with projected garment-up while the saved item rotation stays unchanged.

- [ ] **Step 2: Run the focused renderer test and verify failure**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentRenderer.test.js -t "keeps a rotated edge grab under the pointer while dragging across surfaces|keeps text upright while dragging across a curved back surface"
```

Expected: the new curved-back assertion fails under `setFromUnitVectors`.

- [ ] **Step 3: Replace duplicate quaternion construction**

Import `getPersonalizationDecalOrientation` into `garmentRenderer.js`. In `applyStoredPrintPlacement`, replace `setFromUnitVectors` plus `rotateZ` with:

```js
plane.quaternion.copy(getPersonalizationDecalOrientation(
  stored.normal ?? FORWARD_PLACEMENT_NORMAL,
  item.rotation ?? 0,
));
```

Use a module-level plain-object default normal `{ x: 0, y: 0, z: 1 }`.

In `placePrintAtIntersection`, replace the inline `setFromUnitVectors(...).multiply(...)` block with:

```js
const nextQuaternion = getPersonalizationDecalOrientation(normal, rotation);
```

Keep grab-offset positioning and stored `rotation` unchanged.

- [ ] **Step 4: Update the existing edge-grab expectation and run renderer tests**

Build the expected quaternion through `getPersonalizationDecalOrientation(normal, 45)` so the test checks the shared contract rather than the removed implementation. Run:

```powershell
npx vitest run src/features/configurator/scene/garmentRenderer.test.js
```

Expected: all renderer tests pass.

### Task 3: Verify and deliver

**Files:**
- Verify: `src/features/configurator/scene/personalizationDecal.js`
- Verify: `src/features/configurator/scene/garmentRenderer.js`

- [ ] **Step 1: Run the complete main-worktree test suite without nested worktrees**

Run:

```powershell
npx vitest run --exclude=".worktrees/**"
```

Expected: all main-worktree tests pass.

- [ ] **Step 2: Run the production build**

Run:

```powershell
npm run build
```

Expected: app and Shopify builds exit with code 0.

- [ ] **Step 3: Review the scoped diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only the planned code/tests/docs plus pre-existing user changes are present.

- [ ] **Step 4: Commit the verified bug fix**

Stage only the four code/test files and this plan, then commit:

```powershell
git add -- docs/superpowers/plans/2026-07-30-stable-back-personalization-orientation.md src/features/configurator/scene/personalizationDecal.js src/features/configurator/scene/personalizationDecal.test.js src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "fix: stabilize back personalization dragging"
```
