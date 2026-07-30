# Stable Back Artwork Orientation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent preset and uploaded artwork from visually rotating while it is dragged across curved back-facing jersey surfaces.

**Architecture:** Replace Artwork's underdetermined normal-only quaternion with the deterministic garment-up surface frame already used by personalization decals. Use the shared helper for both decal projection and drag grab-offset transforms so preview and committed placement agree.

**Tech Stack:** JavaScript, Three.js, Vitest

---

### Task 1: Add the Artwork back-orientation regression

**Files:**
- Modify: `src/features/configurator/scene/decorationEditor.test.js`

- [ ] **Step 1: Write the failing curved-back test**

Add a test that derives a local grab offset from projected garment-up on exact and nearby back normals:

```js
it('keeps artwork local up aligned with garment up across curved back-facing normals', () => {
  const garmentUp = new THREE.Vector3(0, 1, 0);
  [
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0.02, -0.9998).normalize(),
    new THREE.Vector3(0, -0.02, -0.9998).normalize(),
  ].forEach((normal) => {
    const position = new THREE.Vector3(0, 0, -1);
    const projectedUp = garmentUp.clone()
      .addScaledVector(normal, -garmentUp.dot(normal))
      .normalize();
    const offset = getDecorationGrabOffset(
      position.clone().addScaledVector(projectedUp, 0.2),
      {
        region: 'back',
        position: { x: position.x, y: position.y, z: position.z },
        normal: { x: normal.x, y: normal.y, z: normal.z },
      },
    );

    expect(new THREE.Vector3(offset.x, offset.y, offset.z)
      .distanceTo(new THREE.Vector3(0, 0.2, 0))).toBeLessThan(0.000001);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx vitest run src/features/configurator/scene/decorationEditor.test.js -t "keeps artwork local up aligned with garment up across curved back-facing normals"
```

Expected: FAIL because the old antiparallel quaternion maps nearby back-facing garment-up to the wrong local direction.

### Task 2: Reuse the stable orientation helper

**Files:**
- Modify: `src/features/configurator/scene/decorationEditor.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`

- [ ] **Step 1: Replace the Artwork orientation implementation**

Import `getPersonalizationDecalOrientation` from `personalizationDecal.js` and delegate the existing private helper:

```js
import {
  filterFacingDecalTriangles,
  getPersonalizationDecalOrientation,
} from './personalizationDecal.js';

function getDecalOrientation(placement, rotation = 0) {
  return getPersonalizationDecalOrientation(
    placement?.normal ?? { x: 0, y: 0, z: 1 },
    rotation,
  );
}
```

- [ ] **Step 2: Update the existing cross-surface grab expectation**

Use `getPersonalizationDecalOrientation(nextGarmentHit.normal, rotation)` to build the expected world-space grab point instead of reproducing the removed quaternion formula.

- [ ] **Step 3: Run focused scene tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/decorationEditorGarmentModels.test.js src/features/configurator/scene/personalizationDecal.test.js --reporter=dot
```

Expected: all focused tests pass.

### Task 3: Verify and deliver

**Files:**
- Verify: `src/features/configurator/scene/decorationEditor.js`
- Verify: `src/features/configurator/scene/decorationEditor.test.js`

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
npx vitest run --exclude=".worktrees/**"
```

Expected: all tests pass.

- [ ] **Step 2: Run the production build**

Run:

```powershell
npm run build
```

Expected: application and Shopify builds exit with code 0.

- [ ] **Step 3: Review the scoped diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only the planned code, tests, and documents are changed.

- [ ] **Step 4: Commit the verified fix**

Stage only the two code/test files and the two planning documents:

```powershell
git add -- docs/superpowers/specs/2026-07-30-stable-back-artwork-orientation-design.md docs/superpowers/plans/2026-07-30-stable-back-artwork-orientation.md src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js
git commit -m "fix: stabilize back artwork dragging"
```
