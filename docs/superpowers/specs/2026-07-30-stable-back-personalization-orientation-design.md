# Stable Back Personalization Orientation Design

## Goal

Keep player sets and custom text visually upright while they are dragged across the back of either supported jersey model. Surface curvature may tilt the proxy toward the fabric, but it must not introduce an apparent 180-degree roll. The customer's saved `rotation` remains the only intentional in-plane rotation.

## Root cause

The renderer currently uses `Quaternion.setFromUnitVectors(FORWARD, normal)` independently for every surface hit. This aligns the proxy normal but leaves its tangent/up direction underdetermined. Near the back-facing antiparallel normal `(0, 0, -1)`, tiny changes in the hit normal can select different 180-degree axes and flip the proxy's local up direction.

Both current garment models have valid curved back geometry, so their surface normals naturally vary while dragging. The models should not be flattened or edited to hide the orientation singularity.

## Chosen design

Create one deterministic personalization orientation helper:

1. Normalize the garment surface normal.
2. Project the garment's world-up axis onto the surface tangent plane.
3. Use that projected vector as the personalization's local up direction.
4. Derive the local right direction from the surface normal and stable up direction.
5. Apply the customer's stored in-plane rotation after the stable surface frame.
6. Use a fixed secondary reference axis only when the surface normal is effectively parallel to world-up.

Reuse this helper for:

- restoring a saved proxy placement;
- live drag placement;
- final decal projection.

This makes orientation deterministic from saved state, model normal, and customer rotation. It does not depend on the path taken during a drag.

## Alternatives not selected

- **Parallel-transport the previous orientation:** visually smooth, but the saved result can depend on drag history and accumulate drift.
- **Use mesh UV tangents:** model-dependent and vulnerable to UV seams; the two supported models do not need that extra coupling.

## Compatibility and scope

- Do not change the saved design schema, placement structure, pricing, Shopify cart data, or model files.
- Preserve existing front and side behavior, rotation controls, scaling, selection, and decal fitting.
- Do not alter artwork placement; this fix covers player sets and custom text handled by the personalization renderer.

## Verification

- A back-facing normal and nearby curved back normals keep the computed local up direction continuous and upright.
- Live dragging across those normals preserves the stored rotation.
- Saved placement restoration and decal generation use the same orientation helper.
- Existing personalization tests, the full test suite, and the production build pass.
