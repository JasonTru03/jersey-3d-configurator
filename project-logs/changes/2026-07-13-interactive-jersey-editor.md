# 2026-07-13 Interactive Jersey Editor

## Goal

Implement the approved first-stage editor: presets plus local image upload, with move, scale, rotate, and delete controls for decorations.

## Scope

- Work is isolated on branch `codex/interactive-jersey-editor`.
- No backend, Shopify deployment, production asset upload, or main-branch merge is in scope.

## Planned Changes

- Add decoration preset and region configuration.
- Add an editable decoration layer for the 3D scene.
- Add UI controls for preset selection, upload, region selection, and delete.
- Add unit, component, and browser interaction verification.

## Verification Baseline

- `npm test`: 8 tests passed in the isolated worktree before implementation.

## Open Limits

- Uploaded images are browser-session data only.
- Decorations use a camera-facing editor layer in stage one, not mesh-projected decals.
