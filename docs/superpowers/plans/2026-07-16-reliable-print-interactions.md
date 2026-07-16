# Reliable Print Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Name Set resize control continuous and reversible, and ensure clicking outside a selected Name Set only clears selection rather than moving it.

**Architecture:** Keep the current React overlay responsible for resize-handle pointer capture and scale calculation. Keep the Three.js renderer responsible for picking, selection and on-garment dragging; introduce small exported pure helpers for drag-threshold and pointer-down action decisions so the renderer policy has direct regression coverage.

**Tech Stack:** React 19, Three.js, Vitest, Testing Library, CSS.

---

### Task 1: Stabilize and bound resize-handle scaling

**Files:**
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.jsx`
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css`

- [ ] **Step 1: Write failing tests for pointer capture, reversible scale and limits**

```jsx
it('captures the resize pointer and scales outward and inward within limits', () => {
  const onScale = vi.fn();
  render(<PrintToolbarOverlay anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }} item={{ id: 'print-1', scale: 1 }} onCopy={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onRotate={vi.fn()} onScale={onScale} />);
  const handle = screen.getByRole('button', { name: 'Resize print' });
  handle.setPointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { pointerId: 7, clientX: 200, clientY: 160 });
  fireEvent.pointerMove(handle, { pointerId: 7, clientX: 240, clientY: 200 });
  fireEvent.pointerMove(handle, { pointerId: 7, clientX: 165, clientY: 135 });
  expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
  expect(onScale.mock.calls[0][1]).toBeGreaterThan(1);
  expect(onScale.mock.calls[1][1]).toBeLessThan(1);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because capture and inward scaling do not exist**

Run: `npm test -- src/features/configurator/scene/PrintToolbarOverlay.test.jsx`  
Expected: FAIL; the implementation does not call `setPointerCapture` and the second scale value is not below `1`.

- [ ] **Step 3: Implement the minimal resize lifecycle**

```jsx
const MIN_PRINT_SCALE = 0.45;
const MAX_PRINT_SCALE = 2.5;

function getResizeScale(start, clientX, clientY) {
  const distance = Math.hypot(clientX - start.centerX, clientY - start.centerY);
  return Math.min(MAX_PRINT_SCALE, Math.max(MIN_PRINT_SCALE, start.scale + (distance - start.distance) / 160));
}

onPointerDown={(event) => {
  event.currentTarget.setPointerCapture(event.pointerId);
  dragStart.current = { pointerId: event.pointerId, scale: item.scale, centerX: anchor.left + anchor.width / 2, centerY: anchor.top + anchor.height / 2, distance: Math.hypot(event.clientX - (anchor.left + anchor.width / 2), event.clientY - (anchor.top + anchor.height / 2)) };
}}
```

Use the stored `pointerId` in `pointermove`, clear state on `pointerup`, `pointercancel` and `lostpointercapture`, and add `touch-action: none` to `.print-control--resize`.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `npm test -- src/features/configurator/scene/PrintToolbarOverlay.test.jsx`  
Expected: PASS.

- [ ] **Step 5: Commit and push the resize checkpoint**

```bash
git add src/features/configurator/scene/PrintToolbarOverlay.jsx src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/ui/configurator.css
git commit -m "fix: stabilize print resize control"
git push origin codex/reliable-print-interactions
git push backup codex/reliable-print-interactions
```

### Task 2: Separate selecting, dragging and blank-area deselection

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: Write failing tests for pointer-down decisions and the drag threshold**

```js
import { getPrintPointerDownAction, hasExceededPrintDragThreshold } from './garmentRenderer.js';

it('clears selection instead of placing a print when a pointer misses a print and decoration', () => {
  expect(getPrintPointerDownAction({ hasPrintHit: false, handledDecoration: false })).toBe('deselect-print');
});

it('does not start a drag until the pointer has moved more than four pixels', () => {
  expect(hasExceededPrintDragThreshold({ x: 100, y: 100 }, { clientX: 103, clientY: 102 })).toBe(false);
  expect(hasExceededPrintDragThreshold({ x: 100, y: 100 }, { clientX: 105, clientY: 103 })).toBe(true);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because helpers are not exported**

Run: `npm test -- src/features/configurator/scene/garmentRenderer.test.js`  
Expected: FAIL with missing exports.

- [ ] **Step 3: Implement the renderer interaction policy**

```js
export function getPrintPointerDownAction({ hasPrintHit, handledDecoration }) {
  if (hasPrintHit) return 'select-print';
  if (handledDecoration) return 'decoration';
  return 'deselect-print';
}

export function hasExceededPrintDragThreshold(start, event) {
  return Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
}
```

Store a pending drag start only after a print hit. On move, start `isDraggingPrint` and place on the jersey only after `hasExceededPrintDragThreshold` returns true. For `deselect-print`, notify React, hide the anchor and return without raycasting or placing a print. On pointer-up, emit placement only if a real print drag occurred.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `npm test -- src/features/configurator/scene/garmentRenderer.test.js`  
Expected: PASS.

- [ ] **Step 5: Run the affected component and renderer tests together**

Run: `npm test -- src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/garmentRenderer.test.js`  
Expected: PASS.

- [ ] **Step 6: Commit and push the selection checkpoint**

```bash
git add src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "fix: prevent print movement on blank clicks"
git push origin codex/reliable-print-interactions
git push backup codex/reliable-print-interactions
```

### Task 3: Complete verification and record the release handoff

**Files:**
- Create: `docs/superpowers/handoffs/2026-07-16-reliable-print-interactions-handoff.md`

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`  
Expected: PASS with no failed test files or tests.

- [ ] **Step 2: Build the standalone showcase**

Run: `npm run build:showcase`  
Expected: exit code `0`; existing bundle-size warning may remain non-blocking.

- [ ] **Step 3: Record exact evidence and the manual WebGL checklist**

```markdown
## Manual WebGL verification

1. Select a Name Set and drag the resize handle beyond its button boundary; scale continues changing.
2. Drag outward and inward; text grows and shrinks but stays between the documented limits.
3. Click Name Set without moving; its location does not change.
4. Drag Name Set more than 4px; it follows the garment surface and persists its new location.
5. Click another area of the jersey; controls disappear and the Name Set stays in place.
```

- [ ] **Step 4: Commit and push the verification handoff**

```bash
git add docs/superpowers/handoffs/2026-07-16-reliable-print-interactions-handoff.md
git commit -m "docs: record reliable print interaction verification"
git push origin codex/reliable-print-interactions
git push backup codex/reliable-print-interactions
```
