# UV 裁片生产图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留可回贴模型的原始 UV Atlas 的同时，生成按真实 UV seam 分组、至少包含正片和背片的工厂裁片 PNG。

**Architecture:** 先为每个支持模型声明经过真实 GLB 验证的 UV seam 裁片组，再让实时外观和生产导出共用模型感知的基础 UV 绘制。生产导出完成原始 Atlas 后，按 seam 组提取、转正、留间距并生成 `uv-pattern-pieces.png`；生产包、PDF、Manifest 和 verifier 全部升级为七文件契约。

**Tech Stack:** React 19, Three.js 0.185, Canvas 2D, Vitest, Vite, Wrangler.

---

### Task 1: 建立模型 UV seam 裁片配置

**Files:**
- Create: `src/features/configurator/config/modelUvLayouts.js`
- Create: `src/features/configurator/config/modelUvLayouts.test.js`
- Modify: `src/features/configurator/config/productDefinitions.js`

- [ ] **Step 1: Write the failing layout contract test**

在 `modelUvLayouts.test.js` 中先写以下契约：

```js
import { describe, expect, it } from 'vitest';
import { getModelUvLayout, validateModelUvLayout } from './modelUvLayouts.js';

describe('model UV seam layouts', () => {
  it('exposes at least front and back groups for every supported model', () => {
    for (const model of [
      { id: 'chelsea-jersey', version: '1' },
      { id: 'fn8788-jersey', version: '1' },
    ]) {
      const layout = getModelUvLayout(model);
      expect(layout.pieceGroups.map(({ id }) => id)).toEqual(
        expect.arrayContaining(['front', 'back']),
      );
    }
  });

  it('rejects a layout without the two-piece minimum', () => {
    expect(() => validateModelUvLayout({
      version: 1,
      pieceGroups: [{ id: 'front', islandRefs: [{ meshName: 'missing' }] }],
    }, [])).toThrow('正片和背片');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing module failure**

Run:

```powershell
npx vitest run src/features/configurator/config/modelUvLayouts.test.js
```

Expected: FAIL because the layout module and product metadata do not exist.

- [ ] **Step 3: Inspect both GLBs and record stable seam groups**

Use the existing real-model loader in `src/features/configurator/scene/productionAtlasBakerGarmentModels.test.js` to enumerate each mesh’s UV triangles, 3D adjacency edges, UV discontinuities and duplicate UV signatures. Record only verified groups:

- `front` and `back` are mandatory;
- sleeves, collar and side panels are separate only when a UV seam/asset boundary is confirmed;
- duplicate inner/outer surfaces share one `duplicateGroup`;
- orientation is explicit `rotation`/`mirrorX`, never inferred from generic mesh numbering at runtime.

Add the resulting stable `islandRefs`, labels and transform values to `MODEL_UV_LAYOUTS`. Do not use guessed labels when the GLB does not expose a seam.

- [ ] **Step 4: Implement the smallest layout API**

Implement:

```js
export const MODEL_UV_LAYOUTS = Object.freeze({
  'chelsea-jersey@1': Object.freeze({ version: 1, pieceGroups: [] }),
  'fn8788-jersey@1': Object.freeze({ version: 1, pieceGroups: [] }),
});

export function getModelUvLayout(model) {
  const key = `${model?.id}@${model?.version}`;
  const layout = MODEL_UV_LAYOUTS[key];
  if (!layout) throw new Error(`模型 "${key}" 缺少 UV 裁片配置。`);
  return layout;
}

export function validateModelUvLayout(layout, meshes) {
  const ids = new Set((layout?.pieceGroups ?? []).map(({ id }) => id));
  if (!ids.has('front') || !ids.has('back')) {
    throw new Error('模型 UV 裁片配置必须至少包含正片和背片。');
  }
  const available = new Set((meshes ?? []).map((mesh) => mesh.name));
  for (const group of layout.pieceGroups) {
    for (const island of group.islandRefs ?? []) {
      if (island.meshName && !available.has(island.meshName)) {
        throw new Error(`UV 裁片 "${group.id}" 找不到网格 "${island.meshName}"。`);
      }
    }
  }
  return true;
}
```

用真实记录替换示例空数组，并让 `productDefinitions.js` 的两个模型声明 `uvExportLayoutId`。

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npx vitest run src/features/configurator/config/modelUvLayouts.test.js
```

Expected: all layout contract tests PASS, including the real Chelsea/FN8788 two-piece minimum.

```powershell
git add src/features/configurator/config/modelUvLayouts.js src/features/configurator/config/modelUvLayouts.test.js src/features/configurator/config/productDefinitions.js
git commit -m "feat: define model uv seam piece layouts"
```

### Task 2: Make the base appearance atlas follow real model UV

**Files:**
- Modify: `src/features/configurator/scene/garmentAppearanceTexture.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentAppearanceTexture.test.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: Add a failing model-UV appearance test**

Extend the appearance test harness with a fake mesh containing one UV triangle and assert that model-aware rendering clips a solid zone to the triangle instead of drawing the legacy fixed polygon:

```js
it('paints appearance only inside configured garment UV triangles', () => {
  const context = createRecordingContext();
  renderGarmentAppearance(context, { width: 128, height: 128 }, appearance, {
    modelMeshes: [meshWithUvTriangle],
    uvLayout: frontBackLayout,
  });
  expect(context.clip).toHaveBeenCalled();
  expect(context.fillRect).not.toHaveBeenCalledWith(0, 0, 128, 128);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentAppearanceTexture.test.js -t "configured garment UV triangles"
```

Expected: FAIL because `renderGarmentAppearance` currently accepts only the legacy fixed UV regions.

- [ ] **Step 3: Add the model-aware render path without removing legacy unit coverage**

Extend the existing function signature:

```js
export function createGarmentAppearanceCanvas(
  size = 2048,
  appearance = { template: 'solid', colors: {} },
  { modelMeshes = [], uvLayout = null } = {},
) {
  // create canvas/context as today
  if (modelMeshes.length && uvLayout) {
    renderModelUvAppearance(context, canvas, appearance, modelMeshes, uvLayout);
  } else {
    renderGarmentAppearance(context, canvas, appearance);
  }
  return canvas;
}
```

`renderModelUvAppearance` must iterate only configured seam islands, clip each UV triangle, select the group’s `zone`, and call the existing template painter. The fallback remains only for model-less legacy tests and must not be used by production export after a model is ready.

- [ ] **Step 4: Pass model meshes/layout through the renderer**

In `GarmentRenderer`, store the loaded model’s UV layout next to `this.modelMeshes`, include the layout key in the appearance texture cache key, and call:

```js
createGarmentAppearanceCanvas(2048, appearance, {
  modelMeshes: this.patternMeshes,
  uvLayout: this.modelUvLayout,
});
```

Use the same arguments in `prepareProductionArtifacts` at `model.uvAtlasSize`. When the model finishes loading, force one appearance texture rebuild so an earlier legacy fallback cannot remain cached.

- [ ] **Step 5: Run renderer and appearance tests and commit**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentAppearanceTexture.test.js src/features/configurator/scene/garmentRenderer.test.js
```

Expected: all existing appearance/renderer tests plus the model-UV clipping regression PASS.

```powershell
git add src/features/configurator/scene/garmentAppearanceTexture.js src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentAppearanceTexture.test.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "fix: paint base appearance on real garment uv"
```

### Task 3: Extract and re-layout seam groups into a factory PNG

**Files:**
- Create: `src/features/configurator/scene/uvPatternPieces.js`
- Create: `src/features/configurator/scene/uvPatternPieces.test.js`

- [ ] **Step 1: Write failing extraction tests**

Cover:

```js
it('extracts front and back seam groups with transparent gaps', async () => {
  const result = await createUvPatternPieces({
    atlasCanvas: atlasWithKnownColors,
    atlasSize: 64,
    meshes: [frontMesh, backMesh],
    uvLayout: frontBackLayout,
  });
  expect(result.width).toBe(4096);
  expect(result.height).toBe(4096);
  expect(result.pieces.map(({ id }) => id)).toEqual(['front', 'back']);
  expect(result.blob.type).toBe('image/png');
});

it('rejects a seam group with no mapped triangle', async () => {
  await expect(createUvPatternPieces({
    atlasCanvas,
    atlasSize: 64,
    meshes: [],
    uvLayout: frontBackLayout,
  })).rejects.toThrow('裁片');
});
```

- [ ] **Step 2: Run the focused tests and confirm the missing module failure**

Run:

```powershell
npx vitest run src/features/configurator/scene/uvPatternPieces.test.js
```

Expected: FAIL because the extraction module does not exist.

- [ ] **Step 3: Implement seam-group extraction**

Implement:

```js
export async function createUvPatternPieces({
  atlasCanvas,
  atlasSize,
  meshes,
  uvLayout,
  yieldControl = yieldToBrowser,
}) {
  validateModelUvLayout(uvLayout, meshes);
  const pieces = buildUniquePieceGroups(uvLayout, meshes);
  const canvas = document.createElement('canvas');
  const outputSize = 4096;
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, outputSize, outputSize);
  for (const piece of pieces) {
    await drawPieceGroup(context, atlasCanvas, atlasSize, outputSize, piece, yieldControl);
  }
  const blob = await canvasToPngBlob(canvas);
  return { blob, canvas, width: outputSize, height: outputSize, pieces };
}
```

`drawPieceGroup` maps the source UV triangle to the configured local output rectangle, applies only the explicit rotation/mirror, clips to that triangle, preserves transparent pixels, and yields between bounded triangle batches. Duplicate groups are rendered once. Every piece must report nonzero mapped coverage.

- [ ] **Step 4: Add orientation, gap, and coverage assertions**

Assert that output rectangles do not overlap, each group’s nontransparent pixel count is greater than zero, and the transparent gap between groups is preserved. Add a deterministic fingerprint of piece order and transforms so future model metadata changes fail loudly.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npx vitest run src/features/configurator/scene/uvPatternPieces.test.js
```

Expected: all extraction, orientation, transparency and error tests PASS.

```powershell
git add src/features/configurator/scene/uvPatternPieces.js src/features/configurator/scene/uvPatternPieces.test.js
git commit -m "feat: generate seam-based uv pattern pieces"
```

### Task 4: Expand the production package and PDF contract

**Files:**
- Modify: `src/features/configurator/designs/productionPackage.js`
- Modify: `src/features/configurator/designs/productionPackage.test.js`
- Modify: `src/features/configurator/designs/productionManifest.js`
- Modify: `src/features/configurator/designs/productionManifest.test.js`
- Modify: `src/features/configurator/designs/productionReferencePdf.js`
- Modify: `src/features/configurator/designs/productionReferencePdf.test.js`
- Modify: `src/features/configurator/designs/productionBundle.test.js`

- [ ] **Step 1: Change package tests to require seven files**

Update the exact filename contract to:

```js
expect(files.map(({ filename }) => filename)).toEqual([
  'design.json',
  'uv-atlas.png',
  'uv-pattern-pieces.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
  'manifest.json',
]);
```

Add tests that the manifest records both PNG hashes and the seam piece list, and that PDF input uses `rendered.pieces.canvas` for page 2.

- [ ] **Step 2: Run focused package tests and confirm the expected six/seven-file failure**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionPackage.test.js src/features/configurator/designs/productionManifest.test.js src/features/configurator/designs/productionReferencePdf.test.js
```

Expected: FAIL because the existing package only creates one PNG Atlas and the PDF still receives it.

- [ ] **Step 3: Add the pieces artifact to package orchestration**

Extend the renderer artifact contract with `pieces`, require it in `assertImageContract`, create `uv-pattern-pieces.png` before the PDF, and include its dimensions/piece metadata in `createProductionManifest`. Keep `releaseRenderedCanvases` clearing the new canvas in the existing `finally` block.

- [ ] **Step 4: Update PDF page 2 and manifest validation**

Change `toPdfInput`/`drawAtlasPage` to receive and draw `pieces` while retaining the raw Atlas in the ZIP. Extend manifest file/hash verification to both PNGs and validate that every declared piece has positive coverage and a stable source group.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionPackage.test.js src/features/configurator/designs/productionManifest.test.js src/features/configurator/designs/productionReferencePdf.test.js src/features/configurator/designs/productionBundle.test.js
```

Expected: all seven-file, PDF, hash, cleanup and failure-path tests PASS.

```powershell
git add src/features/configurator/designs/productionPackage.js src/features/configurator/designs/productionPackage.test.js src/features/configurator/designs/productionManifest.js src/features/configurator/designs/productionManifest.test.js src/features/configurator/designs/productionReferencePdf.js src/features/configurator/designs/productionReferencePdf.test.js src/features/configurator/designs/productionBundle.test.js
git commit -m "feat: package factory uv pattern pieces"
```

### Task 5: Connect the renderer to the complete artifact provider

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx`

- [ ] **Step 1: Add the renderer sequencing regression**

Extend the existing async sequencing test so `prepareProductionArtifacts` waits for Atlas completion, then creates `pieces`, then captures previews, and never exposes a partial package when piece extraction rejects.

- [ ] **Step 2: Run the focused renderer/UI tests and confirm the new contract fails**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/ui/ConfiguratorPage.test.jsx
```

Expected: FAIL because the renderer artifact does not yet contain `pieces`.

- [ ] **Step 3: Wire `createUvPatternPieces` after Atlas baking**

In `prepareProductionArtifacts`, pass the same `atlas.canvas`, `this.patternMeshes`, and validated `uvLayout` to `createUvPatternPieces`; return `{ atlas, pieces, previews, legacyBakeMetadata }`. Keep `assertProductionSnapshot` before and after async work.

- [ ] **Step 4: Preserve the current Save/Download flow**

Keep the Save button disabled while all three asynchronous outputs are pending. Do not add an automatic download or a second cart state. Update only the success text/file name if needed to explain that the ZIP now includes a factory piece PNG.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
npx vitest run src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/ui/ConfiguratorPage.test.jsx
```

Expected: renderer sequencing, disabled state, failure cleanup and native download-link tests PASS.

```powershell
git add src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx
git commit -m "feat: connect seam piece artifact generation"
```

### Task 6: Verify the two supported real models

**Files:**
- Create: `src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js`
- Modify: `src/features/configurator/scene/productionAtlasBakerGarmentModels.test.js` only if shared loader helpers need extraction
- Modify: `docs/superpowers/handoffs/2026-07-31-phase2-production-files-handoff.md`

- [ ] **Step 1: Add real-model integration tests**

Load `public/models/chelsea-jersey.glb` and `public/models/fn8788-jersey.glb` through `GLTFLoader`, build the declared seam groups, and assert:

```js
expect(result.pieces.map(({ id }) => id)).toEqual(
  expect.arrayContaining(['front', 'back']),
);
expect(result.pieces.every(({ mappedTriangles }) => mappedTriangles > 0)).toBe(true);
```

Use front/back player sets, custom text, preset artwork and transparent uploaded artwork so both the raw Atlas and factory piece image contain the same design content.

- [ ] **Step 2: Run the real-model tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js src/features/configurator/scene/productionAtlasBakerGarmentModels.test.js
```

Expected: both GLBs pass the two-piece minimum, UV coverage, duplicate-surface filtering and non-empty output checks.

- [ ] **Step 3: Perform visual comparison**

Use the local browser flow to generate a ZIP, inspect `uv-atlas.png` and `uv-pattern-pieces.png`, and compare:

- front text/number appears only in the front group;
- back text/number appears only in the back group;
- each group follows its configured seam outline;
- no mirrored text remains in the factory-facing piece image;
- transparent gaps separate pieces.

- [ ] **Step 4: Update the handoff and commit**

Record the exact piece count, model IDs, visual result, unsupported seam limitations and test commands in the phase handoff.

```powershell
git add src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js docs/superpowers/handoffs/2026-07-31-phase2-production-files-handoff.md
git commit -m "test: verify seam pieces on real garment models"
```

### Task 7: Full regression, package verifier and release checkpoint

**Files:**
- Modify: `scripts/verify-production-package.mjs`
- Modify: `scripts/verify-production-package.test.js`
- Modify: `docs/superpowers/handoffs/2026-07-31-phase2-production-files-handoff.md`

- [ ] **Step 1: Extend the CLI verifier**

Require `uv-pattern-pieces.png`, verify both PNG entries against `manifest.json`, validate the declared piece list and preserve the existing 4096×4096 raw Atlas and two-page PDF checks.

- [ ] **Step 2: Run the verifier tests**

Run:

```powershell
npx vitest run scripts/verify-production-package.test.js
```

Expected: verifier passes valid seven-file packages and rejects missing, empty, hash-mismatched or incomplete piece artifacts.

- [ ] **Step 3: Run the full suite and both production builds**

Run:

```powershell
npm test
npm run build
npm run build:showcase
npx wrangler deploy --dry-run
```

Expected: all tests pass, both Vite builds exit 0, and Wrangler lists the existing static assets/KV/rate-limit bindings without requiring new secrets.

- [ ] **Step 4: Complete real browser export verification**

Load the complex design used in phase two, click Save design, confirm the button remains disabled while Atlas/pieces/PDF are preparing, wait for `Download production ZIP`, download it, and run:

```powershell
node scripts/verify-production-package.mjs C:\path\to\downloaded.zip
```

Expected: `PASS`, raw Atlas is 4096×4096, PDF has 2 pages, and the ZIP contains the seven exact files.

- [ ] **Step 5: Record rollback point and commit evidence**

Document that the new seven-file format is a local production artifact change, that published `showcase` is not updated until explicit release approval, and that rollback is a normal `git revert` of the feature merge or Cloudflare deployment rollback.

```powershell
git add scripts/verify-production-package.mjs scripts/verify-production-package.test.js docs/superpowers/handoffs/2026-07-31-phase2-production-files-handoff.md
git commit -m "docs: verify seam-based uv production package"
```
