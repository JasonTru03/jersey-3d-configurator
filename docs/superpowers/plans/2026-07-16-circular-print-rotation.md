# Circular Print Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed-click Name Set rotation with continuous circular pointer dragging that persists a normalized 0–359 degree angle.

**Architecture:** The React toolbar owns Pointer Capture and derives each movement from the selected rectangle center. It updates the callback with an absolute normalized angle; `ProductStage` writes that value directly to the selected print item, while small pure helpers make angle wrapping behavior directly testable.

**Tech Stack:** React 19, Vitest, Testing Library, existing configurator state helpers.

---

### Task 1: Add circular-angle regression tests

**Files:**
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`

- [ ] **Step 1: Replace fixed-click rotation expectations with a failing circular-drag test**

```jsx
it('captures the rotation pointer and emits normalized clockwise and counterclockwise angles', () => {
  const onRotate = vi.fn();
  render(<PrintToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', rotation: 350 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);
  const handle = screen.getByRole('button', { name: 'Rotate print' });
  handle.setPointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { pointerId: 9, clientX: 100, clientY: 139 });
  fireEvent.pointerMove(handle, { pointerId: 9, clientX: 100, clientY: 121 });
  expect(handle.setPointerCapture).toHaveBeenCalledWith(9);
  expect(onRotate).toHaveBeenLastCalledWith('print-1', 10);
});

it('does not change rotation for a click without pointer movement', () => {
  const onRotate = vi.fn();
  render(<PrintToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', rotation: 120 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={onRotate} />);
  const handle = screen.getByRole('button', { name: 'Rotate print' });
  fireEvent.pointerDown(handle, { pointerId: 10, clientX: 200, clientY: 130 });
  fireEvent.pointerUp(handle, { pointerId: 10 });
  expect(onRotate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write a failing state-write test for absolute rotation values**

```jsx
fireEvent.pointerDown(screen.getByRole('button', { name: 'Rotate print' }), { pointerId: 11, clientX: 200, clientY: 130 });
fireEvent.pointerMove(screen.getByRole('button', { name: 'Rotate print' }), { pointerId: 11, clientX: 150, clientY: 180 });

expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
  overrides: expect.objectContaining({
    printItems: [expect.objectContaining({ id: 'print-1', rotation: 90 })],
  }),
}));
```

- [ ] **Step 3: Run tests and confirm they fail because rotation is still click-based**

Run: `npm test -- src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx`  
Expected: FAIL because `Rotate print` does not exist, Pointer Capture is not called, and state still increments fixed `15` degrees.

### Task 2: Implement pointer-captured circular rotation

**Files:**
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.jsx`
- Modify: `src/features/configurator/scene/ProductStage.jsx`
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`

- [ ] **Step 1: Add minimal angle helpers and rotation pointer lifecycle**

```jsx
function normalizePrintRotation(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function getShortestAngleDelta(previous, next) {
  return ((next - previous + 540) % 360) - 180;
}

const startRotation = (event) => {
  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;
  event.currentTarget.setPointerCapture?.(event.pointerId);
  rotationStart.current = { pointerId: event.pointerId, centerX, centerY, angle: getPointerAngle(centerX, centerY, event.clientX, event.clientY), rotation: normalizePrintRotation(item.rotation ?? 0) };
};
```

On each matching `pointermove`, add the shortest delta from the previously stored angle to the current angle, normalize the result, save the current angle, and call `onRotate(item.id, nextRotation)`. Clear state on `pointerup`, `pointercancel`, and `lostpointercapture`; remove the old rotate button `onClick`.

- [ ] **Step 2: Change `ProductStage` to store the supplied absolute angle**

```jsx
onRotate={(id, rotation) => patchPrint(id, { rotation })}
```

- [ ] **Step 3: Run focused tests and confirm they pass**

Run: `npm test -- src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx`  
Expected: PASS.

- [ ] **Step 4: Commit and push the implementation checkpoint**

```bash
git add src/features/configurator/scene/PrintToolbarOverlay.jsx src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.jsx src/features/configurator/scene/ProductStage.test.jsx
git commit -m "feat: add circular print rotation control"
git push origin codex/circular-print-rotation
git push backup codex/circular-print-rotation
```

### Task 3: Verify and record handoff

**Files:**
- Create: `docs/superpowers/handoffs/2026-07-16-circular-print-rotation-handoff.md`

- [ ] **Step 1: Run full test suite**

Run: `npm test`  
Expected: PASS with no failing test files or tests.

- [ ] **Step 2: Build standalone showcase**

Run: `npm run build:showcase`  
Expected: exit code `0`; the existing bundle-size warning is documented as non-blocking.

- [ ] **Step 3: Record manual WebGL verification steps**

```markdown
1. Press and hold the rotate handle, then move clockwise through more than one full circle; the text continues rotating.
2. Cross from 359 degrees to 0 degrees and from 0 degrees to 359 degrees; no visual jump or reversal occurs.
3. Drag outside the handle boundary; rotation continues until release.
4. Click and release without movement; rotation remains unchanged.
5. Refresh after release; the final normalized angle remains applied.
```

- [ ] **Step 4: Commit and push verification handoff**

```bash
git add docs/superpowers/handoffs/2026-07-16-circular-print-rotation-handoff.md
git commit -m "docs: record circular rotation verification"
git push origin codex/circular-print-rotation
git push backup codex/circular-print-rotation
```
