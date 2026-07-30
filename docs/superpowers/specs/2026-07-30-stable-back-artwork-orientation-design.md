# Stable Back Artwork Orientation Design

## Goal

Keep preset and uploaded artwork visually upright while it is dragged across the curved back of either supported jersey model. The saved `rotation` value remains the only intentional in-plane rotation.

## Root cause

Artwork still builds its decal orientation with `Quaternion.setFromUnitVectors(FORWARD, normal)`. Near the back-facing antiparallel normal `(0, 0, -1)`, this determines the decal normal but not a stable tangent/up direction. Small changes in the garment normal can therefore roll the artwork while the stored rotation remains unchanged.

Player names and numbers already avoid this singularity through `getPersonalizationDecalOrientation`, which projects garment world-up onto the surface tangent plane and derives a deterministic right-handed basis.

## Chosen design

Reuse `getPersonalizationDecalOrientation` for all Artwork orientation calculations:

- decal projection geometry;
- conversion of a grabbed world-space point into decal-local offset;
- conversion of that local offset back to a world-space drag position.

This keeps rendering and pointer placement on the same deterministic frame across front, back, and sleeves. It also matches the existing region frames: back uses negative world X as local right, while both sleeves retain their expected outward-facing orientation.

## Alternatives not selected

- **Back-only special case:** smaller diff, but leaves the same singularity on other curved surfaces.
- **Parallel transport during dragging:** smooth during one drag, but introduces path-dependent saved orientation and requires extra transient state.

## Compatibility and scope

- Do not change garment models, UVs, design persistence, Shopify data, pricing, or rotation controls.
- Preserve the artwork's saved placement, scale, and numeric rotation.
- Do not modify the already-stable player name/number behavior.

## Verification

- A regression test covers exact and nearby curved back normals and verifies that Artwork local up stays aligned with projected garment-up.
- Existing grab-offset and projection tests continue to pass.
- Focused scene tests, the full test suite, and the production build pass.
