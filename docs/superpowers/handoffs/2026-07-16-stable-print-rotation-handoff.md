# Stable print rotation verification handoff

## Change

The print rotation handle now uses incremental tangential pointer movement instead of absolute pointer bearing. This removes the center-point angle discontinuity and normalizes the drag feel across pointer radii.

## Implementation

- Branch: `codex/stable-print-rotation`
- Code commit: `11a1516 fix: stabilize print rotation drag`
- Constants in `PrintToolbarOverlay.jsx`:
  - Center protection: 32px
  - Fixed sensitivity: 0.5 degrees per pixel
  - Maximum per-pointer-event delta: 24 degrees
- Preserved behavior: pointer capture, 0 through 359 degree normalization, selected-print state updates, resize controls, and click-without-movement behavior.

## Automated verification

- Focused: `npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx`
  - Result: 2 files and 16 tests passed.
- Full: `npm test`
  - Result: 18 files and 68 tests passed.
- Build: `npm run build:showcase`
  - Result: succeeded and emitted `dist/assets/index-Ba1PYqyh.js`.
  - Note: the existing Vite warning about a JavaScript bundle larger than 500 kB remained non-blocking.

## Manual release checklist

1. Drag clockwise near the text and far from the text; the same drag distance should feel comparable.
2. Drag counterclockwise at both radii; the visual direction should remain counterclockwise.
3. Move the pointer through the text center during a rotation; there must be no reverse turn or large jump.
4. Move quickly in a long stroke; each visible update should remain bounded rather than spinning abruptly.
5. Continue rotating through multiple circles and across 0/359; movement should remain continuous.
6. Release outside the original handle and press/release without moving; capture should end and rotation should remain unchanged, respectively.

## Scope limits

No changes were made to models, artwork, placement, resize behavior, design-file persistence, or Cloudflare configuration.
