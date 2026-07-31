# Production Export Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the editor responsive while a complex production ZIP is being prepared, without changing the six-file output or relaxing UV validation.

**Architecture:** Keep production export on the existing renderer/provider path, but make UV atlas rasterization cooperative. The atlas baker will yield to the browser after bounded triangle batches; the renderer and package orchestrator remain the source of truth for snapshots, validation, and cleanup. No new dependency, Worker, cloud storage, or order behavior is added in this optimization pass.

**Tech Stack:** React 19, Three.js, Vite, Vitest, browser `requestAnimationFrame`/`setTimeout`.

---

### Task 1: Add a failing cooperative-yield contract

**Files:**
- Modify: `src/features/configurator/scene/productionAtlasBaker.test.js`
- Modify: `src/features/configurator/scene/productionAtlasBaker.js`

- [x] **Step 1: Write the failing test**

Add a test that passes a `yieldControl` spy and a layer containing 201 triangles, then asserts the baker awaits the callback at least twice while preserving the 64×64 PNG result.

- [x] **Step 2: Run the focused test**

Run:

```powershell
npx vitest run src/features/configurator/scene/productionAtlasBaker.test.js -t "yields between atlas raster batches"
```

Expected: FAIL because `bakeProductionAtlas` does not yet accept or call `yieldControl`.

- [x] **Step 3: Implement the smallest yielding change**

Add an optional `yieldControl = yieldToBrowser` argument to `bakeProductionAtlas`, thread it into `rasterizeLayer`, make the rasterizer async, and await it after every 96 triangles. `yieldToBrowser` must use `requestAnimationFrame` when available and `setTimeout(resolve, 0)` otherwise. Keep the existing 98.5% coverage check and nearest-surface fallback unchanged.

- [x] **Step 4: Run focused tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/productionAtlasBaker.test.js
```

Expected: all production Atlas unit tests PASS.

- [x] **Step 5: Commit**

```powershell
git add src/features/configurator/scene/productionAtlasBaker.js src/features/configurator/scene/productionAtlasBaker.test.js
git commit -m "perf: yield during production atlas baking"
```

### Task 2: Preserve renderer/package behavior across async yields

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.test.js` only if a regression test is needed
- Modify: `src/features/configurator/scene/garmentRenderer.js` only if progress/yield wiring requires it
- Modify: `src/features/configurator/designs/productionPackage.test.js` only if an async provider regression is needed

- [x] **Step 1: Add an async sequencing regression**

Extend the existing renderer/package test harness so the production artifact provider yields once during Atlas baking and assert that the returned artifact still contains the PNG Atlas, both previews, legacy metadata, and the same normalized state snapshot.

- [x] **Step 2: Run the focused regression**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/designs/productionPackage.test.js
```

Expected: the new regression fails only if async propagation or cleanup is incomplete.

- [x] **Step 3: Implement only required propagation**

Keep `prepareProductionArtifacts` and `createProductionPackage` awaited end-to-end. Do not introduce a second renderer, a second snapshot, or a background state store. Ensure any thrown error still restores capture mode and releases canvases.

- [x] **Step 4: Run focused regression**

Expected: all renderer and package tests PASS.

- [x] **Step 5: Commit**

```powershell
git add src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/designs/productionPackage.test.js
git commit -m "test: preserve async production export cleanup"
```

### Task 3: Verify real responsiveness and output invariants

**Files:**
- Modify: `docs/superpowers/handoffs/2026-07-31-phase2-production-files-handoff.md`

- [x] **Step 1: Run the full suite**

```powershell
npm test
```

Expected: all tests PASS with no unhandled errors.

- [x] **Step 2: Run both builds**

```powershell
npm run build:app
npm run build:shopify
```

Expected: both builds exit 0.

- [x] **Step 3: Repeat real browser export**

Use the existing Chelsea test flow with front/back player sets, front/back text, a preset badge, and a transparent upload. Confirm the Save button remains disabled during preparation, the page can repaint between batches, the ZIP link appears, and the downloaded package still passes:

```powershell
node scripts/verify-production-package.mjs C:\path\to\downloaded.zip
```

- [x] **Step 4: Record timing and boundary**

Record the observed time to link publication before and after the change, plus any remaining synchronous stages. State clearly if the browser is responsive but total export time is unchanged; do not claim a speedup unless measured.

- [x] **Step 5: Commit evidence**

```powershell
git add docs/superpowers/handoffs/2026-07-31-phase2-production-files-handoff.md
git commit -m "docs: record production export responsiveness"
```
