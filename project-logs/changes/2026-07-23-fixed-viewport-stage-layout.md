# Fixed viewport 3D stage layout

## Date

2026-07-23

## Reported behavior

Opening **Template** made the jersey appear enlarged and shifted so only the upper half was visible in the first screen.

## Root cause

The Template click did not change the Three.js camera position or `OrbitControls.target`.

At a `1908 × 942` viewport before the fix:

| State | Document height | Stage size |
| --- | ---: | ---: |
| Size | 942px | 1224 × 834px |
| Template | 1333px | 1209 × 1225px |

The long right-panel content enlarged the shared CSS grid row. `ResizeObserver` then resized the canvas to the new row dimensions, changing its aspect ratio and leaving the lower jersey outside the first viewport.

## Change

- constrain the wide `.configurator-shell` to `100dvh`;
- propagate `min-height: 0` and hidden document-level overflow through the desktop workspace grid;
- keep `.stage-wrap` within the available row;
- assign vertical overflow to `.config-panel`;
- restore normal document flow and stage minimum height at the existing `1040px` single-column breakpoint.

No camera, model-fit, Template state, cart, production-file, or Shopify launcher logic changed.

## TDD evidence

The focused CSS contract first failed with:

```text
expected .configurator-shell to contain height: 100dvh
expected the 1040px rule to contain height: auto
```

After the minimal CSS change:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
```

## Local browser acceptance

At `1908 × 942` after the fix:

| State | Document height | Stage size | Panel client/scroll height |
| --- | ---: | ---: | ---: |
| Size | 942px | 1224 × 834px | 832 / 832px |
| Template | 942px | 1224 × 834px | 832 / 1223px |

Results:

- document-height delta: `0px`;
- stage-width delta: `0px`;
- stage-height delta: `0px`;
- the complete jersey stayed centered in the first viewport;
- scrolling the Template panel moved its `scrollTop` to `391px` while document `scrollY` stayed `0`;
- Orbit, Top, and Detail buttons each became active when selected;
- mouse orbit and wheel zoom kept the document at `942px` and the stage at `1224 × 834px`.

At `1000 × 900`, the existing single-column breakpoint restored normal page flow:

- document height: `1377px`;
- workspace overflow: `visible`;
- stage minimum height: `560px`;
- configuration panel overflow: `visible`.

## Files

- `src/features/configurator/ui/configurator.css`
- `src/features/configurator/ui/configuratorLayout.test.js`
- `docs/superpowers/specs/2026-07-23-fixed-viewport-stage-layout-design.md`
- `docs/superpowers/plans/2026-07-23-fixed-viewport-stage-layout.md`

## Repository verification

- full suite: 37 test files, 221 tests passed;
- application build: `index-DIllFYjy.js`, 985.83 kB, gzip 274.91 kB;
- application CSS: `index-DQwU5ICW.css`, 14.78 kB, gzip 3.51 kB;
- Shopify build: 1,348.32 kB, gzip 381.14 kB;
- `git diff --check`: passed;
- existing large-chunk and `inlineDynamicImports` warnings remain non-blocking.
