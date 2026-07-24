# Configurator Navigation, Personalize, and Shopify Cart Design

## Goal

Make every configurator section match a distinct shopper task, expand personalization with reusable custom-text elements, keep the 3D jersey fully visible within the desktop viewport, and make Shopify cart handoff resilient when a launch link contains an older surcharge map.

## Shopper navigation

The visible desktop navigation becomes:

1. Size
2. Design
3. Fabric
4. Personalize
5. Artwork
6. Extras

### Design owns jersey appearance

`Design` replaces the visible `Template` label and becomes the only shopper-facing owner of jersey appearance. It contains:

- pattern/template presets;
- body-zone selection;
- zone colors;
- pattern controls;
- continuous bottom-pattern controls.

The standalone Colorway sidebar entry and panel are removed. Build Summary, design review, and the stage caption also stop showing a Colorway row or label. The stage caption uses the active design/template label together with the selected fabric.

The internal `state.colorway` field and product colorway definitions remain available for saved-design compatibility. Older design documents that contain a colorway but no appearance object migrate that colorway into a valid appearance before rendering.

## Personalize section

`Personalize` replaces the visible `Print` section and combines player name/number with custom text.

### Elements-first panel

The panel starts with two primary actions:

- `+ Player set`
- `+ Text`

Below the actions, one ordered element list contains player sets and custom-text elements. Selecting an element opens its editor in the lower portion of the panel. The selected 3D decoration toolbar remains responsible for direct-manipulation actions:

- drag;
- resize;
- rotate in 45-degree steps;
- duplicate;
- delete.

This keeps element management in the panel and spatial editing on the jersey.

### Player set

The existing player-name and number behavior remains one element type and keeps its current `$18` customization charge.

### Custom text

Each custom-text element stores:

- stable element ID;
- text content;
- one of four font presets;
- fill color;
- outline enabled state;
- outline color;
- letter spacing;
- placement/surface;
- normalized position;
- scale;
- rotation.

The first release supports multiple custom-text elements. Curved text, shadows, and advanced effect sliders stay outside this scope so the editor remains compact and production rendering remains predictable.

Each custom-text element adds `$8` to the customization total. Adding, duplicating, or deleting an element updates the displayed total immediately.

### State and persistence

Custom text uses its own normalized collection rather than overloading the legacy player-name and number fields. Save/open design, undo/redo, design review, production payloads, cart properties, and validation all include the custom-text collection.

Older saved designs without the collection receive an empty collection during normalization. Cart data remains compact and references the saved design rather than embedding full design JSON or image data in Shopify line properties.

## Right-panel layout

The desktop configurator uses three vertical regions:

1. fixed panel header with the active section title;
2. independently scrolling editor content;
3. fixed checkout footer containing total price and `Review design`.

The detailed Build Summary moves into the Review dialog. The footer remains visible while long Design, Personalize, Artwork, or Extras controls scroll in the middle region.

The main document remains locked to the desktop viewport. The sidebar, 3D stage, header actions, and right-panel frame stay visible together; only the right editor content scrolls. The 3D jersey is framed and centered independently of section changes, so switching to Design or Personalize does not change the model center.

Narrow/mobile layouts may use the existing document flow and stacked controls; the viewport-lock requirement applies to the desktop builder.

## Review dialog

The Review dialog becomes the single detailed order summary. It includes:

- size;
- active design/template;
- fabric;
- player set summary;
- custom-text count and concise element labels;
- artwork count;
- extras;
- customization subtotal;
- final total.

The top price display and fixed footer use the same pricing selector as the Review dialog and Shopify cart handoff.

## Shopify cart fallback

A fresh Shopify launcher provides exact surcharge variants, including the previously verified `$62` amount. Older configurator launch pages may contain a map without one exact total.

Cart generation follows this order:

1. Use one exact surcharge variant when the map contains the customization total.
2. Otherwise, find a deterministic combination of available positive surcharge amounts that equals the customization total.
3. Prefer the fewest total surcharge units, then the fewest distinct cart lines, then larger amounts first.
4. Add each selected surcharge variant with its required quantity.
5. When no exact sum exists, show an expired-pricing message that directs the shopper to reopen the configurator from the Shopify product page.

The base jersey remains one cart line. Compact configuration properties attach to the jersey line; surcharge lines contain only the identifiers needed for price reconciliation.

## Error handling

- Empty custom text is kept editable in the builder but excluded from the review count, price, production output, and cart summary until it contains visible text.
- Invalid font/color/transform fields normalize to documented defaults and surface a validation issue during design import.
- A deleted selected element clears the selection and returns focus to the element list.
- Missing surcharge mappings produce the pricing-refresh message before any cart navigation occurs.

## Verification

### Navigation and layout

- The sidebar contains the six confirmed shopper sections.
- No visible Colorway control or stale Colorway summary remains.
- Design is the only visible jersey-appearance editor.
- The desktop document has no vertical page scroll at supported viewport sizes.
- Long right-panel content scrolls while its header and checkout footer remain fixed.
- Switching sections keeps the complete 3D jersey centered.

### Personalize

- Player sets and custom text share one ordered element list.
- Multiple custom-text elements render independently.
- Text content, four font presets, fill, outline, letter spacing, placement, position, scale, and rotation persist through save/open.
- Duplicate and delete update selection, render state, undo/redo, and price.
- Every non-empty custom-text element adds exactly `$8`; the player set remains `$18`.
- Older saved designs still open with an empty custom-text collection.

### Cart

- An exact `$62` map produces one surcharge line.
- A map without `$62` but containing `$50` and `$12` produces two surcharge lines totaling `$62`.
- Repeated surcharge units use line quantity correctly.
- A map with no valid sum produces the pricing-refresh message.
- A real Shopify cart shows the same total as the configurator Review dialog.

### Release

- Unit, integration, and UI tests pass.
- Production builds pass.
- Cloudflare deployment is read back.
- Real storefront launch and Shopify cart acceptance are recorded separately.
