# Following Rotation Handle and Reliable Shopify Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make personalization controls continuously follow their selection frame and make Shopify launcher navigation survive Horizon variant DOM replacement.

**Architecture:** Split the overlay into a three-action dock plus an independently positioned rotate handle while keeping gesture ownership and pointer capture in the existing React component. Replace replaceable-node click listeners in both Shopify launcher Liquid files with native anchor URLs and one delegated document listener that resolves the live product variant on every click.

**Tech Stack:** React 19, CSS, Vitest/Testing Library, Shopify Liquid and browser DOM APIs.

---

### Task 1: Following personalization controls

**Files:**
- Modify: `src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx`
- Modify: `src/features/configurator/scene/personalizationToolbarLayout.js`
- Modify: `src/features/configurator/scene/PersonalizationToolbarOverlay.jsx`
- Modify: `src/features/configurator/scene/personalization-controls.css`

- [ ] **Step 1: Write failing component tests**

Change the control-structure assertion to require edit/duplicate/delete inside the dock and the rotate handle outside it. Require visible `DRAG` copy and a connector test id. Replace frozen-dock assertions with assertions that both dock and rotate handle receive positions from the latest anchor during an active gesture.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx`

Expected: failures because rotation is still inside the four-button dock, has no visible cue/connector, and freezes its layout while dragging.

- [ ] **Step 3: Implement the minimal following layout**

Update `personalizationToolbarLayout.js` to size a three-button dock and export a boundary-clamped rotate-handle layout. In `PersonalizationToolbarOverlay.jsx`, remove frozen dock state, render rotate separately with the grip/cue/connector, and use the current anchor for every render. In CSS, keep 44-pixel targets, position the separate handle, and style its connector, grip cue, and dragging state.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx src/features/configurator/scene/personalizationToolbarLayout.test.js`

Expected: all selected tests pass.

- [ ] **Step 5: Commit the toolbar checkpoint**

Run:

```powershell
git add src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx src/features/configurator/scene/personalizationToolbarLayout.js src/features/configurator/scene/PersonalizationToolbarOverlay.jsx src/features/configurator/scene/personalization-controls.css
git commit -m "feat: attach drag rotation handle to selection"
```

### Task 2: Horizon-resilient Shopify launcher

**Files:**
- Modify: `shopify/blocks/product-3d-configurator-launch.test.js`
- Modify: `shopify/blocks/product-3d-configurator-launch.liquid`
- Modify: `shopify/sections/product-3d-configurator-launch.liquid`

- [ ] **Step 1: Write failing Liquid source tests**

Read both Liquid sources and require: an anchor `href`, initial variant ID data, document-level delegated click handling, `form.elements.id`, URL `variant` fallback, and no button-level `addEventListener('click', ...)` binding.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- shopify/blocks/product-3d-configurator-launch.test.js`

Expected: failures because both launchers render buttons and directly bind listeners to replaceable nodes.

- [ ] **Step 3: Implement delegated navigation**

Render each control as an anchor whose Liquid-generated `href` includes shop, product handle, initial variant, maps, and return path. Install one guarded document click listener per launcher kind. On click, identify the clicked current launcher, resolve its nearest product form, read the live variant using the specified precedence, update the Worker URL, and navigate. Preserve the native `href` when no live variant is found.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- shopify/blocks/product-3d-configurator-launch.test.js`

Expected: all launcher source-contract tests pass.

- [ ] **Step 5: Commit the launcher checkpoint**

Run:

```powershell
git add shopify/blocks/product-3d-configurator-launch.test.js shopify/blocks/product-3d-configurator-launch.liquid shopify/sections/product-3d-configurator-launch.liquid
git commit -m "fix: preserve Shopify launcher after variant changes"
```

### Task 3: Regression and pre-release verification

**Files:**
- Create: `project-logs/changes/2026-07-27-following-rotation-handle-shopify-launcher.md`

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: zero failed tests.

- [ ] **Step 2: Build both delivery targets**

Run: `npm run build`

Expected: `build:app` and `build:shopify` both exit successfully.

- [ ] **Step 3: Perform local browser acceptance**

Open the local configurator, add/select text, rotate repeatedly while observing the selection frame, and verify the separate rotate handle, connector, `DRAG` cue, edit, duplicate, delete, resize, desktop bounds, mobile bounds, and browser console.

- [ ] **Step 4: Validate the unpublished Shopify theme**

Back up the unpublished theme asset, upload only `sections/product-3d-configurator-launch.liquid`, read it back byte-for-byte, then use the real product page to select a different size and activate `Start 3D customization`. Verify the Worker URL receives the newly selected variant.

- [ ] **Step 5: Record evidence and commit**

Write exact commands, test counts, build output, browser observations, unpublished theme ID, backup path, and remaining release boundary to the change log. Commit only that log and any intentional generated Shopify assets already tracked by the project.

- [ ] **Step 6: Stop at the release confirmation point**

Report the verified local/unpublished-theme state and request confirmation before publishing Cloudflare production or modifying Shopify live theme `152029888663`.
