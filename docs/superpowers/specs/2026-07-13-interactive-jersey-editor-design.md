# Interactive Jersey Editor Design

## Goal

Add a first-stage jersey editor that lets shoppers select preset patterns and badges, upload an image, and edit each placed decoration while retaining the current limited garment viewing controls.

## Scope

- Keep the existing GLB jersey viewer, constrained orbit rotation, camera zoom, and panning.
- Add preset pattern and badge choices in the configurator panel.
- Allow PNG, JPG, WebP, and SVG uploads up to 5 MB. Uploads stay in browser memory only.
- Place each selected or uploaded decoration on a camera-facing editor layer over the jersey.
- Let shoppers select one decoration at a time and drag, resize, rotate, or remove it.
- Store decorations in configurator state so the Shopify configuration JSON can include the edit result.

## Deliberate First-Stage Limits

- Decorations are not projected onto the garment mesh and are not production-ready print files.
- Decorations may only be placed in one of four named regions: front, back, left sleeve, and right sleeve.
- Uploaded images are not persisted across refreshes, devices, or orders. A future backend is required for that.
- Garment size and material remain catalog options; this work does not add GLB variants.

## Architecture

1. `productDefinitions.js` owns presets and region metadata.
2. A new scene-editor module owns decoration geometry, selection, transform math, and interaction limits.
3. `garmentRenderer.js` renders the garment and delegates decoration-layer rendering to the scene editor.
4. The configurator UI owns preset selection, upload input, active region selection, and deletion.
5. Existing state merging persists a serializable decoration list containing asset source, transform, and region.

## Interaction Model

- Selecting a preset creates a decoration in the active region.
- Uploading a valid image creates one decoration with an in-memory data URL.
- Clicking a decoration selects it and reveals a visible frame with resize and rotation handles.
- Dragging its body moves it within its region. Dragging a corner scales it within safe limits. Dragging the rotation handle rotates it.
- Clicking empty editor space removes the selection. Removing an item deletes it from state.
- While a decoration is selected or transformed, garment orbit controls are disabled. Otherwise, existing camera controls apply.

## Validation And Error Handling

- Reject unsupported files and files over 5 MB before creating an image URL.
- Limit text/image decoration count to a small fixed maximum to protect rendering performance.
- Keep invalid or unreadable images out of state and show a user-facing validation message.
- Clamp translate, scale, and rotation values before serializing state.

## Testing

- Unit tests: upload validation, transform clamping, region boundaries, decoration state changes.
- Component tests: preset selection, file validation feedback, delete action, serialized configuration.
- Browser test: choose a preset, upload a test image, drag, resize, rotate, switch region, and confirm garment controls still work when no decoration is selected.
- Regression: existing tests and production build remain green.

## Rollback

The feature is isolated to decoration config, editor scene code, UI controls, and accompanying styles. Reverting the feature commit restores the original jersey renderer and UI behavior.
