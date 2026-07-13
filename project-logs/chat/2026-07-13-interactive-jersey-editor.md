# Interactive Jersey Editor Decision Log

## Confirmed Goal

The first version must show a jersey model, offer preset colors, patterns, and badges, and allow selected decorations to move, scale, and rotate. The garment retains limited viewing rotation and zoom.

## Key Decisions

- Use preset assets and local shopper image uploads in the first version.
- Use a camera-facing editor layer first for reliable interaction.
- Upgrade to mesh-projected decals only in a later stage.
- Create an isolated worktree and commit/push verified work to the existing GitHub remote.

## Current Status

- Design written for user review.
- Stage 1 implementation is complete and verified locally.

## Implementation Notes

- Decorations are stored in `overrides.decorations`; `activeDecorationId` and `activeDecorationRegion` keep selection state separate from immutable product definitions.
- `DecorationEditor` renders preset artwork and local uploads as camera-facing Three.js sprites. Region anchors intentionally make the first stage predictable; this is not mesh projection.
- Presets use `kind: pattern` or `kind: badge`; asset resolution must use the preset `assetUrl` for every non-upload kind. A regression test covers this distinction.
- Pointer selection now notifies React state so clicking an artwork on the model updates the panel selection. While an artwork is selected, OrbitControls is disabled; clicking an empty point deselects it.
- Shopify serialization strips upload `source` data URLs. Presets retain their source identifier so fulfillment can resolve approved artwork separately.

## Verification Record

- Full Vitest suite: 8 files / 17 tests passing.
- Production app and Shopify bundle builds passing.
- Browser check: Artwork panel opened, Golden Stripe added, and its contextual controls rendered without console errors.

## Render Bug Follow-up

- User reported that selecting `Roundel Badge` updated the panel but produced no visible badge on the jersey.
- The preset selection and state update were working; the defect was limited to the Three.js artwork render path.
- Replaced the decoration Sprite path with a camera-facing `MeshBasicMaterial` plane backed by a `CanvasTexture`, matching the proven print-layer pattern.
- Browser verification now shows `Roundel Badge` visibly rendered on the front of the jersey with no console errors.

## Follow-up

- Stage 2 should replace sprites with mesh-projected decals, add surface-aware region constraints, and define a durable asset-upload/fulfillment backend before enabling real customer-upload production orders.
