# Phase 2 Complete Production Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every **Save design** action generate and verify one deterministic six-file production-reference ZIP containing editable JSON, a complete 4096×4096 UV atlas, front/back previews, a two-page Chinese PDF, and a SHA-256 manifest.

**Architecture:** Keep browser-local generation and the existing store-only ZIP writer. A renderer-owned read-only provider freezes the current render surfaces, bakes the complete atlas, and captures fixed previews; focused design modules then create the fingerprint, PDF, manifest, verification result, and ZIP. `ConfiguratorPage` only owns request tokens, stale-result invalidation, error display, and the prepared download lifecycle.

**Tech Stack:** React 19, Three.js 0.185, Canvas 2D, Web Crypto SHA-256, browser Blob APIs, the existing internal ZIP writer, Vitest 4, Testing Library, Poppler for PDF visual verification.

---

## File and responsibility map

**Create**

- `src/features/configurator/designs/productionFingerprint.js` — recursive canonicalization, package schema version, SHA-256 design fingerprint, deterministic filename.
- `src/features/configurator/designs/productionFingerprint.test.js` — canonical ordering, volatile-field exclusion, model/state sensitivity, filename tests.
- `src/features/configurator/designs/productionManifest.js` — lowercase SHA-256, manifest construction, exact artifact verification.
- `src/features/configurator/designs/productionManifest.test.js` — hash, byte length, missing/renamed/altered/empty artifact failures.
- `src/features/configurator/designs/productionReferencePdf.js` — Chinese page canvases and minimal two-page raster PDF container.
- `src/features/configurator/designs/productionReferencePdf.test.js` — page size/count, image placement calls, Chinese labels, encoding failures.
- `src/features/configurator/designs/productionPackage.js` — immutable six-file orchestration and verified ZIP result.
- `src/features/configurator/designs/productionPackage.test.js` — exact package contract, 4096 integration, round-trip, failure propagation.
- `src/features/configurator/scene/productionAtlasBaker.js` — base UV appearance plus legacy pattern and live decal-to-garment-UV rasterization.
- `src/features/configurator/scene/productionAtlasBaker.test.js` — base colors, layer order/alpha, front/back islands, seams, coverage failures.
- `src/features/configurator/scene/productionPreviewCapture.js` — fixed front/back offscreen captures with complete state restoration.
- `src/features/configurator/scene/productionPreviewCapture.test.js` — success/failure restoration and stable PNG dimensions.
- `scripts/verify-production-package.mjs` — extract a downloaded ZIP, verify exact entries, manifest hashes, PNG sizes, and PDF page count.

**Modify narrowly**

- `src/features/configurator/config/productDefinitions.js` — add immutable model `id`, `version`, `uvExportVersion`, `uvAtlasSize`.
- `src/features/configurator/api/productApi.test.js` — assert production metadata survives product loading.
- `src/features/configurator/designs/designDocument.js` — export the existing state normalizer for fingerprint/package reuse.
- `src/features/configurator/designs/designDocument.test.js` — prove exported normalization keeps save/open behavior.
- `src/features/configurator/designs/productionBundle.js` — package an ordered, exact six-entry artifact array and deterministic filename.
- `src/features/configurator/designs/productionBundle.test.js` — parse central directory and assert exact names/order and validation.
- `src/features/configurator/scene/decorationEditor.js` — expose ordered read-only artwork surfaces and production-capture opacity state.
- `src/features/configurator/scene/decorationEditor.test.js` — provider order, texture readiness, capture-state restoration.
- `src/features/configurator/scene/garmentRenderer.js` — track model readiness and expose one production artifact provider.
- `src/features/configurator/scene/garmentRenderer.test.js` — provider readiness, frozen-state guard, complete surface inventory, legacy pattern.
- `src/features/configurator/scene/ProductStage.jsx` — register/unregister `prepareProductionArtifacts`.
- `src/features/configurator/scene/ProductStage.test.jsx` — provider lifecycle and forwarding.
- `src/features/configurator/ui/ConfiguratorPage.jsx` — always prepare a ZIP, disable while generating, invalidate stale download, keep legacy cart receipt compatibility.
- `src/features/configurator/ui/ConfiguratorPage.test.jsx` — always-ZIP behavior, stale/concurrent/unmount/error cases, object URL cleanup.
- `docs/superpowers/handoffs/2026-07-31-phase2-production-files-handoff.md` — exact verification evidence, production limitation, rollback point.

No runtime dependency, R2/D1 object, database row, Shopify paid-order association,
Shopify theme asset, product, price, or checkout behavior is added.

### Task 1: Immutable model metadata and deterministic fingerprint

**Files:**

- Modify: `src/features/configurator/config/productDefinitions.js:16-22`
- Modify: `src/features/configurator/api/productApi.test.js:5-20`
- Modify: `src/features/configurator/designs/designDocument.js:47-67`
- Modify: `src/features/configurator/designs/designDocument.test.js`
- Create: `src/features/configurator/designs/productionFingerprint.js`
- Create: `src/features/configurator/designs/productionFingerprint.test.js`

- [ ] **Step 1: Write failing metadata and fingerprint tests**

```js
// productionFingerprint.test.js
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalizeProductionValue,
  createDesignFingerprint,
  createProductionFilename,
} from './productionFingerprint.js';

const input = {
  productId: 'fn8788-jersey',
  variantId: '48039101923479',
  size: 'm',
  model: { id: 'chelsea-jersey', version: '1', uvExportVersion: '1' },
  state: { overrides: { printItems: [{ id: 'p1', name: 'PLAYER', number: '16' }] } },
};

describe('production fingerprint', () => {
  it('sorts object keys recursively without reordering arrays', () => {
    expect(canonicalizeProductionValue({ z: 1, a: { y: 2, b: 3 }, rows: [{ z: 4, a: 5 }] }))
      .toBe('{"a":{"b":3,"y":2},"rows":[{"a":5,"z":4}],"z":1}');
  });

  it('is stable for equivalent input and changes with model or design data', async () => {
    const first = await createDesignFingerprint(input);
    const reordered = await createDesignFingerprint({
      state: structuredClone(input.state),
      model: { uvExportVersion: '1', version: '1', id: 'chelsea-jersey' },
      size: 'm',
      variantId: '48039101923479',
      productId: 'fn8788-jersey',
    });
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(reordered).toBe(first);
    await expect(createDesignFingerprint({
      ...input,
      model: { ...input.model, version: '2' },
    })).resolves.not.toBe(first);
  });

  it('uses only the eight-character fingerprint in the package filename', () => {
    expect(createProductionFilename('fn8788-jersey', '12ab34cd'))
      .toBe('fn8788-jersey-design-12ab34cd.zip');
  });

  it('fails instead of inventing a hash when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(createDesignFingerprint(input))
      .rejects.toThrow('此浏览器不支持 SHA-256，无法生成生产文件。');
    vi.unstubAllGlobals();
  });
});
```

Add to `productApi.test.js`:

```js
expect(product.model).toMatchObject({
  id: 'chelsea-jersey',
  version: '1',
  uvExportVersion: '1',
  uvAtlasSize: 4096,
});
```

- [ ] **Step 2: Run the focused tests and confirm the new module/fields are missing**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionFingerprint.test.js src/features/configurator/api/productApi.test.js
```

Expected: FAIL because `productionFingerprint.js` and model production metadata do not exist.

- [ ] **Step 3: Export the existing design-state normalizer and implement fingerprinting**

Rename `normalizePrintState` to exported `normalizeDesignState` and update its caller:

```js
export function normalizeDesignState(state) {
  const overrides = state.overrides ?? {};
  const printItems = getPrintItems(overrides);
  const customTextItems = getCustomTextItems(overrides);
  return {
    ...state,
    overrides: {
      ...overrides,
      ...(overrides.appearance ? { appearance: normalizeAppearance(overrides.appearance) } : {}),
      ...(overrides.bottomPattern ? {
        bottomPattern: normalizeDocumentBottomPattern(
          overrides.bottomPattern,
          DESIGN_DOCUMENT_VERSION,
        ),
      } : {}),
      customTextItems,
      printItems,
      ...legacyFirstItemFields(printItems),
    },
  };
}
```

Create `productionFingerprint.js`:

```js
import { normalizeDesignState } from './designDocument.js';

export const PRODUCTION_PACKAGE_SCHEMA_VERSION = 1;

export function canonicalizeProductionValue(value) {
  return JSON.stringify(sortValue(value));
}

export async function createDesignFingerprint({
  model,
  productId,
  size,
  state,
  variantId = null,
}) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('此浏览器不支持 SHA-256，无法生成生产文件。');
  }
  const canonical = canonicalizeProductionValue({
    model: { id: model.id, version: model.version },
    packageSchemaVersion: PRODUCTION_PACKAGE_SCHEMA_VERSION,
    productId,
    size,
    state: normalizeDesignState(structuredClone(state)),
    uvExportVersion: model.uvExportVersion,
    variantId,
  });
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8);
}

export function createProductionFilename(productId, fingerprint) {
  if (!/^[0-9a-f]{8}$/.test(fingerprint)) {
    throw new Error('生产文件指纹格式无效。');
  }
  return `${productId}-design-${fingerprint}.zip`;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = sortValue(value[key]);
      return result;
    }, {});
  }
  return value;
}
```

Add to the current `model` definition:

```js
model: {
  id: 'chelsea-jersey',
  version: '1',
  uvExportVersion: '1',
  uvAtlasSize: 4096,
  glbUrl: '/models/chelsea-jersey.glb',
  assetName: 'chelsea-jersey.glb',
},
```

- [ ] **Step 4: Run fingerprint, document, and API tests**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionFingerprint.test.js src/features/configurator/designs/designDocument.test.js src/features/configurator/api/productApi.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/features/configurator/config/productDefinitions.js src/features/configurator/api/productApi.test.js src/features/configurator/designs/designDocument.js src/features/configurator/designs/designDocument.test.js src/features/configurator/designs/productionFingerprint.js src/features/configurator/designs/productionFingerprint.test.js
git commit -m "feat: add production design fingerprint"
```

### Task 2: Artifact hashes, manifest, and strict verification

**Files:**

- Create: `src/features/configurator/designs/productionManifest.js`
- Create: `src/features/configurator/designs/productionManifest.test.js`

- [ ] **Step 1: Write failing manifest tests**

```js
import { describe, expect, it } from 'vitest';
import {
  createProductionManifest,
  sha256Hex,
  verifyProductionArtifacts,
} from './productionManifest.js';

const artifact = (name, body, mediaType) => ({
  blob: new Blob([body], { type: mediaType }),
  name,
  mediaType,
});

describe('production manifest', () => {
  it('records lowercase SHA-256 and byte length for all five artifacts', async () => {
    const files = [
      artifact('design.json', '{}', 'application/json'),
      artifact('uv-atlas.png', 'atlas', 'image/png'),
      artifact('uv-reference.pdf', 'pdf', 'application/pdf'),
      artifact('preview-front.png', 'front', 'image/png'),
      artifact('preview-back.png', 'back', 'image/png'),
    ];
    const manifest = await createProductionManifest({
      atlas: { colorSpace: 'sRGB', height: 4096, width: 4096 },
      designFingerprint: '12ab34cd',
      files,
      generatedAt: '2026-07-31T00:00:00.000Z',
      model: { id: 'chelsea-jersey', version: '1' },
      productId: 'fn8788-jersey',
      size: 'm',
      uvExportVersion: '1',
      variantId: null,
    });
    expect(manifest.files).toHaveLength(5);
    expect(manifest.files[0]).toEqual({
      byteLength: 2,
      mediaType: 'application/json',
      name: 'design.json',
      sha256: await sha256Hex(files[0].blob),
    });
    await expect(verifyProductionArtifacts(files, manifest)).resolves.toBe(true);
  });

  it.each([
    ['missing', (files) => files.slice(1)],
    ['renamed', (files) => files.map((file, index) => index ? file : { ...file, name: 'other.json' })],
    ['altered', (files) => files.map((file, index) => index ? file : artifact('design.json', '{"x":1}', 'application/json'))],
    ['empty', (files) => files.map((file, index) => index ? file : artifact('design.json', '', 'application/json'))],
  ])('rejects a %s artifact set', async (_label, mutate) => {
    const files = [
      artifact('design.json', '{}', 'application/json'),
      artifact('uv-atlas.png', 'atlas', 'image/png'),
      artifact('uv-reference.pdf', 'pdf', 'application/pdf'),
      artifact('preview-front.png', 'front', 'image/png'),
      artifact('preview-back.png', 'back', 'image/png'),
    ];
    const manifest = await createProductionManifest({
      atlas: { colorSpace: 'sRGB', height: 4096, width: 4096 },
      designFingerprint: '12ab34cd',
      files,
      generatedAt: '2026-07-31T00:00:00.000Z',
      model: { id: 'chelsea-jersey', version: '1' },
      productId: 'fn8788-jersey',
      size: 'm',
      uvExportVersion: '1',
      variantId: null,
    });
    await expect(verifyProductionArtifacts(mutate(files), manifest))
      .rejects.toThrow('生产文件校验失败');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the module is missing**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionManifest.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement hashing, manifest creation, and verification**

```js
import { PRODUCTION_PACKAGE_SCHEMA_VERSION } from './productionFingerprint.js';

export const PRODUCTION_ARTIFACT_NAMES = Object.freeze([
  'design.json',
  'uv-atlas.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
]);

export async function sha256Hex(blob) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error('生产文件不能为空。');
  if (!globalThis.crypto?.subtle) throw new Error('此浏览器不支持 SHA-256，无法校验生产文件。');
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createProductionManifest(input) {
  assertExactNames(input.files);
  const files = [];
  for (const file of input.files) {
    files.push({
      name: file.name,
      mediaType: file.mediaType,
      byteLength: file.blob.size,
      sha256: await sha256Hex(file.blob),
    });
  }
  return {
    schemaVersion: PRODUCTION_PACKAGE_SCHEMA_VERSION,
    designFingerprint: input.designFingerprint,
    productId: input.productId,
    variantId: input.variantId,
    size: input.size,
    model: structuredClone(input.model),
    uvExportVersion: input.uvExportVersion,
    atlas: structuredClone(input.atlas),
    generatedAt: input.generatedAt,
    files,
  };
}

export async function verifyProductionArtifacts(files, manifest) {
  assertExactNames(files);
  if (manifest.files.length !== PRODUCTION_ARTIFACT_NAMES.length) {
    throw new Error('生产文件校验失败：清单数量不正确。');
  }
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const expected = manifest.files[index];
    const hash = await sha256Hex(file.blob);
    if (
      file.name !== expected.name
      || file.mediaType !== expected.mediaType
      || file.blob.size !== expected.byteLength
      || hash !== expected.sha256
    ) throw new Error(`生产文件校验失败：${file.name} 与清单不一致。`);
  }
  return true;
}

function assertExactNames(files) {
  const names = files?.map((file) => file.name);
  if (JSON.stringify(names) !== JSON.stringify(PRODUCTION_ARTIFACT_NAMES)) {
    throw new Error('生产文件校验失败：文件名称或顺序不正确。');
  }
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionManifest.test.js
```

Expected: all tests PASS, including tamper rejection.

- [ ] **Step 5: Commit**

```powershell
git add -- src/features/configurator/designs/productionManifest.js src/features/configurator/designs/productionManifest.test.js
git commit -m "feat: verify production artifact manifest"
```

### Task 3: Exact six-entry ZIP bundle

**Files:**

- Modify: `src/features/configurator/designs/productionBundle.js`
- Modify: `src/features/configurator/designs/productionBundle.test.js`

- [ ] **Step 1: Replace the two-file test with an exact six-entry ZIP contract test**

Use a small central-directory reader in the test so names are checked structurally, not by string search:

```js
function readCentralNames(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names = [];
  for (let offset = 0; offset <= bytes.length - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    names.push(new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength)));
    offset += 45 + nameLength;
  }
  return names;
}

it('packages exactly the ordered six-file production contract', async () => {
  const names = [
    'design.json',
    'uv-atlas.png',
    'uv-reference.pdf',
    'preview-front.png',
    'preview-back.png',
    'manifest.json',
  ];
  const result = await createProductionBundle({
    files: names.map((name) => ({
      blob: new Blob([name]),
      filename: name,
    })),
    fingerprint: '12ab34cd',
    productId: 'fn8788-jersey',
  });
  expect(result.filename).toBe('fn8788-jersey-design-12ab34cd.zip');
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  expect(readCentralNames(bytes)).toEqual(names);
});

it('rejects missing, duplicate, renamed, or empty entries', async () => {
  await expect(createProductionBundle({
    files: [{ blob: new Blob(['{}']), filename: 'design.json' }],
    fingerprint: '12ab34cd',
    productId: 'fn8788-jersey',
  })).rejects.toThrow('生产 ZIP 文件列表不完整');
});
```

- [ ] **Step 2: Run the bundle test and confirm the old API fails**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionBundle.test.js
```

Expected: FAIL because the existing function accepts only `design` and `atlas`.

- [ ] **Step 3: Generalize only the public bundle entry point**

Keep `createStoreOnlyZip`, CRC32, and DOS timestamps unchanged. Replace the entry point and `readEntry` validation:

```js
import { createProductionFilename } from './productionFingerprint.js';

const ZIP_NAMES = Object.freeze([
  'design.json',
  'uv-atlas.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
  'manifest.json',
]);

export async function createProductionBundle({ files, fingerprint, productId }) {
  if (
    !Array.isArray(files)
    || JSON.stringify(files.map((file) => file.filename)) !== JSON.stringify(ZIP_NAMES)
  ) throw new Error('生产 ZIP 文件列表不完整或顺序不正确。');
  const entries = [];
  for (const file of files) entries.push(await readEntry(file));
  const zip = createStoreOnlyZip(entries);
  return {
    blob: new Blob([zip], { type: 'application/zip' }),
    filename: createProductionFilename(productId, fingerprint),
  };
}

async function readEntry(file) {
  if (
    !(file?.blob instanceof Blob)
    || file.blob.size === 0
    || typeof file.filename !== 'string'
    || file.filename.length === 0
  ) throw new Error('生产 ZIP 中存在缺失或空文件。');
  return {
    bytes: new Uint8Array(await file.blob.arrayBuffer()),
    name: new TextEncoder().encode(file.filename),
  };
}
```

- [ ] **Step 4: Run bundle and fingerprint tests**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionBundle.test.js src/features/configurator/designs/productionFingerprint.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/features/configurator/designs/productionBundle.js src/features/configurator/designs/productionBundle.test.js
git commit -m "feat: package exact production zip entries"
```

### Task 4: Complete UV atlas baker

**Files:**

- Create: `src/features/configurator/scene/productionAtlasBaker.js`
- Create: `src/features/configurator/scene/productionAtlasBaker.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.js:383-430`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js:639-703`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: Write failing pixel, side, alpha/order, seam, and strict-coverage tests**

Build two UV-mapped garment planes (front island at U `0.05–0.45`, back at U `0.55–0.95`) and decal triangles above each. Assert:

```js
const result = await bakeProductionAtlas({
  appearanceCanvas: solidCanvas(32, '#f7f5ef'),
  atlasSize: 64,
  garmentMeshes: [frontGarment, backGarment],
  layers: [
    decalLayer({ id: 'front-name', garmentMesh: frontGarment, color: '#112233' }),
    decalLayer({ id: 'back-art', garmentMesh: backGarment, color: '#cc4433' }),
  ],
});

expect(result.blob.type).toBe('image/png');
expect(result.canvas.width).toBe(64);
expect(pixel(result.canvas, 16, 32)).toEqual([17, 34, 51, 255]);
expect(pixel(result.canvas, 48, 32)).toEqual([204, 68, 51, 255]);
```

Add separate tests that:

- draw a 50%-alpha blue layer over red and assert the composited pixel;
- reverse the layer order and assert the pixel changes;
- map a triangle spanning U `0.98 → 0.02` and assert both atlas edges receive pixels;
- preserve transparent source pixels;
- provide one unmappable triangle and expect `生产图层 "broken" 无法完整映射到服装 UV`;
- omit garment UVs and expect `服装网格 "Body" 缺少 UV`;
- pass `atlasSize: 4096` with a stubbed encoder and assert the created canvas is exactly 4096×4096.

- [ ] **Step 2: Run the new atlas tests and confirm the module is missing**

Run:

```powershell
npx vitest run src/features/configurator/scene/productionAtlasBaker.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the atlas request contract and base composition**

Create:

```js
import * as THREE from 'three';

const MIN_LAYER_COVERAGE = 0.985;

export async function bakeProductionAtlas({
  appearanceCanvas,
  atlasSize,
  garmentMeshes,
  layers,
  legacyPatternCanvas = null,
}) {
  if (!Number.isInteger(atlasSize) || atlasSize < 1) {
    throw new Error('UV Atlas 尺寸无效。');
  }
  validateGarmentUvs(garmentMeshes);
  const canvas = document.createElement('canvas');
  canvas.width = atlasSize;
  canvas.height = atlasSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 UV Atlas 画布。');
  context.clearRect(0, 0, atlasSize, atlasSize);
  context.drawImage(appearanceCanvas, 0, 0, atlasSize, atlasSize);
  if (legacyPatternCanvas) context.drawImage(legacyPatternCanvas, 0, 0, atlasSize, atlasSize);
  for (const layer of layers) rasterizeLayer(context, atlasSize, layer);
  const blob = await canvasToPngBlob(canvas);
  return { blob, canvas, colorSpace: 'sRGB', height: atlasSize, width: atlasSize };
}

function validateGarmentUvs(meshes) {
  if (!meshes?.length) throw new Error('服装模型尚未准备完成。');
  meshes.forEach((mesh) => {
    if (!mesh.geometry?.attributes?.uv) {
      throw new Error(`服装网格 "${mesh.name || 'unnamed'}" 缺少 UV。`);
    }
  });
}
```

- [ ] **Step 4: Implement triangle projection, affine rasterization, seams, and coverage**

Use each layer shape:

```js
{
  id,
  label,
  geometry,       // final exterior-only DecalGeometry
  garmentMesh,    // authoritative underlying printable mesh
  textureSource,  // layer.material.map.image
  renderOrder,
}
```

Implement these focused helpers in the same module:

```js
function rasterizeLayer(context, size, layer) {
  const position = layer.geometry?.attributes?.position;
  const sourceUv = layer.geometry?.attributes?.uv;
  if (!position || !sourceUv || !layer.garmentMesh || !layer.textureSource) {
    throw new Error(`生产图层 "${layer.label}" 数据不完整。`);
  }
  const index = layer.geometry.index;
  const count = index ? index.count : position.count;
  let mapped = 0;
  for (let offset = 0; offset < count; offset += 3) {
    const vertices = [0, 1, 2].map((corner) => (
      index ? index.getX(offset + corner) : offset + corner
    ));
    const source = vertices.map((vertex) => ({
      x: sourceUv.getX(vertex) * layer.textureSource.width,
      y: (1 - sourceUv.getY(vertex)) * layer.textureSource.height,
    }));
    const worldPoints = vertices.map((vertex) => {
      const point = new THREE.Vector3().fromBufferAttribute(position, vertex);
      return layer.surface.localToWorld(point);
    });
    const normal = new THREE.Triangle(...worldPoints).getNormal(new THREE.Vector3());
    const target = worldPoints.map((point) => (
      projectVertexToGarmentUv(layer, point, normal, size)
    ));
    if (target.every(Boolean)) {
      seamTargets(target, size).forEach((points) => (
        drawMappedTriangle(context, layer.textureSource, source, points)
      ));
      mapped += 1;
    }
  }
  const triangleCount = count / 3;
  if (!triangleCount || mapped / triangleCount < MIN_LAYER_COVERAGE) {
    throw new Error(`生产图层 "${layer.label}" 无法完整映射到服装 UV。`);
  }
}

function projectVertexToGarmentUv(layer, point, normal, size) {
  const raycaster = new THREE.Raycaster(
    point.clone().addScaledVector(normal, 0.04),
    normal.clone().negate(),
    0,
    0.12,
  );
  const hit = raycaster.intersectObject(layer.garmentMesh, false)
    .find((entry) => entry.uv);
  return hit?.uv ? { x: hit.uv.x * size, y: (1 - hit.uv.y) * size } : null;
}

function seamTargets(target, size) {
  const xs = target.map((point) => point.x);
  if (Math.max(...xs) - Math.min(...xs) <= size / 2) return [target];
  const unwrapped = target.map((point) => ({
    ...point,
    x: point.x < size / 2 ? point.x + size : point.x,
  }));
  return [
    unwrapped,
    unwrapped.map((point) => ({ ...point, x: point.x - size })),
  ];
}

function drawMappedTriangle(context, image, source, target) {
  const matrix = solveAffine(source, target);
  if (!matrix) return;
  context.save();
  context.beginPath();
  context.moveTo(target[0].x, target[0].y);
  context.lineTo(target[1].x, target[1].y);
  context.lineTo(target[2].x, target[2].y);
  context.closePath();
  context.clip();
  context.setTransform(...matrix);
  context.drawImage(image, 0, 0);
  context.restore();
}

function solveAffine(source, target) {
  const [first, second, third] = source;
  const determinant = (
    first.x * (second.y - third.y)
    + second.x * (third.y - first.y)
    + third.x * (first.y - second.y)
  );
  if (Math.abs(determinant) < Number.EPSILON) return null;
  const solve = (values) => {
    const [one, two, three] = values;
    return [
      (one * (second.y - third.y) + two * (third.y - first.y) + three * (first.y - second.y)) / determinant,
      (one * (third.x - second.x) + two * (first.x - third.x) + three * (second.x - first.x)) / determinant,
      (one * (second.x * third.y - third.x * second.y) + two * (third.x * first.y - first.x * third.y) + three * (first.x * second.y - second.x * first.y)) / determinant,
    ];
  };
  const [a, c, e] = solve(target.map((point) => point.x));
  const [b, d, f] = solve(target.map((point) => point.y));
  return [a, b, c, d, e, f];
}
```

Before iterating, call `layer.surface.updateWorldMatrix(true, false)`. The triangle normal comes from the final exterior-only decal triangle itself, never from a fixed front/back direction. `seamTargets` unwraps the crossing triangle and draws the translated edge copy without cropping the opposite UV edge.

- [ ] **Step 5: Expose stable, ordered production layers from both editors**

When creating/updating artwork surfaces, retain:

```js
surface.userData.productionLayer = {
  id: decoration.id,
  label: decoration.label || decoration.id,
  garmentMesh: mesh,
  kind: 'artwork',
};
```

Add to `DecorationEditor`:

```js
async waitForTextures() {
  await Promise.all([...this.surfaces.values()].map((surface) => (
    surface.material?.map?.userData?.productionReady ?? Promise.resolve()
  )));
}

getProductionLayers() {
  return this.decorations.map((decoration) => {
    const surface = this.surfaces.get(decoration.id);
    return {
      ...surface.userData.productionLayer,
      geometry: surface.geometry,
      renderOrder: surface.renderOrder,
      surface,
      textureSource: surface.material.map.image,
    };
  });
}
```

In `createTexture`, attach readiness to the texture before assigning `image.src`:

```js
let resolveReady;
let rejectReady;
texture.userData.productionReady = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});
image.onload = () => {
  const aspect = image.naturalWidth / image.naturalHeight || 1;
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  texture.needsUpdate = true;
  const surface = this.surfaces.get(decoration.id);
  if (surface) {
    surface.userData.aspect = aspect;
    const currentPlacement = surface.userData.placement ?? decoration.placement;
    if (currentPlacement) this.applyDecoration(surface, decoration, currentPlacement);
  }
  resolveReady();
};
image.onerror = () => {
  rejectReady(new Error(`图案 "${decoration.label || decoration.id}" 加载失败。`));
};
```

In `syncPersonalizationDecal`, write equivalent `decal.userData.productionLayer` metadata with the resolved garment mesh. Add `GarmentRenderer.getProductionLayers()` returning visible personalization decals followed by artwork surfaces, sorted by `[renderOrder, stable state index]`.

- [ ] **Step 6: Run the atlas and editor/renderer focused tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/productionAtlasBaker.test.js src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/decorationEditorTexture.test.js src/features/configurator/scene/garmentRenderer.test.js
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- src/features/configurator/scene/productionAtlasBaker.js src/features/configurator/scene/productionAtlasBaker.test.js src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "feat: bake complete production uv atlas"
```

### Task 5: Fixed front/back preview capture and renderer provider

**Files:**

- Create: `src/features/configurator/scene/productionPreviewCapture.js`
- Create: `src/features/configurator/scene/productionPreviewCapture.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js:95-224,284-373,516-526`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: Write failing preview state-restoration tests**

Test a stub renderer with `setRenderTarget`, `readRenderTargetPixels`, and `render`. Capture original:

- camera position/quaternion/aspect;
- controls target/enabled;
- scene background;
- renderer target;
- personalization plane visibility;
- artwork opacity/selection flash.

Assert after success and after forced `readRenderTargetPixels` failure:

```js
await expect(captureProductionPreviews(harness)).resolves.toMatchObject({
  front: { blob: expect.any(Blob), width: 1600, height: 1600 },
  back: { blob: expect.any(Blob), width: 1600, height: 1600 },
});
expect(snapshotHarnessState(harness)).toEqual(before);
```

Add a PNG-encoding failure test expecting `无法编码正面预览 PNG。`.

- [ ] **Step 2: Run the preview test and confirm the module is missing**

Run:

```powershell
npx vitest run src/features/configurator/scene/productionPreviewCapture.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement offscreen fixed-view capture with `finally` restoration**

Create `captureProductionPreviews` around a `THREE.WebGLRenderTarget`:

```js
export async function captureProductionPreviews({
  camera,
  controls,
  renderer,
  scene,
  setProductionCaptureMode,
  height = 1600,
  width = 1600,
}) {
  const snapshot = snapshotRenderState({ camera, controls, renderer, scene });
  const target = new THREE.WebGLRenderTarget(width, height, {
    colorSpace: THREE.SRGBColorSpace,
    depthBuffer: true,
  });
  try {
    setProductionCaptureMode(true);
    scene.background = new THREE.Color('#f3f1ec');
    const front = await captureSide('front', { camera, controls, height, renderer, scene, target, width });
    const back = await captureSide('back', { camera, controls, height, renderer, scene, target, width });
    return { front, back };
  } finally {
    target.dispose();
    restoreRenderState(snapshot, { camera, controls, renderer, scene });
    setProductionCaptureMode(false);
  }
}

async function captureSide(side, {
  camera,
  controls,
  height,
  renderer,
  scene,
  target,
  width,
}) {
  const preset = side === 'front'
    ? { position: [0, 1.8, 5.4], target: [0, 0.7, 0] }
    : { position: [0, 1.8, -5.4], target: [0, 0.7, 0] };
  camera.position.fromArray(preset.position);
  controls.target.fromArray(preset.target);
  camera.aspect = width / height;
  camera.lookAt(controls.target);
  camera.updateProjectionMatrix();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`无法创建${side === 'front' ? '正面' : '背面'}预览画布。`);
  const imageData = context.createImageData(width, height);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = (height - row - 1) * width * 4;
    imageData.data.set(
      pixels.subarray(sourceStart, sourceStart + width * 4),
      row * width * 4,
    );
  }
  context.putImageData(imageData, 0, 0);
  const blob = await canvasToPng(
    canvas,
    `无法编码${side === 'front' ? '正面' : '背面'}预览 PNG。`,
  );
  return { blob, canvas, height, width };
}

function snapshotRenderState({ camera, controls, renderer, scene }) {
  return {
    aspect: camera.aspect,
    background: scene.background,
    controlsEnabled: controls.enabled,
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    renderTarget: renderer.getRenderTarget(),
    target: controls.target.clone(),
  };
}

function restoreRenderState(snapshot, { camera, controls, renderer, scene }) {
  camera.position.copy(snapshot.position);
  camera.quaternion.copy(snapshot.quaternion);
  camera.aspect = snapshot.aspect;
  camera.updateProjectionMatrix();
  controls.target.copy(snapshot.target);
  controls.enabled = snapshot.controlsEnabled;
  scene.background = snapshot.background;
  renderer.setRenderTarget(snapshot.renderTarget);
}

function canvasToPng(canvas, errorMessage) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size) resolve(blob);
      else reject(new Error(errorMessage));
    }, 'image/png');
  });
}
```

`captureSide` must set camera/target directly to the same fixed values used by `setView` (no GSAP), render to the target, read RGBA pixels, vertically flip rows into a 2D canvas, and encode `image/png`. `snapshotRenderState` and `restoreRenderState` must clone/copy every field listed in Step 1.

- [ ] **Step 4: Add capture mode and a readiness promise to `GarmentRenderer`**

At model-load start create a promise and settle it explicitly:

```js
this.modelReady = createDeferredReadiness();

async waitForProductionReady() {
  await this.modelReady.promise;
  await this.decorationEditor.waitForTextures();
  await this.updateBottomPattern();
  while (this.bottomPatternPendingKey) await nextFrame();
  if (!this.appearanceTexture || !this.modelMeshes.length) {
    throw new Error('服装模型尚未准备完成。');
  }
}
```

Add the two local lifecycle helpers:

```js
function createDeferredReadiness() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
```

At the start of the current load request assign a new deferred instance; call
`this.modelReady.resolve()` only in the successful current-token branch after all
renderer layers are synchronized, and call `this.modelReady.reject(new Error(
'服装模型加载失败。'))` only for the current-token failure. Attach a no-op rejection
handler when replacing or disposing a deferred so an obsolete rejected load cannot
become an unhandled promise rejection.

Resolve only after `modelGroup.updateMatrixWorld(true)`, `applyAppearance`, `updatePrintLayer`, and `decorationEditor.update` finish. Reject the active readiness promise on model load failure; superseded loads must not resolve the latest promise.

Add:

```js
setProductionCaptureMode(enabled) {
  this.printLayers.forEach((layer) => {
    layer.plane.userData.captureVisible ??= layer.plane.visible;
    layer.plane.visible = enabled ? false : layer.plane.userData.captureVisible;
    if (!enabled) delete layer.plane.userData.captureVisible;
  });
  this.decorationEditor.setProductionCaptureMode(enabled);
  this.syncPrintAnchor();
}
```

Add the matching artwork implementation:

```js
setProductionCaptureMode(enabled) {
  this.surfaces.forEach((surface) => {
    if (enabled) {
      surface.userData.captureOpacity = surface.material.opacity;
      surface.material.opacity = 1;
      return;
    }
    if (Number.isFinite(surface.userData.captureOpacity)) {
      surface.material.opacity = surface.userData.captureOpacity;
    }
    delete surface.userData.captureOpacity;
  });
}
```

This changes only transient opacity. `selectedId`, `selectionFlashId`, timers, surface geometry, and state callbacks remain untouched and are therefore still the same after capture.

- [ ] **Step 5: Add the single renderer-owned provider**

```js
async prepareProductionArtifacts({ model, stateSnapshot }) {
  await this.waitForProductionReady();
  if (
    model.id !== this.product.model.id
    || model.version !== this.product.model.version
    || canonicalizeProductionValue(normalizeDesignState(stateSnapshot))
      !== canonicalizeProductionValue(normalizeDesignState(this.state))
  ) throw new Error('设计已发生变化，请重新保存。');

  const appearanceCanvas = createGarmentAppearanceCanvas(
    model.uvAtlasSize,
    this.selected.appearance,
  );
  const legacyPatternCanvas = this.state.overrides?.bottomPattern?.enabled
    ? this.bottomPatternTexture?.image
    : null;
  const atlas = await bakeProductionAtlas({
    appearanceCanvas,
    atlasSize: model.uvAtlasSize,
    garmentMeshes: this.decorationMeshes,
    layers: this.getProductionLayers(),
    legacyPatternCanvas,
  });
  const previews = await captureProductionPreviews({
    camera: this.camera,
    controls: this.controls,
    renderer: this.renderer,
    scene: this.scene,
    setProductionCaptureMode: (enabled) => this.setProductionCaptureMode(enabled),
  });
  return {
    atlas,
    legacyBakeMetadata: this.bottomPatternTexture?.userData?.bottomPatternBakeMetadata ?? null,
    previews,
  };
}
```

- [ ] **Step 6: Run preview, renderer, and decoration tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/productionPreviewCapture.test.js src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.test.js
```

Expected: all tests PASS, including failure-path restoration.

- [ ] **Step 7: Commit**

```powershell
git add -- src/features/configurator/scene/productionPreviewCapture.js src/features/configurator/scene/productionPreviewCapture.test.js src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "feat: capture deterministic production previews"
```

### Task 6: Two-page Chinese UV reference PDF

**Files:**

- Create: `src/features/configurator/designs/productionReferencePdf.js`
- Create: `src/features/configurator/designs/productionReferencePdf.test.js`

- [ ] **Step 1: Write failing PDF layout and encoding tests**

Inject `createCanvas` and spy on `fillText`/`drawImage`:

```js
const result = await createProductionReferencePdf({
  atlas: atlasCanvas,
  atlasSize: 4096,
  designFingerprint: '12ab34cd',
  generatedAt: '2026-07-31T08:00:00.000Z',
  model: { id: 'chelsea-jersey', version: '1', uvExportVersion: '1' },
  previewBack: backCanvas,
  previewFront: frontCanvas,
  productName: 'Chelsea Match Jersey',
  sizeLabel: 'M',
  templateLabel: 'Color Block',
  zoneColors: [
    { label: 'Body', value: '#F7F5EF' },
    { label: 'Sleeves', value: '#20242A' },
  ],
}, { createCanvas });

expect(result.blob.type).toBe('application/pdf');
expect(result.pageCount).toBe(2);
expect(result.pageSize).toEqual({ widthMm: 297, heightMm: 210 });
expect(allFillText).toContain('球衣定制生产参考');
expect(allFillText).toContain('本地设计，尚未关联 Shopify 订单');
expect(allFillText.filter((text) => text.includes('不是工厂 1:1 裁片文件'))).toHaveLength(2);
expect(drawImageSources).toEqual(expect.arrayContaining([frontCanvas, backCanvas, atlasCanvas]));
```

Inspect generated bytes for `%PDF-1.4`, two `/Type /Page` objects, two A4 landscape MediaBoxes, and `%%EOF`. Force page-canvas JPEG encoding to return `null` and expect `无法生成 PDF 页面图像。`.

- [ ] **Step 2: Run the PDF test and confirm the module is missing**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionReferencePdf.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the Chinese page canvases**

Use a fixed `1684×1191` landscape raster page. Page 1 draws:

```js
const WARNING = '此文件为 UV 参考资料，不是工厂 1:1 裁片文件。';
const PAGE_WIDTH = 1684;
const PAGE_HEIGHT = 1191;

context.fillStyle = '#ffffff';
context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
drawText(context, '球衣定制生产参考', 72, 86, '700 42px "Microsoft YaHei", sans-serif');
drawText(context, '本地设计，尚未关联 Shopify 订单', 72, 136, '24px "Microsoft YaHei", sans-serif');
drawMetadataRows(context, input, 72, 200);
drawContainedImage(context, input.previewFront, { x: 72, y: 500, width: 720, height: 520 });
drawContainedImage(context, input.previewBack, { x: 892, y: 500, width: 720, height: 520 });
drawText(context, '正面预览', 72, 1060, '700 26px "Microsoft YaHei", sans-serif');
drawText(context, '背面预览', 892, 1060, '700 26px "Microsoft YaHei", sans-serif');
drawText(context, WARNING, 72, 1134, '700 24px "Microsoft YaHei", sans-serif', '#b42318');
```

Page 2 draws `uv-atlas.png` inside `{x:72,y:110,width:1540,height:930}` without cropping, plus resolution, fingerprint, `第 2 / 2 页`, and the same warning.

- [ ] **Step 4: Implement the minimal two-image PDF container**

Use these concrete layout helpers:

```js
function drawText(context, text, x, y, font, color = '#20242a') {
  context.fillStyle = color;
  context.font = font;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillText(String(text), x, y);
}

function drawContainedImage(context, image, box) {
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  context.drawImage(
    image,
    box.x + (box.width - width) / 2,
    box.y + (box.height - height) / 2,
    width,
    height,
  );
}

function drawMetadataRows(context, input, x, y) {
  const rows = [
    ['产品', input.productName],
    ['尺码', input.sizeLabel],
    ['模型', `${input.model.id} / ${input.model.version}`],
    ['UV 导出版本', input.model.uvExportVersion],
    ['设计指纹', input.designFingerprint],
    ['生成时间', input.generatedAt],
    ['Atlas', `${input.atlasSize} × ${input.atlasSize} 像素，sRGB 参考`],
    ['模板', input.templateLabel],
    ...input.zoneColors.map((zone) => [zone.label, zone.value]),
  ];
  rows.forEach(([label, value], index) => {
    const columnX = x + Math.floor(index / 7) * 770;
    const rowY = y + (index % 7) * 34;
    drawText(context, `${label}：`, columnX, rowY, '700 20px "Microsoft YaHei", sans-serif');
    drawText(context, value, columnX + 170, rowY, '20px "Microsoft YaHei", sans-serif');
  });
}

function canvasToJpegBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob?.size) {
        reject(new Error('无法生成 PDF 页面图像。'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/jpeg', 0.94);
  });
}
```

Create exactly two page canvases:

```js
export async function createProductionReferencePdf(
  input,
  { createCanvas = defaultCreateCanvas } = {},
) {
  const first = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const firstContext = first.getContext('2d');
  if (!firstContext) throw new Error('无法创建 PDF 第 1 页画布。');
  firstContext.fillStyle = '#ffffff';
  firstContext.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  drawText(firstContext, '球衣定制生产参考', 72, 86, '700 42px "Microsoft YaHei", sans-serif');
  drawText(firstContext, '本地设计，尚未关联 Shopify 订单', 72, 136, '24px "Microsoft YaHei", sans-serif');
  drawMetadataRows(firstContext, input, 72, 200);
  drawContainedImage(firstContext, input.previewFront, { x: 72, y: 500, width: 720, height: 520 });
  drawContainedImage(firstContext, input.previewBack, { x: 892, y: 500, width: 720, height: 520 });
  drawText(firstContext, '正面预览', 72, 1060, '700 26px "Microsoft YaHei", sans-serif');
  drawText(firstContext, '背面预览', 892, 1060, '700 26px "Microsoft YaHei", sans-serif');
  drawText(firstContext, WARNING, 72, 1134, '700 24px "Microsoft YaHei", sans-serif', '#b42318');

  const second = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const secondContext = second.getContext('2d');
  if (!secondContext) throw new Error('无法创建 PDF 第 2 页画布。');
  secondContext.fillStyle = '#ffffff';
  secondContext.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  drawText(secondContext, 'UV Atlas 参考', 72, 70, '700 36px "Microsoft YaHei", sans-serif');
  drawContainedImage(secondContext, input.atlas, { x: 72, y: 110, width: 1540, height: 930 });
  drawText(secondContext, `${input.atlasSize} × ${input.atlasSize} 像素`, 72, 1080, '22px "Microsoft YaHei", sans-serif');
  drawText(secondContext, `设计指纹：${input.designFingerprint}`, 620, 1080, '22px "Microsoft YaHei", sans-serif');
  drawText(secondContext, '第 2 / 2 页', 1470, 1080, '22px "Microsoft YaHei", sans-serif');
  drawText(secondContext, WARNING, 72, 1134, '700 24px "Microsoft YaHei", sans-serif', '#b42318');

  const firstJpeg = await canvasToJpegBytes(first);
  const secondJpeg = await canvasToJpegBytes(second);
  first.width = 0;
  first.height = 0;
  second.width = 0;
  second.height = 0;
  const pdfBytes = buildRasterPdf(firstJpeg, secondJpeg);
  return {
    blob: new Blob([pdfBytes], { type: 'application/pdf' }),
    pageCount: 2,
    pageSize: { widthMm: 297, heightMm: 210 },
  };
}

function defaultCreateCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
```

Encode each page canvas as JPEG, then build:

```text
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /XObject /Subtype /Image /Width 1684 /Height 1191 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length FIRST_JPEG_BYTE_LENGTH >> stream
5 0 obj << /Length FIRST_CONTENT_BYTE_LENGTH >> stream q 841.89 0 0 595.28 0 0 cm /Im0 Do Q
6 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Im0 7 0 R >> >> /Contents 8 0 R >> endobj
7 0 obj << /Type /XObject /Subtype /Image /Width 1684 /Height 1191 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length SECOND_JPEG_BYTE_LENGTH >> stream
8 0 obj << /Length SECOND_CONTENT_BYTE_LENGTH >> stream q 841.89 0 0 595.28 0 0 cm /Im0 Do Q
```

Use byte arrays throughout:

```js
function buildRasterPdf(firstJpeg, secondJpeg) {
  const content = ascii('q 841.89 0 0 595.28 0 0 cm /Im0 Do Q');
  const objects = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>'),
    ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    streamObject(
      `/Type /XObject /Subtype /Image /Width 1684 /Height 1191 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${firstJpeg.length}`,
      firstJpeg,
    ),
    streamObject(`/Length ${content.length}`, content),
    ascii('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Im0 7 0 R >> >> /Contents 8 0 R >>'),
    streamObject(
      `/Type /XObject /Subtype /Image /Width 1684 /Height 1191 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${secondJpeg.length}`,
      secondJpeg,
    ),
    streamObject(`/Length ${content.length}`, content),
  ];
  const chunks = [ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets = [0];
  let byteLength = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(byteLength);
    const chunk = concatenate([
      ascii(`${index + 1} 0 obj\n`),
      object,
      ascii('\nendobj\n'),
    ]);
    chunks.push(chunk);
    byteLength += chunk.length;
  });
  const xrefOffset = byteLength;
  const rows = offsets.slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  chunks.push(ascii(
    `xref\n0 9\n0000000000 65535 f \n${rows}`
    + `trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ));
  return concatenate(chunks);
}

function streamObject(dictionary, bytes) {
  return concatenate([
    ascii(`<< ${dictionary} >>\nstream\n`),
    bytes,
    ascii('\nendstream'),
  ]);
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function concatenate(chunks) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}
```

Convert each page canvas with `canvas.toBlob(..., 'image/jpeg', 0.94)`, read its
`arrayBuffer`, pass both `Uint8Array`s to `buildRasterPdf`, and return:

```js
{
  blob: new Blob([pdfBytes], { type: 'application/pdf' }),
  pageCount: 2,
  pageSize: { widthMm: 297, heightMm: 210 },
}
```

- [ ] **Step 5: Run PDF tests**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionReferencePdf.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/features/configurator/designs/productionReferencePdf.js src/features/configurator/designs/productionReferencePdf.test.js
git commit -m "feat: generate chinese uv reference pdf"
```

### Task 7: Production package orchestrator

**Files:**

- Create: `src/features/configurator/designs/productionPackage.js`
- Create: `src/features/configurator/designs/productionPackage.test.js`

- [ ] **Step 1: Write failing end-to-end package tests with injected renderer artifacts**

```js
it('creates, verifies, and zips the exact six-file package', async () => {
  const result = await createProductionPackage({
    artifactProvider: vi.fn().mockResolvedValue({
      atlas: pngArtifact(4096, 4096, 'atlas'),
      legacyBakeMetadata: null,
      previews: {
        front: pngArtifact(1600, 1600, 'front'),
        back: pngArtifact(1600, 1600, 'back'),
      },
    }),
    generatedAt: '2026-07-31T08:00:00.000Z',
    product,
    selected,
    state: structuredClone(product.defaultState),
    variantId: '48039101923479',
  });

  expect(result.filename).toMatch(/^fn8788-jersey-design-[0-9a-f]{8}\.zip$/);
  expect(result.files.map((file) => file.filename)).toEqual([
    'design.json',
    'uv-atlas.png',
    'uv-reference.pdf',
    'preview-front.png',
    'preview-back.png',
    'manifest.json',
  ]);
  expect(result.manifest.atlas).toEqual({ width: 4096, height: 4096, colorSpace: 'sRGB' });
  expect(result.manifest.files).toHaveLength(5);
});
```

Also test:

- the `design.json` parses with `parseDesignDocument`;
- reopened normalized state produces the same fingerprint;
- the provider receives a structured-cloned snapshot and model metadata;
- a 2048 atlas fails against configured 4096;
- an empty preview, PDF failure, hash mismatch, or ZIP failure returns no partial result.

- [ ] **Step 2: Run the package test and confirm the module is missing**

Run:

```powershell
npx vitest run src/features/configurator/designs/productionPackage.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement sequential orchestration**

```js
export async function createProductionPackage({
  artifactProvider,
  generatedAt = new Date().toISOString(),
  product,
  selected,
  state,
  variantId = null,
}) {
  if (typeof artifactProvider !== 'function') {
    throw new Error('3D 模型尚未准备完成，无法生成生产文件。');
  }
  const stateSnapshot = structuredClone(state);
  const size = stateSnapshot.layout;
  const fingerprint = await createDesignFingerprint({
    model: product.model,
    productId: product.id,
    size,
    state: stateSnapshot,
    variantId,
  });
  const designDocument = createDesignDocument({
    productId: product.id,
    savedAt: generatedAt,
    state: stateSnapshot,
    variantId,
  });
  const designBlob = new Blob(
    [JSON.stringify(designDocument, null, 2)],
    { type: 'application/json' },
  );
  const rendered = await artifactProvider({
    model: structuredClone(product.model),
    stateSnapshot,
  });
  assertImageContract(rendered, product.model.uvAtlasSize);

  const pdf = await createProductionReferencePdf(toPdfInput({
    fingerprint,
    generatedAt,
    product,
    rendered,
    selected,
    size,
  }));
  rendered.atlas.canvas.width = 0;
  rendered.atlas.canvas.height = 0;
  rendered.previews.front.canvas.width = 0;
  rendered.previews.front.canvas.height = 0;
  rendered.previews.back.canvas.width = 0;
  rendered.previews.back.canvas.height = 0;
  const artifacts = [
    file('design.json', designBlob, 'application/json'),
    file('uv-atlas.png', rendered.atlas.blob, 'image/png'),
    file('uv-reference.pdf', pdf.blob, 'application/pdf'),
    file('preview-front.png', rendered.previews.front.blob, 'image/png'),
    file('preview-back.png', rendered.previews.back.blob, 'image/png'),
  ];
  const manifest = await createProductionManifest({
    atlas: { colorSpace: 'sRGB', height: rendered.atlas.height, width: rendered.atlas.width },
    designFingerprint: fingerprint,
    files: artifacts,
    generatedAt,
    model: { id: product.model.id, version: product.model.version },
    productId: product.id,
    size,
    uvExportVersion: product.model.uvExportVersion,
    variantId,
  });
  await verifyProductionArtifacts(artifacts, manifest);
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const files = [...artifacts, file('manifest.json', manifestBlob, 'application/json')]
    .map(({ blob, name }) => ({ blob, filename: name }));
  const bundle = await createProductionBundle({ files, fingerprint, productId: product.id });
  return {
    ...bundle,
    files,
    fingerprint,
    legacyBakeMetadata: rendered.legacyBakeMetadata,
    manifest,
  };
}

function file(name, blob, mediaType) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error(`生产文件 "${name}" 为空。`);
  }
  if (blob.type !== mediaType) {
    throw new Error(`生产文件 "${name}" 的媒体类型不正确。`);
  }
  return { blob, mediaType, name };
}

function assertImageContract(rendered, atlasSize) {
  if (
    rendered?.atlas?.width !== atlasSize
    || rendered?.atlas?.height !== atlasSize
    || rendered?.atlas?.blob?.type !== 'image/png'
    || rendered.atlas.blob.size === 0
  ) throw new Error(`UV Atlas 必须是 ${atlasSize}×${atlasSize} PNG。`);
  for (const [label, preview] of Object.entries(rendered.previews ?? {})) {
    if (
      !['front', 'back'].includes(label)
      || preview.width < 1
      || preview.height < 1
      || preview.blob?.type !== 'image/png'
      || preview.blob.size === 0
      || !preview.canvas
    ) throw new Error('正面或背面预览 PNG 无效。');
  }
  if (!rendered.previews?.front || !rendered.previews?.back || !rendered.atlas.canvas) {
    throw new Error('生产预览数据不完整。');
  }
}

function toPdfInput({
  fingerprint,
  generatedAt,
  product,
  rendered,
  selected,
  size,
}) {
  const zoneLabels = {
    body: '衣身',
    sleeves: '袖子',
    shoulderSide: '肩部与侧面',
    collar: '领口',
    pattern: '图案',
    number: '号码',
  };
  const templateLabels = {
    solid: '纯色',
    'vertical-stripes': '竖条纹',
    'horizontal-stripes': '横条纹',
    diagonal: '斜纹',
    gradient: '渐变',
    'color-block': '色块',
  };
  return {
    atlas: rendered.atlas.canvas,
    atlasSize: product.model.uvAtlasSize,
    designFingerprint: fingerprint,
    generatedAt,
    model: {
      id: product.model.id,
      version: product.model.version,
      uvExportVersion: product.model.uvExportVersion,
    },
    previewBack: rendered.previews.back.canvas,
    previewFront: rendered.previews.front.canvas,
    productName: product.name,
    sizeLabel: selected.layout?.shortLabel ?? selected.layout?.label ?? size,
    templateLabel: templateLabels[selected.appearance.template],
    zoneColors: Object.entries(selected.appearance.colors).map(([id, value]) => ({
      label: zoneLabels[id],
      value,
    })),
  };
}
```

All PDF input comes from the frozen `selected`/product snapshot and renderer artifacts, never from mutable DOM state. Zeroing the temporary canvases happens only after the PDF has consumed them; the already encoded PNG blobs remain intact for hashing and ZIP creation.

- [ ] **Step 4: Run all design-module tests**

Run:

```powershell
npx vitest run src/features/configurator/designs
```

Expected: all design tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/features/configurator/designs/productionPackage.js src/features/configurator/designs/productionPackage.test.js
git commit -m "feat: orchestrate verified production package"
```

### Task 8: ProductStage provider lifecycle and Save-design UI integration

**Files:**

- Modify: `src/features/configurator/scene/ProductStage.jsx:21-30,239-242`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx:45-180,275-350`
- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx:6-115,509-590,784-821,1095-1114`

- [ ] **Step 1: Write failing provider lifecycle tests**

Extend the mocked renderer:

```js
prepareProductionArtifacts(request) {
  rendererHarness.productionRequests.push(request);
  return rendererHarness.productionResult;
}
```

Test:

```js
const onProductionProvider = vi.fn();
const view = render(
  <ProductStage
    onProductionProvider={onProductionProvider}
    onStatePatch={vi.fn()}
    product={product}
    selected={selected}
    state={state}
  />,
);
const provider = onProductionProvider.mock.calls.at(-1)[0];
await provider({ model: product.model, stateSnapshot: state });
expect(rendererHarness.productionRequests).toEqual([{ model: product.model, stateSnapshot: state }]);
view.unmount();
expect(onProductionProvider).toHaveBeenLastCalledWith(null);
```

- [ ] **Step 2: Write failing ConfiguratorPage tests for the new always-ZIP flow**

Change the renderer harness to expose one complete production result. Replace the JSON-only expectation with:

```js
fireEvent.click(screen.getByRole('button', { name: 'Save design' }));
const download = await screen.findByRole('link', { name: 'Download production ZIP' });
expect(download).toHaveAttribute(
  'download',
  expect.stringMatching(/^fn8788-jersey-design-[0-9a-f]{8}\.zip$/),
);
expect(screen.queryByRole('link', { name: 'Download design JSON' })).not.toBeInTheDocument();
```

Add tests that:

- keep **Save design** disabled while the provider promise is pending;
- click Save twice, resolve second then first, and publish only the second;
- mutate size during generation and publish nothing;
- invalidate and revoke an already prepared ZIP immediately after any state mutation;
- unmount during generation and never call `URL.createObjectURL`;
- show the Chinese provider/package error and expose no ZIP;
- preserve the existing bottom-pattern cart receipt fields using the full Atlas filename/hash/bundle filename.

- [ ] **Step 3: Run the two UI test files and confirm failures**

Run:

```powershell
npx vitest run src/features/configurator/scene/ProductStage.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx
```

Expected: FAIL because the old page registers only `onBakeProvider` and saves JSON when bottom pattern is disabled.

- [ ] **Step 4: Replace `onBakeProvider` with `onProductionProvider`**

In `ProductStage`:

```js
useEffect(() => {
  onProductionProvider?.((request) => (
    rendererRef.current?.prepareProductionArtifacts?.(request)
  ));
  return () => onProductionProvider?.(null);
}, [onProductionProvider]);
```

Update the prop name at the declaration and call site. Do not retain a second bake-provider registration.

- [ ] **Step 5: Make Save design always create the verified package**

Add:

```js
const [productionPending, setProductionPending] = useState(false);
const productionProviderRef = useRef(null);

const invalidatePreparedDownload = () => {
  setLocalProductionReceipt(null);
  setPreparedDownload(null);
};
```

Update mutation start:

```js
function handleMutationStart() {
  saveRequestIdRef.current += 1;
  invalidatePreparedDownload();
  cancelActiveCartRequest();
}
```

Replace `handleSaveDesign`:

```js
const handleSaveDesign = async () => {
  if (personalizationSidePendingRef.current || hasPendingMutation() || productionPending) return;
  const requestId = saveRequestIdRef.current + 1;
  const stateSnapshot = structuredClone(latestStateRef.current);
  saveRequestIdRef.current = requestId;
  const isCurrentRequest = () => (
    mountedRef.current
    && saveRequestIdRef.current === requestId
    && canonicalizeProductionValue(latestStateRef.current)
      === canonicalizeProductionValue(stateSnapshot)
  );
  setProductionPending(true);
  try {
    setFileError('');
    const result = await createProductionPackage({
      artifactProvider: productionProviderRef.current,
      product,
      selected,
      state: stateSnapshot,
      variantId: shopifyContext?.variantId ?? null,
    });
    if (!isCurrentRequest()) return;
    const atlasRecord = result.manifest.files.find((file) => file.name === 'uv-atlas.png');
    const receipt = shouldPrepareBottomPatternAsset(stateSnapshot)
      ? createLocalProductionReceipt({
          state: stateSnapshot,
          productionFiles: {
            atlasFilename: 'uv-atlas.png',
            atlasSha256: `sha256:${atlasRecord.sha256}`,
            bundleFilename: result.filename,
            designFilename: 'design.json',
          },
        })
      : null;
    setLocalProductionReceipt(null);
    setPreparedDownload({
      ...createBrowserDownload(result),
      label: 'Download production ZIP',
      receipt,
    });
  } catch (error) {
    if (isCurrentRequest()) {
      setFileError(error instanceof Error ? error.message : '生产文件生成失败。');
    }
  } finally {
    if (mountedRef.current && saveRequestIdRef.current === requestId) {
      setProductionPending(false);
    }
  }
};
```

Pass `saveDisabled={snapshotMutationPending || productionPending}` to `TopBar`, `mutationPending={snapshotMutationPending || productionPending}` to the review dialog, and register:

```jsx
onProductionProvider={(provider) => {
  productionProviderRef.current = provider;
}}
```

- [ ] **Step 6: Run UI tests and all legacy cart tests**

Run:

```powershell
npx vitest run src/features/configurator/scene/ProductStage.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/shopify/cartQuoteClient.test.js src/features/configurator/designs/localProductionReceipt.test.js
```

Expected: all tests PASS; patterned cart behavior remains unchanged except for deterministic ZIP naming.

- [ ] **Step 7: Commit**

```powershell
git add -- src/features/configurator/scene/ProductStage.jsx src/features/configurator/scene/ProductStage.test.jsx src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx
git commit -m "feat: generate production zip from save design"
```

### Task 9: Real-model verification tool, full regression, PDF visual QA, and handoff

**Files:**

- Create: `scripts/verify-production-package.mjs`
- Create: `docs/superpowers/handoffs/2026-07-31-phase2-production-files-handoff.md`
- Modify only if a real failure is found: files already named in Tasks 1–8

- [ ] **Step 1: Add a deterministic downloaded-package verifier**

The script accepts one ZIP path and:

1. parses store-only ZIP local headers;
2. asserts the exact six names;
3. decodes `manifest.json`;
4. recalculates SHA-256 for the five listed files with `node:crypto`;
5. reads PNG IHDR width/height and asserts Atlas `4096×4096`;
6. counts PDF `/Type /Page` objects and asserts exactly two.

Entrypoint:

```js
const zipPath = process.argv[2];
if (!zipPath) throw new Error('Usage: node scripts/verify-production-package.mjs C:\\Downloads\\package.zip');
const entries = readStoreOnlyZip(await readFile(resolve(zipPath)));
assert.deepEqual([...entries.keys()], [
  'design.json',
  'uv-atlas.png',
  'uv-reference.pdf',
  'preview-front.png',
  'preview-back.png',
  'manifest.json',
]);
verifyManifest(entries);
assert.deepEqual(readPngSize(entries.get('uv-atlas.png')), { width: 4096, height: 4096 });
assert.equal(countPdfPages(entries.get('uv-reference.pdf')), 2);
console.log('Production package verification: PASS');
```

- [ ] **Step 2: Run the complete automated suite**

Run:

```powershell
npm test
```

Expected: all Vitest files and tests PASS with zero unhandled errors.

- [ ] **Step 3: Run both production builds**

Run:

```powershell
npm run build:app
npm run build:shopify
```

Expected: both commands exit 0; no unresolved imports or chunk-generation errors.

- [ ] **Step 4: Browser acceptance on Chelsea**

Run the app and test in a real browser:

```powershell
npm run dev -- --host 127.0.0.1
```

Create front and back player sets, front/back custom text, one preset artwork, and one uploaded transparent PNG. Save and download the ZIP. Confirm:

- the editor view does not move during capture;
- the prepared link is `Download production ZIP`;
- the filename matches `fn8788-jersey-design-????????.zip`;
- changing size removes the prepared link and revokes its object URL;
- reopening extracted `design.json` restores all editable elements.

- [ ] **Step 5: Browser/real-model acceptance on FN8788**

Use the existing Shopify section harness with `public/models/fn8788-jersey.glb`, repeat front/back player, text, preset, and upload placement, then export. This is a separate model geometry check; do not change the product's immutable Chelsea metadata merely to run the harness.

- [ ] **Step 6: Verify both downloaded packages**

Run for each file:

```powershell
Get-ChildItem 'C:\Users\Administrator\Downloads\fn8788-jersey-design-*.zip' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 |
  ForEach-Object { node scripts/verify-production-package.mjs $_.FullName }
```

Expected: `Production package verification: PASS`.

- [ ] **Step 7: Render and visually inspect both PDF pages**

Extract `uv-reference.pdf`, then:

```powershell
pdftoppm -png -r 144 'C:\path\to\uv-reference.pdf' 'C:\path\to\uv-reference-page'
```

Inspect both rendered PNGs. Required PASS criteria:

- Chinese glyphs are readable and not tofu/missing;
- front/back preview labels match the images;
- no metadata or warning is cropped;
- page 2 Atlas is complete and uncropped;
- the warning “不是工厂 1:1 裁片文件” appears on both pages;
- page count is exactly two.

- [ ] **Step 8: Inspect the 4096 Atlas and manifest**

Required PASS criteria for both Chelsea and FN8788 packages:

- base template and all zone colors are visible on the expected UV islands;
- front elements do not appear on back islands and vice versa;
- player set, custom text, preset artwork, and uploaded artwork are all present;
- transparent artwork background remains transparent;
- layer overlap matches the live renderer;
- manifest byte lengths and SHA-256 hashes match the extracted five artifacts.

- [ ] **Step 9: Record evidence and remaining boundary**

Create the handoff with:

- branch and commit SHAs;
- exact test/build commands and counts;
- package filenames and fingerprints;
- verifier results;
- PDF page render image paths;
- Chelsea/FN8788 visual matrix;
- known limitation: PDF/Atlas are UV production-reference data, not factory 1:1 cutting patterns;
- rollback target: phase-1 Worker version `810543ff-bdd0-4d3d-a42f-d454161cf7b5`.

- [ ] **Step 10: Run final diff and repository checks**

Run:

```powershell
git diff --check
git status --short
git log --oneline -10
```

Expected: no whitespace errors; only intended phase-2 files are changed; user-owned main-worktree changes are absent from this isolated worktree.

- [ ] **Step 11: Commit verification evidence**

```powershell
git add -- scripts/verify-production-package.mjs docs/superpowers/handoffs/2026-07-31-phase2-production-files-handoff.md
git commit -m "test: verify phase 2 production packages"
```

## Final completion gate

Phase 2 is complete only when all of the following are true:

- every Save action prepares a verified ZIP, even when the hidden legacy bottom pattern is disabled;
- ZIP entries are exactly the approved six names;
- Atlas is a real 4096×4096 PNG with base appearance, player sets, custom text, preset/uploaded artwork, alpha, order, and side isolation;
- front/back capture restores the shopper's camera, target, selection, controls, background, and transient visibility on success and failure;
- PDF is two A4 landscape pages with readable rasterized Chinese and the non-1:1 warning;
- manifest hashes and byte lengths are reverified before ZIP creation;
- stale, concurrent, failed, and unmounted requests cannot publish a download;
- design JSON reopens and preserves normalized state/fingerprint;
- Chelsea and FN8788 real-model checks pass;
- full tests, app build, and Shopify build pass;
- no phase-3 cloud/order behavior or phase-5 model-admin behavior has been added.
