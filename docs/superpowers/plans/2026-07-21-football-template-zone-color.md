# Football Template And Zone Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six football-shirt templates and six independently editable color zones rendered through the current Chelsea jersey model UV layout, while preserving editing, history, and local design-file behavior.

**Architecture:** Appearance data is persisted under `state.overrides.appearance`. A Canvas-backed `CanvasTexture` renders template and zone colors onto the verified garment UV atlas. React controls update normalized state only; `GarmentRenderer` owns texture lifecycle and supplies the number-zone color to the existing Name set layer.

**Tech Stack:** React 19, Three.js `CanvasTexture`, Vite, Vitest, Testing Library, current GLB UV asset.

---

## File map

| File | Responsibility |
| --- | --- |
| `scripts/verify-garment-uv.mjs` | Verifies every GLB primitive exposes `TEXCOORD_0`. |
| `src/features/configurator/config/appearance.js` | Template, zone, palette, migration, normalization, validation. |
| `src/features/configurator/scene/garmentAppearanceTexture.js` | Canvas texture generation against the UV atlas. |
| `src/features/configurator/ui/TemplateLibrary.jsx` | Template picker. |
| `src/features/configurator/ui/ZoneColorPanel.jsx` | Zone and palette picker. |
| Existing state, design document, renderer, page, review, CSS and test files | State integration, rendering, UI, regression coverage. |

## Task 1: Establish a checked UV baseline

**Files:**
- Create: `scripts/verify-garment-uv.mjs`

- [ ] **Step 1: Add the verifier**

```js
import { readFile } from 'node:fs/promises';

const glb = await readFile(new URL('../public/models/chelsea-jersey.glb', import.meta.url));
const jsonLength = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').trim());
const primitives = json.meshes.flatMap((mesh) => mesh.primitives ?? []);
const missingUv = primitives.filter((primitive) => primitive.attributes?.TEXCOORD_0 === undefined);
if (!primitives.length || missingUv.length) throw new Error(`Garment UV verification failed: ${missingUv.length} primitives have no TEXCOORD_0.`);
console.log(`Garment UV verification passed: ${primitives.length} primitives expose TEXCOORD_0.`);
```

- [ ] **Step 2: Execute it before implementation**

Run: `node scripts/verify-garment-uv.mjs`

Expected: `Garment UV verification passed: 19 primitives expose TEXCOORD_0.` If this fails, stop and report the model blocker instead of approximating zones from material index.

- [ ] **Step 3: Verify atlas placement in the local preview**

Run: `npm run dev`

Expected: confirm the existing atlas separates front, back, sleeves, collar, and side/shoulder pieces. Capture this in the change log; do not modify the GLB.

- [ ] **Step 4: Commit**

```powershell
git add scripts/verify-garment-uv.mjs
git commit -m "chore: verify garment UV availability"
```

## Task 2: Implement normalized appearance state and legacy migration

**Files:**
- Create: `src/features/configurator/config/appearance.js`
- Create: `src/features/configurator/config/appearance.test.js`
- Modify: `src/features/configurator/config/state.js`
- Modify: `src/features/configurator/config/state.test.js`
- Modify: `src/features/configurator/config/productDefinitions.js`
- Modify: `src/features/configurator/config/selectors.js`
- Modify: `src/features/configurator/designs/designDocument.js`
- Modify: `src/features/configurator/designs/designDocument.test.js`

- [ ] **Step 1: Add failing appearance tests**

```js
expect(FOOTBALL_TEMPLATES.map((template) => template.id)).toEqual([
  'solid', 'vertical-stripes', 'horizontal-stripes', 'diagonal', 'gradient', 'color-block',
]);
expect(normalizeAppearance(undefined, { fabric: '#ffffff', trim: '#20242a', accent: '#d8c17a', number: '#20242a' }))
  .toEqual({ textureVersion: 1, templateId: 'solid', colors: {
    body: '#FFFFFF', sleeves: '#FFFFFF', shoulderSide: '#20242A', collar: '#20242A', pattern: '#D8C17A', number: '#20242A',
  } });
expect(() => normalizeAppearance({ colors: { body: 'red' } })).toThrow('Appearance color body must be a six-digit hex color.');
```

- [ ] **Step 2: Confirm the tests fail**

Run: `npm test -- --run src/features/configurator/config/appearance.test.js`

Expected: FAIL because the module has not been created.

- [ ] **Step 3: Create `appearance.js`**

```js
export const APPEARANCE_TEXTURE_VERSION = 1;
export const ZONE_DEFINITIONS = [
  { id: 'body', label: 'Body' }, { id: 'sleeves', label: 'Sleeves' },
  { id: 'shoulderSide', label: 'Shoulder / side panels' }, { id: 'collar', label: 'Collar' },
  { id: 'pattern', label: 'Pattern color' }, { id: 'number', label: 'Name and number' },
];
export const FOOTBALL_TEMPLATES = [
  { id: 'solid', label: 'Solid' }, { id: 'vertical-stripes', label: 'Vertical stripes' },
  { id: 'horizontal-stripes', label: 'Horizontal stripes' }, { id: 'diagonal', label: 'Diagonal' },
  { id: 'gradient', label: 'Gradient' }, { id: 'color-block', label: 'Color block' },
];
```

Implement `normalizeAppearance(appearance, legacySwatches)` to use the exact defaults tested above, reject non-`/^#[0-9a-f]{6}$/i` colors, uppercase valid values, and use `solid` for an unknown template ID. Export a fixed approved `APPEARANCE_COLOR_PALETTE` of six-digit hex colors.

- [ ] **Step 4: Make appearance patches merge safely**

Update `mergeConfiguratorState` so an `overrides.appearance.colors` patch preserves every unspecified zone:

```js
appearance: patch.overrides?.appearance
  ? { ...current.overrides?.appearance, ...patch.overrides.appearance,
      colors: { ...current.overrides?.appearance?.colors, ...patch.overrides.appearance.colors } }
  : current.overrides?.appearance,
```

Add a state test patching `{ colors: { sleeves: '#FFCC00' } }` and asserting that `body` remains unchanged.

- [ ] **Step 5: Add defaults, selector data, and document migration**

Add the `templates` option label and default normalized appearance to `jerseyProduct.defaultState.overrides`. Add `selected.appearance` through `selectedOptions`. In `parseDesignDocument`, normalize document appearance with the loaded colorway swatches; a missing appearance must migrate, an invalid explicit color must throw `DesignDocumentError('invalid-state', ...)`, and import must not call `setHistory` after the failure.

- [ ] **Step 6: Verify focused tests**

Run: `npm test -- --run src/features/configurator/config/appearance.test.js src/features/configurator/config/state.test.js src/features/configurator/designs/designDocument.test.js`

Expected: PASS; old saved files obtain the legacy colorway defaults and new files round-trip all six colors.

- [ ] **Step 7: Commit**

```powershell
git add src/features/configurator/config/appearance.js src/features/configurator/config/appearance.test.js src/features/configurator/config/state.js src/features/configurator/config/state.test.js src/features/configurator/config/productDefinitions.js src/features/configurator/config/selectors.js src/features/configurator/designs/designDocument.js src/features/configurator/designs/designDocument.test.js
git commit -m "feat: persist football appearance state"
```

## Task 3: Render the six templates using the garment UV atlas

**Files:**
- Create: `src/features/configurator/scene/garmentAppearanceTexture.js`
- Create: `src/features/configurator/scene/garmentAppearanceTexture.test.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: Add failing texture-render tests**

```js
const context = createRecordingContext();
renderGarmentAppearance(context, { width: 2048, height: 2048 }, appearance);
expect(context.calls).toContainEqual(['fillRect', 0, 0, 2048, 2048]);
expect(context.calls.some(([name]) => name === 'clip')).toBe(true);
expect(() => renderGarmentAppearance(context, { width: 0, height: 2048 }, appearance))
  .toThrow('Appearance texture requires a positive width and height.');
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- --run src/features/configurator/scene/garmentAppearanceTexture.test.js`

Expected: FAIL because the texture module is missing.

- [ ] **Step 3: Implement the canvas texture generator**

Create `createGarmentAppearanceCanvas(size = 2048)` and `renderGarmentAppearance(context, size, appearance)`. Define normalized polygon sets for the inspected atlas: `bodyFront`, `bodyBack`, `sleeves`, `shoulderSide`, and `collar`. Every region must use `beginPath`, `lineTo`, `closePath`, and `clip` before painting.

```js
const templatePainters = {
  solid: paintSolid,
  'vertical-stripes': paintVerticalStripes,
  'horizontal-stripes': paintHorizontalStripes,
  diagonal: paintDiagonal,
  gradient: paintGradient,
  'color-block': paintColorBlock,
};
paintRegion(context, UV_REGIONS.bodyFront, appearance.colors.body, () => templatePainters[appearance.templateId](context, FRONT_BOUNDS, appearance));
paintRegion(context, UV_REGIONS.bodyBack, appearance.colors.body, () => templatePainters[appearance.templateId](context, BACK_BOUNDS, appearance));
paintRegion(context, UV_REGIONS.sleeves, appearance.colors.sleeves);
paintRegion(context, UV_REGIONS.shoulderSide, appearance.colors.shoulderSide);
paintRegion(context, UV_REGIONS.collar, appearance.colors.collar);
```

Template painters may use only `body` and `pattern`; sleeves, shoulder/side panels, and collar must retain their independent selected colors.

- [ ] **Step 4: Add renderer lifecycle tests**

```js
renderer.update(product, stateWithAppearance, selectedWithAppearance);
expect(renderer.appearanceTexture).toBeInstanceOf(THREE.CanvasTexture);
expect(renderer.modelMaterials.every((material) => material.map === renderer.appearanceTexture)).toBe(true);
const previousTexture = renderer.appearanceTexture;
renderer.update(product, changedState, changedSelected);
expect(previousTexture.dispose).toHaveBeenCalledOnce();
expect(renderer.printColor).toBe('#FFCC00');
```

- [ ] **Step 5: Replace index-based color application**

Replace `applyColors(selected.colorway.swatches)` with `applyAppearance(selected.appearance)`. It creates a `THREE.CanvasTexture`, sets `colorSpace = THREE.SRGBColorSpace` and `flipY = false`, assigns the texture to cloned garment materials, sets `material.needsUpdate = true`, updates background from `appearance.colors.body`, and sets `this.printColor = appearance.colors.number`. Add `disposeAppearanceTexture()` before replacements and inside `dispose()`.

- [ ] **Step 6: Verify renderer behavior**

Run: `npm test -- --run src/features/configurator/scene/garmentAppearanceTexture.test.js src/features/configurator/scene/garmentRenderer.test.js`

Expected: PASS for all six painters, texture replacement/disposal, and Name set color synchronization.

- [ ] **Step 7: Commit**

```powershell
git add src/features/configurator/scene/garmentAppearanceTexture.js src/features/configurator/scene/garmentAppearanceTexture.test.js src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "feat: render football templates on garment UVs"
```

## Task 4: Provide accessible template and color controls

**Files:**
- Create: `src/features/configurator/ui/TemplateLibrary.jsx`
- Create: `src/features/configurator/ui/TemplateLibrary.test.jsx`
- Create: `src/features/configurator/ui/ZoneColorPanel.jsx`
- Create: `src/features/configurator/ui/ZoneColorPanel.test.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css`

- [ ] **Step 1: Add failing template and color tests**

```jsx
render(<TemplateLibrary activeTemplateId="solid" onSelect={onSelect} templates={FOOTBALL_TEMPLATES} />);
fireEvent.click(screen.getByRole('button', { name: 'Vertical stripes' }));
expect(onSelect).toHaveBeenCalledWith('vertical-stripes');
render(<ZoneColorPanel colors={colors} onChange={onChange} palette={APPEARANCE_COLOR_PALETTE} zones={ZONE_DEFINITIONS} />);
fireEvent.click(screen.getByRole('button', { name: 'Sleeves' }));
fireEvent.click(screen.getByRole('button', { name: 'Select #FFCC00' }));
expect(onChange).toHaveBeenCalledWith({ sleeves: '#FFCC00' });
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- --run src/features/configurator/ui/TemplateLibrary.test.jsx src/features/configurator/ui/ZoneColorPanel.test.jsx`

Expected: FAIL because both components are missing.

- [ ] **Step 3: Implement stateless controls**

`TemplateLibrary` renders six buttons with `aria-pressed` and CSS-only previews named `template-preview--${template.id}`. `ZoneColorPanel` stores only `activeZoneId`, renders the current zone color, and emits `{ [activeZoneId]: color }`; it never mutates the supplied `colors` object.

- [ ] **Step 4: Wire the controls into page state and history**

Insert `{ id: 'templates', label: 'Templates', icon: PanelsTopLeft }` between Color and Fabric. Render both controls for the Templates section and use:

```js
const patchAppearance = (patch) => updateState({
  overrides: { appearance: { ...selected.appearance, ...patch, colors: { ...selected.appearance.colors, ...patch.colors } } },
});
```

Page tests must choose Vertical stripes, set Sleeves to `#FFCC00`, undo the sleeve change, and assert Vertical stripes remains active. Preserve existing Artwork and Print tests.

- [ ] **Step 5: Add focused responsive styles**

Use a two-column `.template-library` above 720px and one column below 720px. Add `.zone-color-panel`, `.zone-color-button`, and `.appearance-palette` using existing color variables. Selected template, zone, palette option, and keyboard focus must be visible. Do not change Artwork or Print styles.

- [ ] **Step 6: Verify UI tests**

Run: `npm test -- --run src/features/configurator/ui/TemplateLibrary.test.jsx src/features/configurator/ui/ZoneColorPanel.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx`

Expected: PASS with template/zone changes in history and no existing UI regressions.

- [ ] **Step 7: Commit**

```powershell
git add src/features/configurator/ui/TemplateLibrary.jsx src/features/configurator/ui/TemplateLibrary.test.jsx src/features/configurator/ui/ZoneColorPanel.jsx src/features/configurator/ui/ZoneColorPanel.test.jsx src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/ui/configurator.css
git commit -m "feat: add template and zone color controls"
```

## Task 5: Review summary, full verification, and handoff

**Files:**
- Modify: `src/features/configurator/ui/DesignReviewDialog.jsx`
- Modify: `src/features/configurator/ui/DesignReviewDialog.test.jsx`
- Create: `project-logs/changes/2026-07-21-football-template-zone-color.md`

- [ ] **Step 1: Add the failing review test**

```jsx
expect(screen.getByText('Vertical stripes')).toBeInTheDocument();
expect(screen.getByText('Body: #FFFFFF')).toBeInTheDocument();
expect(screen.getByText('Name and number: #FFCC00')).toBeInTheDocument();
```

- [ ] **Step 2: Confirm failure**

Run: `npm test -- --run src/features/configurator/ui/DesignReviewDialog.test.jsx`

Expected: FAIL because appearance is not currently summarized.

- [ ] **Step 3: Implement the review rows**

Pass selected appearance and template label to the dialog. Render one Template row and six color rows in the existing `dl`. Do not add Shopify, cart, shipping, or backend claims.

- [ ] **Step 4: Write the change log**

Record the date, six-template/six-zone scope, UV verifier result, all verification commands, retained no-Shopify boundary, and any UV atlas finding.

- [ ] **Step 5: Run full verification**

Run:

```powershell
node scripts/verify-garment-uv.mjs
npm test
npm run build:showcase
git diff --check
```

Expected: every command succeeds. The known Vite chunk-size warning is non-blocking only with exit code 0.

- [ ] **Step 6: Run manual acceptance checks**

Run: `npm run dev`

Verify all six templates; each zone; front/back/sleeve continuity; name/number color; undo/redo; save/open round-trip; Artwork drag/delete/list-focus/camera-focus; Name set edit/copy/delete/rotate/scale; desktop and narrow-screen layouts.

- [ ] **Step 7: Commit and prepare integration report**

```powershell
git add src/features/configurator/ui/DesignReviewDialog.jsx src/features/configurator/ui/DesignReviewDialog.test.jsx project-logs/changes/2026-07-21-football-template-zone-color.md
git commit -m "docs: verify football template zone colors"
```

Before requesting merge, confirm the main worktree still retains its pre-existing `package-lock.json` and `.superpowers/` changes untouched. Merge into `showcase` and push `origin` plus `backup` only after explicit user confirmation.
