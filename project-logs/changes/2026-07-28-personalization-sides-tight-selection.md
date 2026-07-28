# 2026-07-28 Personalization sides and tight selection frame

## Goal

- Allow each custom text item to be placed on either the front or back of the jersey.
- Make the selected text/player-set frame follow the visible pixels instead of the full transparent texture plane.
- Keep the frame accurate after the print is projected onto the curved jersey surface.

## Changes

- Added a Side control to the custom text editor with Front and Back choices.
- Front placement uses a positive Z surface normal; back placement uses a negative Z surface normal.
- Selection projection now crops to the texture alpha bounds.
- When a print is rendered as a curved decal, the frame is calculated from UV-clipped decal triangles rather than the hidden flat editing plane.

## Verification

- Added UI regression coverage for moving selected custom text between front and back defaults.
- Added renderer regression coverage for transparent texture bounds and curved decal projection.
- Full test suite: 56 files, 626 tests passed.
- Production builds passed for both the standalone app and Shopify bundle.
- Browser acceptance covered player-set frame sizing, back text visibility, back-frame fit at an oblique angle, and switching the text back to Front.

## Notes

- The side switch changes the print surface; customers rotate the 3D model to inspect the selected side.
- Existing build-size warnings remain unchanged.
