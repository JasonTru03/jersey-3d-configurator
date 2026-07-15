# Decoration Surface Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make artwork attach to the selected jersey region with correct orientation, occlusion, drag coordinates, and design-file compatibility.

**Architecture:** `decorationEditor.js` owns the pure region-frame coordinate conversion and applies it to each mesh surface. The existing decoration state keeps its normalized `x/y/scale/rotation` fields, so design documents need no migration. The renderer continues to own render-loop and pointer delegation, but stops billboarding artwork toward the camera.

**Tech Stack:** React 19, Three.js, Vitest.

---

### Task 1: Define region frames with a failing regression test

**Files:**
- Modify: `src/features/configurator/scene/decorationEditor.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.js`

- [ ] **Step 1: Write the failing test**

```js
import { getRegionFrame, toRegionPosition, toRegionTransform } from './decorationEditor.js';

it('maps back coordinates onto the back surface and restores their local transform', () => {
  const frame = getRegionFrame('back');
  const position = toRegionPosition('back', { x: 0.5, y: -0.25 });

  expect(frame.normal.z).toBe(-1);
  expect(position.z).toBeLessThan(frame.anchor.z);
  expect(toRegionTransform('back', position)).toMatchObject({ x: 0.5, y: -0.25 });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run src/features/configurator/scene/decorationEditor.test.js`

Expected: FAIL because the three region-frame helpers are not exported.

- [ ] **Step 3: Implement the minimal coordinate helpers**

```js
const REGION_FRAMES = {
  front: { anchor: { x: 0, y: 0.42, z: 0.72 }, horizontal: { x: 1, y: 0, z: 0 }, vertical: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
  back: { anchor: { x: 0, y: 0.42, z: -0.72 }, horizontal: { x: -1, y: 0, z: 0 }, vertical: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: -1 } },
};

export function toRegionPosition(region, transform) {
  const frame = getRegionFrame(region);
  return vector(frame.anchor)
    .addScaledVector(vector(frame.horizontal), transform.x * 0.48)
    .addScaledVector(vector(frame.vertical), transform.y * 0.48)
    .addScaledVector(vector(frame.normal), 0.026);
}
```

Define matching left- and right-sleeve frames, and use dot products in `toRegionTransform` to recover normalized local `x/y` values.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npx vitest run src/features/configurator/scene/decorationEditor.test.js`

Expected: PASS.

- [ ] **Step 5: Commit and push the tested helper stage**

```bash
git add src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js
git commit -m "fix: add region-aware artwork coordinates"
git push origin codex/interactive-jersey-editor
```

### Task 2: Orient artwork to region surfaces

**Files:**
- Modify: `src/features/configurator/scene/decorationEditor.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`

- [ ] **Step 1: Write the failing test**

```js
it('creates artwork surfaces that participate in garment depth occlusion', () => {
  const surface = createRegionSurface(new THREE.Texture());

  expect(surface.material.depthTest).toBe(true);
  expect(surface.material.depthWrite).toBe(false);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run src/features/configurator/scene/decorationEditor.test.js`

Expected: FAIL because `createRegionSurface` does not exist and the current surface disables depth testing.

- [ ] **Step 3: Implement the minimal surface change**

```js
export function createRegionSurface(texture) {
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
}
```

Use `toRegionPosition`, build the mesh quaternion from the frame horizontal/vertical/normal basis, then apply the saved local Z rotation. Remove camera-quaternion copying from `updateCameraFacing`.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npx vitest run src/features/configurator/scene/decorationEditor.test.js`

Expected: PASS.

- [ ] **Step 5: Commit and push the tested render stage**

```bash
git add src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js
git commit -m "fix: orient artwork to jersey regions"
git push origin codex/interactive-jersey-editor
```

### Task 3: Use region-local coordinates while dragging

**Files:**
- Modify: `src/features/configurator/scene/decorationEditor.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`

- [ ] **Step 1: Write the failing test**

```js
it('converts a sleeve world point into its normalized local drag transform', () => {
  const position = toRegionPosition('right-sleeve', { x: -0.4, y: 0.35 });

  expect(toRegionTransform('right-sleeve', position)).toMatchObject({ x: -0.4, y: 0.35 });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run src/features/configurator/scene/decorationEditor.test.js`

Expected: FAIL until sleeve frames and inverse conversion are complete.

- [ ] **Step 3: Implement the minimal drag conversion**

```js
const transform = toRegionTransform(decoration.region, this.intersection);
this.emitPatch(decoration.id, transform);
```

Set the drag plane with the frame normal and frame anchor, then replace the existing world `x/y` subtraction in `handlePointerMove` with this conversion.

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `npx vitest run src/features/configurator/scene/decorationEditor.test.js`

Expected: PASS.

- [ ] **Step 5: Commit and push the tested interaction stage**

```bash
git add src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js
git commit -m "fix: preserve artwork placement across jersey regions"
git push origin codex/interactive-jersey-editor
```

### Task 4: Verify design recovery and record the delivery

**Files:**
- Create: `project-logs/changes/2026-07-14-decoration-surface-placement.md`
- Modify: `project-logs/bugs/2026-07-14-decoration-surface-placement.md`
- Modify: `project-logs/chat/2026-07-14-cloudflare-workers-showcase.md`

- [ ] **Step 1: Run focused and full verification**

Run:

```bash
npx vitest run src/features/configurator/scene/decorationEditor.test.js
npm test
npm run build
npm run build:showcase
```

Expected: all tests and both production builds exit with code 0.

- [ ] **Step 2: Verify saved design compatibility**

Run:

```bash
node --input-type=module -e "import fs from 'node:fs'; import { parseDesignDocument } from './src/features/configurator/designs/designDocument.js'; const document = JSON.parse(fs.readFileSync('C:/Users/Administrator/Downloads/fn8788-jersey-design.json', 'utf8')); console.log(parseDesignDocument(document, { productId: 'fn8788-jersey', defaultState: document.state }).state.overrides.decorations.length);"
```

Expected: output `8` and exit code 0.

- [ ] **Step 3: Record verified result and commit**

Document the test/build evidence, mark the P0 bug as fixed only after visual verification, and retain duplicate-add behavior as a P2 follow-up.

```bash
git add project-logs/changes/2026-07-14-decoration-surface-placement.md project-logs/bugs/2026-07-14-decoration-surface-placement.md project-logs/chat/2026-07-14-cloudflare-workers-showcase.md
git commit -m "docs: record decoration placement verification"
git push origin codex/interactive-jersey-editor
```
