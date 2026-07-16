# Stable print rotation design

## Goal

Make the selected-print rotation handle feel consistent for shoppers: clockwise motion rotates the print clockwise, identical drag distances feel similar at different radii, and neither slow nor fast movement can reverse direction or create a sudden large turn.

## Root cause

The current implementation derives every update from the pointer's absolute bearing around the print center. Bearing is undefined at the center and changes abruptly when the pointer crosses it. It also maps the same pixel distance to different angle changes depending on pointer radius.

## Chosen interaction

Keep the circular rotate handle but calculate rotation from incremental tangential pointer movement:

1. On pointer down, store the pointer position and the handle-to-center direction.
2. On every pointer move, project the pointer delta onto the clockwise tangent of the last stable radial direction.
3. Convert that signed tangent distance using a fixed sensitivity of 0.5 degrees per pixel, subtract it from stored rotation so clockwise screen motion remains clockwise visually, then normalize to 0 through 359 degrees.
4. When the pointer is within a 32 pixel center-protection radius, retain the last stable radial direction instead of recalculating an unstable bearing.
5. Limit a single pointer event to 24 degrees before applying it, preventing dropped or fast events from producing a large visible jump.

## Scope

- Replace only the rotation-delta calculation in `PrintToolbarOverlay`.
- Add regression tests for a near-center crossing and a large single pointer move.
- Preserve pointer capture, click-without-movement behavior, selected-print controls, state persistence, scaling, and the existing 0 through 359 degree storage range.

## Out of scope

- No changes to print placement, resize behavior, product models, artwork, design-file persistence, or Cloudflare configuration.

## Validation

1. A clockwise tangent movement from different radii emits the same rotation increment.
2. Crossing the protected center area does not reverse the last established direction.
3. A large pointer movement never produces more than 24 degrees in one update.
4. Existing full-circle, wraparound, click-without-movement, and ProductStage state-persistence tests remain valid.
