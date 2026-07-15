# Arsenal Model and Artwork Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the display jersey with the supplied Arsenal GLB and make same-region artwork additions land on distinct visible cloth positions.

**Architecture:** Keep all GLB meshes visible, but give `GarmentRenderer` a separate cloth-only mesh list for decals and print raycasts. `DecorationEditor` selects the first unoccupied raycast candidate from a deterministic region layout, so saved positions remain stable and user-dragged positions are never overwritten.

**Tech Stack:** React 19, Three.js 0.185, GLTFLoader, DecalGeometry, Vitest, Vite.

---

### Task 1: Asset configuration and cloth target selection

**Files:**

- Create: `public/models/arsenal-jersey.glb`
- Modify: `src/features/configurator/config/productDefinitions.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: Write the failing target-selection tests**

Add a test for `selectDecorationMeshes` that supplies meshes named `Cloth_mesh` and `Topstitch_1`, then expects only `Cloth_mesh`. Add a fallback test that expects all meshes when none match `cloth|fabric|body`.

- [ ] **Step 2: Run the target test and verify red**

Run: `npm test -- src/features/configurator/scene/garmentRenderer.test.js`  
Expected: FAIL because `selectDecorationMeshes` is not exported.

- [ ] **Step 3: Implement model asset and target selection**

Copy the supplied binary to `public/models/arsenal-jersey.glb`. Set the product name to `Arsenal Match Jersey`, retain `id: 'fn8788-jersey'`, and point `model.glbUrl` to `/models/arsenal-jersey.glb`. Export `selectDecorationMeshes`, selecting name matches before fallback, and pass that list into `DecorationEditor` and print picking.

- [ ] **Step 4: Verify green and commit**

Run `npm test -- src/features/configurator/scene/garmentRenderer.test.js` and `npm run build:showcase`. Commit `feat: add Arsenal jersey model` and push.

### Task 2: Non-overlapping default artwork placement

**Files:**

- Modify: `src/features/configurator/scene/decorationEditor.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`

- [ ] **Step 1: Write failing position-distribution tests**

Create a box-mesh test with one occupied front placement. Call `getDefaultDecorationPlacement([mesh], 'front', [occupied])` and assert it returns a non-null position different from the occupied one. Add a test that a fully occupied candidate list still returns the centre fallback instead of null.

- [ ] **Step 2: Run the target test and verify red**

Run: `npm test -- src/features/configurator/scene/decorationEditor.test.js`  
Expected: FAIL because the placement helper does not accept occupied placements and always returns the centre point.

- [ ] **Step 3: Implement deterministic candidate raycasts**

Add region-local candidate offsets and use the first raycast hit farther than the minimum same-region distance from existing placements. Pass existing decoration placements into migration/default creation; preserve explicit user placements and only distribute new or legacy-missing positions.

- [ ] **Step 4: Verify green and commit**

Run `npm test -- src/features/configurator/scene/decorationEditor.test.js` and `npm run build:showcase`. Commit `fix: distribute default artwork placements` and push.

### Task 3: Regression verification and documentation

**Files:**

- Create: `project-logs/changes/2026-07-15-arsenal-model-and-artwork-defaults.md`
- Create: `project-logs/bugs/2026-07-15-overlapping-artwork-defaults.md`

- [ ] **Step 1: Record the model and overlap defect**

Document the supplied asset hash and size, the prior same-coordinate failure, the cloth-only selection rule, the verification commands, the 13 MB initial-load risk, and the `showcase` rollback point.

- [ ] **Step 2: Run complete verification**

Run `npm test`, `npm run build:showcase`, and `git diff --check`. Expected: all suites pass, Vite exits 0, and no whitespace errors are reported.

- [ ] **Step 3: Commit and push**

Stage the two logs and both documents, commit `docs: record Arsenal artwork delivery`, and push `codex/arsenal-model-artwork-defaults`. Only merge into `showcase` after the user explicitly approves publication.
