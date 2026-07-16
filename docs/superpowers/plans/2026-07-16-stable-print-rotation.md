# Stable Print Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unstable absolute-angle print rotation with fixed-sensitivity tangential drag rotation.

**Architecture:** `PrintToolbarOverlay` continues to own pointer capture and emits absolute normalized rotation values. Its rotation session will store the previous pointer point and last stable radial direction; each move projects the pointer delta onto that direction's clockwise tangent, applies a fixed pixel-to-degree conversion, and caps the per-event result.

**Tech Stack:** React, Vitest, Testing Library, Vite.

---

## File structure

- Modify: `src/features/configurator/scene/PrintToolbarOverlay.jsx` — replace absolute pointer-bearing updates with stable tangential delta updates.
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx` — assert fixed sensitivity, center-crossing stability, and per-event cap.
- Modify: `src/features/configurator/scene/ProductStage.test.jsx` — assert the emitted fixed-sensitivity rotation persists in page state.

### Task 1: Encode stable-drag expectations

**Files:**
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`

- [ ] **Step 1: Replace absolute-angle toolbar expectations with fixed tangential expectations**

Create three focused tests using the existing visible anchor `{ left: 100, top: 100, width: 100, height: 60 }`, whose center is `(150, 130)`:

```jsx
it('uses the same clockwise rotation increment for equal tangent drags at different radii', () => {
  // Start at (250, 130), then move down 20px: expect 350 degrees from rotation 0.
  // Repeat from (200, 130), then move down 20px: expect the same 350 degrees.
});

it('keeps the established direction while the pointer crosses the print center', () => {
  // Move down from the right side, cross through (150, 130), then emerge left.
  // Assert that each stored rotation stays at or below the first clockwise result.
});

it('limits a large pointer event to twenty-four degrees', () => {
  // Start at (250, 130), move to (250, 1000), and expect 336 degrees from rotation 0.
});
```

Retain the pointer-capture and click-without-movement checks. Remove the old assertion that expects an absolute 329.6 degree result from a pointer bearing.

- [ ] **Step 2: Update ProductStage's desired state value**

Keep the existing right-to-bottom drag in `ProductStage.test.jsx`, but change its persisted rotation assertion from `270` to the capped fixed-sensitivity result:

```jsx
printItems: [expect.objectContaining({ id: 'print-1', rotation: expect.closeTo(336, 0) })],
```

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```powershell
npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx
```

Expected: the new fixed-distance and capped-step assertions fail because the current code still derives rotation from absolute pointer bearing.

### Task 2: Implement stable tangential rotation

**Files:**
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.jsx`

- [ ] **Step 1: Add the rotation constants and focused helpers**

Add these constants beside the existing scale constants:

```jsx
const ROTATION_CENTER_PROTECTION_RADIUS = 32;
const ROTATION_DEGREES_PER_PIXEL = 0.5;
const MAX_ROTATION_DELTA = 24;
```

Add helpers that return `null` inside the protected radius, map a stable radial vector to a clockwise screen tangent, and clamp a numeric rotation delta:

```jsx
function getRadialDirection(centerX, centerY, clientX, clientY) {
  const x = clientX - centerX;
  const y = clientY - centerY;
  const distance = Math.hypot(x, y);
  if (distance < ROTATION_CENTER_PROTECTION_RADIUS) return null;
  return { x: x / distance, y: y / distance };
}

function getClockwiseTangent(direction) {
  return { x: -direction.y, y: direction.x };
}

function clampRotationDelta(delta) {
  return Math.min(MAX_ROTATION_DELTA, Math.max(-MAX_ROTATION_DELTA, delta));
}
```

- [ ] **Step 2: Store a stable pointer session on rotation start**

Replace the stored absolute `angle` with previous pointer coordinates and a radial direction. Use `{ x: 1, y: 0 }` only when the initial pointer is unexpectedly inside the protected radius:

```jsx
const radialDirection = getRadialDirection(centerX, centerY, event.clientX, event.clientY) ?? { x: 1, y: 0 };
rotationStart.current = {
  pointerId: event.pointerId,
  centerX,
  centerY,
  lastX: event.clientX,
  lastY: event.clientY,
  radialDirection,
  rotation: normalizePrintRotation(item.rotation ?? 0),
};
```

- [ ] **Step 3: Calculate and persist the tangential delta**

Replace the body of the current `rotate` calculation with the following sequence:

```jsx
const dx = event.clientX - start.lastX;
const dy = event.clientY - start.lastY;
const tangent = getClockwiseTangent(start.radialDirection);
const delta = clampRotationDelta((dx * tangent.x + dy * tangent.y) * ROTATION_DEGREES_PER_PIXEL);
const rotation = normalizePrintRotation(start.rotation - delta);
const radialDirection = getRadialDirection(start.centerX, start.centerY, event.clientX, event.clientY) ?? start.radialDirection;
rotationStart.current = { ...start, lastX: event.clientX, lastY: event.clientY, radialDirection, rotation };
onRotate(item.id, rotation);
```

Do not change resize behavior, pointer-capture handlers, normalization, or ProductStage's callback interface.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```powershell
npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx
```

Expected: both files pass, including fixed sensitivity, center protection, cap, pointer capture, and persisted state assertions.

- [ ] **Step 5: Commit and push the implementation checkpoint**

Run:

```powershell
git add src/features/configurator/scene/PrintToolbarOverlay.jsx src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx
git commit -m "fix: stabilize print rotation drag"
git push origin codex/stable-print-rotation
git push backup codex/stable-print-rotation
```

Expected: the code and regression tests are present on both remotes.

### Task 3: Record complete verification

**Files:**
- Create: `docs/superpowers/handoffs/2026-07-16-stable-print-rotation-handoff.md`

- [ ] **Step 1: Run full tests and showcase build**

Run:

```powershell
npm test
npm run build:showcase
```

Expected: all tests pass and Vite completes the production showcase build. The existing chunk-size warning is acceptable when the command exits with code 0.

- [ ] **Step 2: Create the handoff record**

Document the branch, implementation commit, test/build results, constants, and a manual checklist covering clockwise and counterclockwise drags at near and far radii, a center crossing, a fast long drag, multi-circle drag, 0/359 wrap, pointer release, and click without movement.

- [ ] **Step 3: Commit and push the verification record**

Run:

```powershell
git add docs/superpowers/handoffs/2026-07-16-stable-print-rotation-handoff.md
git commit -m "docs: record stable print rotation verification"
git push origin codex/stable-print-rotation
git push backup codex/stable-print-rotation
```

Expected: both remotes have the verification record before merge review.
