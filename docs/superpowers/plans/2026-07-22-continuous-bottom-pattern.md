# Continuous Bottom Pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an all-garment continuous bottom-pattern editor, deterministic 2048px UV Atlas baking, and compact Shopify production handoff.

**Architecture:** `overrides.bottomPattern` keeps one versioned transform. `modelProjection.js` converts local garment positions to cylindrical repeat coordinates for both live preview and `bottomPatternBaker.js`; baking uses original UV only as the output location. A Worker/R2 API stores the generated PNG and JSON before cart handoff.

**Tech Stack:** React 19, Three.js r185, Canvas/WebGL, Vitest, Cloudflare Workers/R2, Shopify cart permalink.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `src/features/configurator/config/bottomPattern.js` | state defaults and validation |
| `src/features/configurator/scene/modelProjection.js` | continuous model-space mapping |
| `src/features/configurator/scene/bottomPatternBaker.js` | UV Atlas PNG generation |
| `src/features/configurator/scene/garmentRenderer.js` | preview and bake lifecycle |
| `src/features/configurator/ui/BottomPatternPanel.jsx` | controls |
| `src/features/configurator/designs/designDocument.js` | v1 read/v2 write |
| `src/worker.js` | R2 design asset API |
| `src/features/configurator/api/designAssetApi.js` | upload client |
| `src/features/configurator/shopify/cartHandoff.js` | compact production properties |

### Task 1: Add the versioned state contract

**Files:** Create `config/bottomPattern.js`, `config/bottomPattern.test.js`; modify `config/state.js`, `config/productDefinitions.js`.

- [ ] **Step 1: Write the failing test.**

```js
expect(normalizeBottomPattern()).toEqual(createDefaultBottomPattern());
expect(normalizeBottomPattern({ transform: { scale: 0, rotationDeg: 810 } }).transform).toMatchObject({ scale: 0.1, rotationDeg: 90 });
```

- [ ] **Step 2: Run it.** Run: `npm test -- bottomPattern.test.js`. Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the exact contract.**

```js
export const DEFAULT_BOTTOM_PATTERN = Object.freeze({ enabled: false, source: { kind: 'preset', id: 'none', assetRef: '' }, transform: { offset: { u: 0, v: 0 }, scale: 1, rotationDeg: 0, repeat: { u: 3, v: 4 } }, projectionVersion: 1, modelProjectionId: 'chelsea-jersey-cylindrical-v1' });
export const createDefaultBottomPattern = () => structuredClone(DEFAULT_BOTTOM_PATTERN);
```

Implement `normalizeBottomPattern`: offset `[-1,1]`, scale `[0.1,8]`, repeat `[1,16]`, rotation `[0,360)`. Add the default to `productDefinitions.js`; deep-merge `overrides.bottomPattern.transform` in `state.js`.

- [ ] **Step 4: Verify and commit.** Run: `npm test -- bottomPattern.test.js state.test.js`; expected PASS. Commit: `git add src/features/configurator/config/bottomPattern.js src/features/configurator/config/bottomPattern.test.js src/features/configurator/config/state.js src/features/configurator/config/productDefinitions.js && git commit -m "feat: add bottom pattern state"`.

### Task 2: Create one shared model-space projector

**Files:** Create `scene/modelProjection.js`, `scene/modelProjection.test.js`.

- [ ] **Step 1: Write the failing continuity tests.**

```js
const projector = createCylindricalProjector({ center: { x: 0, z: 0 }, minY: 0, maxY: 2, frontAngleDeg: 0 });
expect(projector.project({ x: 0, y: 1, z: 1 }).v).toBeCloseTo(0.5);
expect(projector.project({ x: 0.001, y: 1, z: -1 }).u).toBeCloseTo(0.5, 2);
```

- [ ] **Step 2: Run it.** Run: `npm test -- modelProjection.test.js`; expected FAIL with unresolved module.

- [ ] **Step 3: Implement the projector.**

```js
export function createCylindricalProjector({ center, minY, maxY, frontAngleDeg = 0 }) { const front = frontAngleDeg * Math.PI / 180; const height = Math.max(maxY - minY, Number.EPSILON); return { project({ x, y, z }) { return { u: (Math.atan2(x - center.x, z - center.z) - front) / (Math.PI * 2) + 0.5, v: (y - minY) / height }; } }; }
export const selectGarmentPatternMeshes = (meshes) => meshes.filter((mesh) => /cloth|fabric|body/i.test(mesh.name));
```

Derive bounds from selected meshes after model load; assert their geometries have both `position` and `uv` attributes.

- [ ] **Step 4: Verify and commit.** Run: `npm test -- modelProjection.test.js`; expected PASS. Commit: `git add src/features/configurator/scene/modelProjection.js src/features/configurator/scene/modelProjection.test.js && git commit -m "feat: add continuous garment projector"`.

### Task 3: Build a deterministic UV baker

**Files:** Create `scene/bottomPatternBaker.js`, `scene/bottomPatternBaker.test.js`.

- [ ] **Step 1: Write the failing invalidation test.**

```js
expect(createPatternBakeKey({ sourceHash: 'abc', transform: { rotationDeg: 0 }, projectionVersion: 1, projectionId: 'chelsea-jersey-cylindrical-v1', size: 2048 })).not.toBe(createPatternBakeKey({ sourceHash: 'abc', transform: { rotationDeg: 30 }, projectionVersion: 1, projectionId: 'chelsea-jersey-cylindrical-v1', size: 2048 }));
```

- [ ] **Step 2: Run it.** Run: `npm test -- bottomPatternBaker.test.js`; expected FAIL with unresolved module.

- [ ] **Step 3: Implement the baker interface.**

```js
export const createPatternBakeKey = (input) => JSON.stringify({ sourceHash: input.sourceHash, transform: input.transform, projectionVersion: input.projectionVersion, projectionId: input.projectionId, size: input.size });
export async function bakeBottomPatternAtlas({ meshEntries, pattern, sourceTexture, size = 2048 }) { /* UV output-space render; return { blob, size, bakeKey, projectionVersion }. */ }
```

Render each selected triangle at `uv * 2 - 1` into an offscreen Three.js render target. Pass `projector.project(localPosition)` as a vertex varying, apply offset/scale/rotation/repeat in the fragment shader, use repeat wrapping and transparent clear color, add 4px island padding, and encode a PNG Blob. Mock WebGL in Vitest; assert PNG type, 2048 size, and key invalidation.

- [ ] **Step 4: Verify and commit.** Run: `npm test -- bottomPatternBaker.test.js`; expected PASS. Commit: `git add src/features/configurator/scene/bottomPatternBaker.js src/features/configurator/scene/bottomPatternBaker.test.js && git commit -m "feat: bake continuous patterns to uv atlas"`.

### Task 4: Connect preview, controls, and design persistence

**Files:** Modify `scene/garmentRenderer.js`, `scene/garmentRenderer.test.js`, `ui/ConfiguratorPage.jsx`, `ui/configurator.css`, `designs/designDocument.js`, `designs/designDocument.test.js`; create `ui/BottomPatternPanel.jsx`, `ui/BottomPatternPanel.test.jsx`.

- [ ] **Step 1: Write failing renderer, UI and v1 migration tests.**

```js
await renderer.applyBottomPattern(enabledPattern); await renderer.applyBottomPattern({ ...enabledPattern, transform: { ...enabledPattern.transform, rotationDeg: 30 } }); expect(firstTexture.dispose).toHaveBeenCalledOnce();
expect(parseDesignDocument(JSON.stringify(v1Fixture), options).overrides.bottomPattern.enabled).toBe(false);
```

- [ ] **Step 2: Run it.** Run: `npm test -- garmentRenderer.test.js BottomPatternPanel.test.jsx designDocument.test.js`; expected FAIL because APIs are absent.

- [ ] **Step 3: Implement lifecycle and panel.** Add `bottomPatternTexture`, `bottomPatternBakeKey`, `patternRequestToken`, `patternMeshes`, `applyBottomPattern`, `ensureLatestPatternBake`, and disposal to the renderer. Invoke after `applyAppearance` on model load/state changes; discard stale async bakes. Implement controls labelled `Enable continuous bottom pattern`, `Pattern scale`, `Pattern rotation`, `Horizontal repeat`, `Vertical repeat`, and `Reset bottom pattern`; send patches with `updateState({ overrides: { bottomPattern: patch } })`. Set design document version 2, accept v1/v2, normalize absent v1 data disabled, and never serialize a PNG/Data URL.

- [ ] **Step 4: Verify and commit.** Run: `npm test && npm run build`; expected PASS. Run `npm run dev -- --host 127.0.0.1`, capture front/side/back/sleeve with a high-contrast pattern, save/reopen JSON, and verify pattern phase stays fixed and matches all views. Commit: `git add src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/ui/BottomPatternPanel.jsx src/features/configurator/ui/BottomPatternPanel.test.jsx src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/configurator.css src/features/configurator/designs/designDocument.js src/features/configurator/designs/designDocument.test.js && git commit -m "feat: edit and persist continuous bottom patterns"`.

### Task 5: Upload production assets and pass Shopify references

**Files:** Create `src/worker.js`, `src/worker.test.js`, `api/designAssetApi.js`, `api/designAssetApi.test.js`; modify `wrangler.jsonc`, `shopify/cartHandoff.js`, `shopify/cartHandoff.test.js`, `ui/ConfiguratorPage.jsx`, `ui/DesignReviewDialog.jsx`.

- [ ] **Step 1: Write failing API and cart tests.**

```js
const response = await worker.fetch(uploadRequest, { DESIGN_ASSETS: fakeBucket, ASSETS: fakeAssets }); expect(response.status).toBe(201);
expect(decodeProperties(createCartUrl({ context, state, selected, designAsset }))).toMatchObject({ 'Design ID': designAsset.designId, 'UV Atlas URL': designAsset.atlasUrl, 'UV Atlas SHA-256': designAsset.atlasSha256, 'Projection Version': '1' });
```

- [ ] **Step 2: Run it.** Run: `npm test -- worker.test.js designAssetApi.test.js cartHandoff.test.js`; expected FAIL because API and asset parameter are absent.

- [ ] **Step 3: Implement exact upload boundary.** Set Worker `main` to `src/worker.js`, preserve static assets as `ASSETS`, and add R2 binding `DESIGN_ASSETS` for `jersey-design-assets`. `POST /api/design-assets` requires multipart `atlas`, `design`, `metadata`; accepts PNG only up to 12MiB and `{ atlasSize: 2048, projectionVersion: 1 }`; generates `dsg_${crypto.randomUUID().replaceAll('-', '')}`; writes Atlas/JSON under `designs/<id>/`; returns design ID, URL, SHA-256, size and version. Other requests call `env.ASSETS.fetch(request)`. `uploadDesignAsset()` posts FormData. Before add-to-cart await `renderer.ensureLatestPatternBake()`, upload, then call `createCartUrl({ context, state, selected, designAsset })`. Require the asset only when bottom pattern is enabled and append exactly the four named properties; keep the current properties unchanged.

- [ ] **Step 4: Verify and commit.** Run: `npm test && npm run build && npx wrangler deploy --dry-run`; expected PASS. Real verification: add a high-contrast design from the product launch, read its cart line item, and match its four properties and SHA-256 to the upload response. Commit: `git add src/worker.js src/worker.test.js wrangler.jsonc src/features/configurator/api/designAssetApi.js src/features/configurator/api/designAssetApi.test.js src/features/configurator/shopify/cartHandoff.js src/features/configurator/shopify/cartHandoff.test.js src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/DesignReviewDialog.jsx && git commit -m "feat: hand off baked uv atlas to Shopify"`.
