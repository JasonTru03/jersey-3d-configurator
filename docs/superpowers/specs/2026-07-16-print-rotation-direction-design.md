# Print rotation direction fix

## Goal

When a shopper drags the circular rotation handle clockwise around a selected print, the print must rotate clockwise on screen. Counterclockwise dragging must produce the inverse visual motion.

## Scope

- Reverse only the sign used when applying the pointer-angle delta to the saved print rotation.
- Keep the existing pointer capture, incremental multi-circle dragging, 0 to 359 degree normalization, and click-without-move behavior unchanged.
- Update toolbar and stage tests to describe the visual direction contract and the persisted rotation value.

## Design

Pointer angles use browser screen coordinates, where the Y axis increases downward. The renderer's positive text rotation is visually opposite to that pointer orientation. The rotation handler will therefore subtract the shortest pointer-angle delta instead of adding it, then continue to normalize the result to the existing 0 to 359 degree range.

For example, a clockwise quarter-turn of the pointer from the right side of the print to the lower side stores 270 degrees, which renders as a clockwise quarter-turn for the shopper.

## Validation

1. Add expectations that fail under the current reversed mapping.
2. Run the focused Vitest files and confirm the expected assertion failures.
3. Apply the one-line direction fix and rerun focused tests.
4. Run the full test suite and showcase build before integration.

## Out of scope

- No changes to selection, dragging, resize behavior, artwork placement, product models, storage, or deployment configuration.
