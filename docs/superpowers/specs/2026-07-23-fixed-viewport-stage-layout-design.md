# Fixed viewport 3D stage layout design

## Goal

Keep the complete jersey centered inside the 3D stage when a shopper opens a long configuration panel such as **Template**. On wide desktop layouts, the application must remain within the first viewport while overflow belongs to the right configuration panel.

## Reproduced root cause

At a `1908 × 942` viewport:

- the Size panel produced an approximately `834px`-high stage and a `942px` document;
- opening Template increased the right panel's content height;
- the shared CSS grid row expanded to approximately `1225px`;
- the Three.js canvas followed the expanded stage through `ResizeObserver`;
- the document grew to approximately `1333px`, so the first viewport showed only the upper part of the jersey.

The Template click does not change the Three.js camera target. The visible zoom/crop is caused by the desktop layout changing the canvas dimensions and aspect ratio.

## Chosen design

For the existing wide two-column layout:

1. constrain the configurator shell to one dynamic viewport height;
2. allow the workspace and its grid row to shrink with `min-height: 0`;
3. keep overflow out of the document-level desktop layout;
4. let `.config-panel` fill the available grid height and scroll vertically inside itself;
5. keep `.stage-wrap` at the same available height when switching between Size, Template, Fabric, Print, Artwork, and Extras.

The 3D renderer continues using its existing `ResizeObserver`, camera presets, model fitting, and orbit controls. No panel-selection camera reset is added.

## Responsive boundary

The fixed-viewport behavior applies only while the application uses the wide two-column workspace.

At the existing `1040px` breakpoint and below, the workspace becomes a single column. That layout keeps normal document scrolling so the stage and configuration panel remain reachable on narrow screens. This change does not introduce a mobile drawer, overlay, or navigation redesign.

## Files and scope

Expected implementation scope:

- `src/features/configurator/ui/configurator.css`
- a focused layout contract test colocated with the configurator UI tests

No changes are planned for:

- camera position or `OrbitControls.target`;
- model scale or model center calculations;
- Template appearance state;
- Shopify cart handoff;
- production-file generation;
- Horizon launcher assets.

## Verification

Automated checks must establish that:

- the wide desktop shell is constrained to one viewport;
- workspace grid descendants can shrink;
- the right configuration panel owns vertical overflow;
- the narrow breakpoint restores document-flow behavior.

Browser acceptance at `1908 × 942` must compare Size and Template:

- document height remains equal to the viewport height;
- stage dimensions remain unchanged;
- the complete jersey stays centered in the first viewport;
- the Template panel scrolls internally;
- 3D orbit, zoom, and the three camera toolbar buttons remain operational.

Run the focused test first, then the full test suite, both production builds, and `git diff --check`.

## Rollout

After local visual acceptance, commit and push the isolated branch to both Git remotes. Deploy the verified Worker build, read back the new Worker version and asset hashes, and repeat the Size-to-Template browser check on the deployed URL.
