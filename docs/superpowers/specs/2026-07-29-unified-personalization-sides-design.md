# Unified Personalization Sides Design

Date: 2026-07-29
Status: Approved design, pending implementation

## Goal

Allow every customer-added personalization element to be placed on either the front or back of the jersey through one consistent interaction:

- player name and number sets;
- custom text;
- preset artwork;
- uploaded artwork.

Switching sides also rotates the 3D jersey to the selected side so the customer can immediately see and continue editing the element.

## Confirmed interaction

- The selected element's editor shows a `Front / Back` control.
- Selecting `Back` moves only that element to the center of the back and rotates the jersey to the back view.
- Selecting `Front` moves only that element to the center of the front and rotates the jersey to the front view.
- After switching sides, existing drag, rotate, resize, duplicate, and delete interactions remain available.
- Other personalization elements keep their current side and placement.
- Selecting the already active side does not reset the element's current placement.

## Design

### Shared side model

Use the existing placement and region data rather than introducing a new saved-document field:

- player sets and custom text identify their side from placement position and surface normal;
- artwork continues to use its existing `region` and mesh placement;
- front and back default placements remain explicit and deterministic.

A shared side helper owns:

- supported sides (`front`, `back`);
- display labels;
- default front and back placements for print-based personalization;
- deriving the active side from a saved placement.

This prevents the player and text editors from developing different side rules.

### Personalize panel

Player sets and custom text use the same side selector.

When a player or text element changes side:

1. replace its placement with the default center placement for the selected side;
2. preserve its content, colors, font, rotation, and scale;
3. keep that element selected;
4. request the corresponding camera view.

The existing custom-text-only side selector is replaced by the shared control.

### Artwork panel

The selected preset or uploaded artwork receives the same `Front / Back` selector.

When artwork changes side:

1. patch its `region`;
2. clear its old mesh placement so the renderer projects it onto the new surface;
3. preserve its source, label, rotation, and scale;
4. keep it selected;
5. request the corresponding camera view.

New artwork remains front by default. Customers can switch it to the back after adding it.

### Camera coordination

The panels emit a side-focus request through the existing configurator page and stage boundary. The renderer moves the camera to a stable front or back preset without changing personalization data.

Side switching and camera movement are separate responsibilities:

- panels update the selected element;
- the stage controls the view;
- the renderer owns camera animation.

This keeps saved designs independent from the current viewing angle.

## Compatibility and error handling

- Existing saved designs remain valid because no document schema changes.
- Legacy placements without a surface normal derive their side from the position's Z value.
- If the garment mesh is not ready, the state still records the selected side; the existing normalization path projects the element when the model becomes available.
- If artwork projection cannot find the requested surface, it retains the selected region and does not reuse the old side's placement.
- Switching sides does not change pricing or Shopify cart properties beyond the already serialized placement data.

## Test strategy

Add failing tests before implementation for:

- player sets showing the shared side selector and moving to the back default;
- custom text continuing to use the same selector;
- selected artwork changing from front to back and clearing its old mesh placement;
- uploaded and preset artwork remaining front by default;
- side changes emitting the correct front or back camera request;
- selecting the already active side preserving the current dragged placement;
- unrelated elements remaining unchanged;
- saved-design round trips preserving front and back placements.

Run the focused component and renderer tests, the complete test suite, production builds, and browser acceptance for both desktop and mobile layouts.

## Browser acceptance

1. Add a player set, switch it to `Back`, and confirm the jersey rotates to the back with the name and number visible.
2. Drag, resize, and rotate the player set on the back.
3. Add preset and uploaded artwork, switch each to `Back`, and confirm both are visible and editable.
4. Switch each element back to `Front` and confirm the camera and element move together.
5. Confirm switching one element does not move other elements.
6. Save and reopen the design and confirm every element remains on its selected side.

## Scope boundary

This change does not add sleeve placement for print-based personalization, allow dragging through the model from one side to another, change pricing, change item limits, change the design schema, or redesign unrelated controls.
