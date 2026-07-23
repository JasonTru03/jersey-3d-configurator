# Remove Colorway Menu and Harden Shopify Cart Design

## Goal

Remove the redundant standalone Colorway menu so every visible configurator section has a distinct shopper purpose, and make Shopify cart handoff tolerate an older launch link that lacks one exact surcharge amount.

## Navigation and color ownership

The visible navigation becomes:

1. Size
2. Template
3. Fabric
4. Print
5. Artwork
6. Extras

Template is the only visible owner of jersey appearance. It continues to provide pattern templates, zone selection, zone colors, and the continuous bottom-pattern controls.

The Colorway panel, sidebar entry, build-summary row, review row, and stage caption label are removed. The stage caption uses the active template label with the selected fabric.

The internal `state.colorway` field and product colorway definitions remain for saved-design compatibility and migration of old files that do not contain an appearance object. Removing the menu must not invalidate older design documents.

Print remains the home for player name and number. A future arbitrary-text feature should extend Print rather than add another navigation section.

## Shopify cart fallback

The fresh Shopify launcher already provides an exact `$62` surcharge variant and has been verified with a real `$151` cart. The reported error came from an older configurator page whose launch map lacked that exact amount.

Cart generation follows this order:

1. Use one exact surcharge variant when the map contains the customization total.
2. Otherwise, find a deterministic combination of available positive surcharge amounts that equals the customization total.
3. Prefer the fewest total surcharge units, then the fewest distinct cart lines, then larger amounts first.
4. Emit each selected surcharge variant with its required quantity in the cart permalink.
5. If no exact sum exists, show an explicit expired-pricing message directing the shopper to reopen the configurator from the Shopify product page.

The base jersey remains one cart line. Cart properties remain attached only to the jersey line and continue to exclude full design JSON, image data, and credentials.

## Verification

- The sidebar contains six distinct shopper sections and no Colorway button.
- Template changes remain the sole visible source of jersey colors.
- Old saved designs with only `colorway` still migrate to a valid appearance.
- Build Summary, design review, and stage caption do not show a stale Colorway label.
- An exact `$62` map produces one surcharge line.
- A map without `$62` but containing `$50` and `$12` produces two surcharge lines totaling `$62`.
- A map with no valid sum produces the explicit pricing-refresh error.
- Full tests, production builds, Cloudflare deployment, and real Shopify cart acceptance pass.
