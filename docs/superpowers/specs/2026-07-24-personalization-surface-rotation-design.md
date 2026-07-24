# Personalization Surface and Rotation Interaction Design

## Goal

Improve custom text editing in three focused areas:

1. Text follows the jersey surface instead of floating away from curved fabric.
2. Every Personalize list row has a direct delete action.
3. Rotation uses a stable drag handle that supports repeated, continuous movement without reversing direction near angle boundaries.

The existing design document format, pricing, Shopify cart properties, and saved personalization transforms remain compatible.

## Confirmed interaction

- Rotation is free-drag.
- The handle stays at its pointer-down screen position while a rotation gesture is active.
- Rotation softly snaps to multiples of 45 degrees when the raw angle is within 4 degrees of a snap point.
- Moving away from the snap threshold immediately returns to free rotation.
- The final normalized rotation remains in the existing `0..359` degree storage contract.

## Surface-conforming text

### Root cause

The current text is rendered on one flat plane aligned to a single garment-face normal. A wide plane cannot follow the curved chest, so its edges visibly separate from the jersey in side views.

### Design

- Reuse the existing Three.js `DecalGeometry` approach already used by artwork.
- Keep a transparent plane as the selection, raycast, drag, and resize proxy.
- Render the visible text on a decal surface generated from the garment mesh at the stored placement, normal, scale, and rotation.
- Use polygon offset for depth stability rather than increasing the physical gap from the jersey.
- When a legacy placement contains the old plane offset, raycast back toward the garment to recover the actual surface point before generating the decal.
- If the garment mesh is still loading, retain the current plane fallback, then replace it with the decal after the model becomes available.
- Rebuild only the selected decal when placement, scale, rotation, or text texture changes. Dispose replaced geometry and textures through the existing layer lifecycle.

This keeps old design files readable while making the final rendered text conform to the fabric.

## Stable drag rotation

### Root cause of direction reversal

Directly subtracting two `atan2` angles creates a discontinuity when the pointer crosses the `-180° / 180°` boundary. A clockwise drag can therefore produce a large negative delta and appear to reverse.

### Angle algorithm

On pointer down:

- capture the pointer;
- store the selected item rotation;
- store the pointer angle around the selection center;
- freeze the handle and control dock at their current screen coordinates.

On pointer move:

1. Calculate the new pointer angle with `atan2`.
2. Normalize only the incremental delta into `[-180°, 180°]`.
3. Add that delta to an accumulated unwrapped rotation.
4. Apply 45-degree soft snapping within a 4-degree threshold.
5. Emit the normalized preview rotation.
6. Store the current pointer angle for the next incremental move.

On pointer up or cancel:

- emit the final normalized rotation;
- release pointer capture;
- clear the frozen control position.

Incremental unwrapping preserves direction across every full turn and avoids the previous reversal.

## Selection controls

- Replace corner-distributed edit/rotate/delete/duplicate controls with a compact horizontal dock positioned from the selection center.
- The dock position is independent of the axis-aligned red frame width and height.
- During rotation the dock is frozen at the pointer-down position, so the user can keep dragging or interact again without chasing the button.
- The red selection frame may continue to follow the projected text bounds.
- The resize handle remains at the lower-right edge of the selection frame.
- Existing edit, duplicate, delete, and resize behaviors remain available.

## Personalize list deletion

- Each row becomes a two-part layout:
  - the main selection button;
  - a 44-pixel delete button with a trash icon and item-specific accessible label.
- Clicking delete does not first select the row.
- Deleting the selected item clears selection and returns focus to the Personalization elements list.
- Deleting another item preserves the current selection.
- Player and custom-text deletion use the same normalized collection helpers as the 3D toolbar.

## Error and edge handling

- Blank text remains editable in the list and has no visible decal.
- If decal projection finds no garment mesh, the plane fallback stays visible.
- Pointer cancel and lost pointer capture finish the gesture without leaving orbit controls disabled.
- Rotation supports crossing angle wrap boundaries and multiple full turns.
- Item limits, pricing, undo/redo, save/open, and Shopify cart data remain unchanged.

## Test strategy

### Unit and component tests

- Incremental angle unwrapping across `179° → -179°` continues in the same direction.
- Clockwise and counter-clockwise rotation stay monotonic through 45-degree and 180-degree crossings.
- 45-degree soft snap applies inside the threshold and releases outside it.
- The drag handle uses pointer capture and keeps its frozen coordinates during anchor changes.
- List trash buttons delete the correct player or text item.
- Deleting selected and non-selected rows produces the correct focus and selection behavior.
- Decal creation uses the garment surface hit, scale, aspect, and rotation.
- Replaced decal geometry is disposed.

### Browser acceptance

- Front, angled, side, and back camera views show text touching the jersey surface.
- Drag rotation completes at least two full clockwise and counter-clockwise turns without reversal.
- The pointer remains over the active rotate handle during the gesture.
- Repeated rotate gestures begin from the previously saved angle.
- Resize, drag, duplicate, delete, undo/redo, save/open, Review pricing, desktop layout, and mobile layout still pass.

## Scope boundary

This change does not bake personalization into the garment UV atlas, change the saved document schema, alter pricing, alter Shopify variant mapping, or redesign unrelated Artwork controls.
