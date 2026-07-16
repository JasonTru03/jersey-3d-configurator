# Print Rotation Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clockwise dragging of the selected-print rotation handle produce clockwise visual text rotation.

**Architecture:** Keep pointer-angle collection, incremental updates, and normalization in `PrintToolbarOverlay`. Reverse only the sign of the shortest pointer-angle delta before the value is passed to `ProductStage`, which already persists the emitted absolute rotation.

**Tech Stack:** React, Vitest, Testing Library, Vite.

---

## File structure

- Modify: `src/features/configurator/scene/PrintToolbarOverlay.jsx` — apply the corrected angle direction at the existing rotation handler.
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx` — encode the visual clockwise/counterclockwise mapping and wraparound expectation.
- Modify: `src/features/configurator/scene/ProductStage.test.jsx` — verify the state patch retains the corrected absolute rotation.

### Task 1: Correct circular print rotation direction

**Files:**
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.jsx`

- [ ] **Step 1: Write the failing toolbar-direction assertions**

Replace the initial wraparound assertion so the pointer path from the lower-left side to the upper-left side stores the inverse rotation, and name the test after the counterclockwise pointer movement:

```jsx
expect(onRotate).toHaveBeenLastCalledWith('print-1', expect.closeTo(329.6, 0));
```

The later full-circle assertion becomes approximately `160`, preserving the initial 20.4 degree counterclockwise movement while proving that incremental updates still support repeated circular movement.

- [ ] **Step 2: Write the failing state-persistence assertion**

In `ProductStage.test.jsx`, retain the existing right-to-bottom pointer path, which is clockwise on screen, but assert the corrected stored value:

```jsx
printItems: [expect.objectContaining({ id: 'print-1', rotation: expect.closeTo(270, 0) })],
```

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```powershell
npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx
```

Expected: both changed assertions fail because the current handler adds the pointer-angle delta and emits approximately `10.4` and `90` instead.

- [ ] **Step 4: Apply the minimal direction correction**

In the existing `rotate` handler in `src/features/configurator/scene/PrintToolbarOverlay.jsx`, replace only the angle composition:

```jsx
const rotation = normalizePrintRotation(start.rotation - getShortestAngleDelta(start.angle, angle));
```

Do not change `getPointerAngle`, `getShortestAngleDelta`, `normalizePrintRotation`, pointer capture, or resize code.

- [ ] **Step 5: Run the focused tests to verify GREEN**

Run:

```powershell
npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx
```

Expected: both files pass, including the no-movement rotation test and scale tests.

- [ ] **Step 6: Commit and push the verified fix**

Run:

```powershell
git add src/features/configurator/scene/PrintToolbarOverlay.jsx src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx
git commit -m "fix: align print rotation with pointer direction"
git push origin codex/fix-print-rotation-direction
git push backup codex/fix-print-rotation-direction
```

Expected: one commit containing only the rotation implementation and its regression tests is available on both remotes.

### Task 2: Complete regression verification and handoff

**Files:**
- Create: `docs/superpowers/handoffs/2026-07-16-print-rotation-direction-handoff.md`

- [ ] **Step 1: Run the full automated regression suite**

Run:

```powershell
npm test
```

Expected: all Vitest files pass.

- [ ] **Step 2: Build the Cloudflare showcase assets**

Run:

```powershell
npm run build:showcase
```

Expected: the Vite build succeeds; the existing chunk-size warning is acceptable if no build error is reported.

- [ ] **Step 3: Record the verified behavior and limits**

Create the handoff file with the fix scope, focused/full test and build commands, commit identifiers, and the manual validation checklist: clockwise drag, counterclockwise drag, a full additional circle, wrap at 0/359, pointer release, and click without movement.

- [ ] **Step 4: Commit and push the verification handoff**

Run:

```powershell
git add docs/superpowers/handoffs/2026-07-16-print-rotation-direction-handoff.md
git commit -m "docs: record print rotation direction verification"
git push origin codex/fix-print-rotation-direction
git push backup codex/fix-print-rotation-direction
```

Expected: both remotes contain a reproducible verification record before the user decides whether to merge and publish.
