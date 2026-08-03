# UV Pattern Output Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为生产裁片图增加模型级最终旋转/镜像参数，使当前 Chelsea 和 FN8788 的裁片与 `PLAYER 16` 文字最终朝上且从左到右可读。

**Architecture:** 保留现有单片 UV 提取与方向修正，在最终 4096×4096 排版画布的绘制上下文上再应用一次模型级刚性变换。一个聚焦的新模块负责最终变换的默认值、点/矩形坐标映射和 Canvas 变换；模型配置负责参数校验，生产包负责把同一变换写入指纹与 Manifest。

**Tech Stack:** JavaScript ES modules、Canvas 2D、Vitest、Three.js/GLTFLoader、原生 Chrome Canvas 验收、现有 ZIP/PDF/Manifest 生产链路。

---

## 文件结构

- Create: `src/features/configurator/scene/uvPatternOutputTransform.js` — 最终裁片图变换的纯坐标函数和 Canvas 上下文变换。
- Create: `src/features/configurator/scene/uvPatternOutputTransform.test.js` — 不依赖模型配置反算结果的点、矩形及调用顺序测试。
- Modify: `src/features/configurator/config/modelUvLayouts.js` — 冻结、配置并校验模型级 `patternOutputTransform`。
- Modify: `src/features/configurator/config/modelUvLayouts.test.js` — 固定正式模型参数、默认兼容及无效配置失败行为。
- Modify: `src/features/configurator/config/productDefinitions.js` — 把当前产品的 `uvExportVersion` 提升到 2，使新旧 ZIP 指纹不同。
- Modify: `src/features/configurator/scene/uvPatternPieces.js` — 在排版绘制时应用最终变换，更新 `outputBounds`、返回元数据和布局指纹。
- Modify: `src/features/configurator/scene/uvPatternPieces.test.js` — 固定最终变换、坐标、覆盖率和指纹契约。
- Modify: `src/features/configurator/scene/uvPatternPieces.browser.test.js` — 用真实 Canvas 和不对称四色角证明当前两层变换最终恢复为正向。
- Modify: `src/features/configurator/scene/realGarmentPatternTestOracle.js` — 让测试 oracle 独立映射最终整图变换后的采样点。
- Modify: `src/features/configurator/scene/realGarmentPatternTestOracle.test.js` — 固定 oracle 的最终变换坐标契约。
- Modify: `src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js` — 对两个真实 GLB 验证最终方向元数据及图案保真。
- Modify: `src/features/configurator/designs/productionPackage.js` — 把渲染结果的最终变换传入 Manifest。
- Modify: `src/features/configurator/designs/productionPackage.test.js` — 验证七文件包记录最终变换。
- Modify: `src/features/configurator/designs/productionManifest.js` — 校验 `patternPieces.outputTransform`。
- Modify: `src/features/configurator/designs/productionManifest.test.js` — 拒绝缺失或无效的最终变换。
- Modify: `src/features/configurator/designs/productionFingerprint.js` — 把生产包 Schema 提升到 2。
- Modify: `src/features/configurator/designs/productionFingerprint.test.js` — 固定 Schema 2 对设计指纹的参与方式。
- Modify: `scripts/verify-production-package.mjs` — CLI verifier 同步校验最终变换。
- Modify: `scripts/verify-production-package.test.js` — 固定 verifier 的新 Manifest 契约。
- Create: `project-logs/changes/2026-08-03-uv-pattern-output-transform.md` — 记录根因、文件、验证和发布状态。

### Task 1: 模型级参数契约

**Files:**
- Modify: `src/features/configurator/config/modelUvLayouts.test.js`
- Modify: `src/features/configurator/config/modelUvLayouts.js`
- Modify: `src/features/configurator/config/productDefinitions.js`

- [ ] **Step 1: 写正式模型参数、冻结和校验的失败测试**

在正式模型断言中加入：

```js
expect(layout.patternOutputTransform).toEqual({
  rotation: 180,
  mirrorX: true,
});
expect(layout.version).toBe(2);
```

在冻结测试中加入：

```js
expect(Object.isFrozen(layout.patternOutputTransform)).toBe(true);
```

增加无效参数和缺省兼容测试：

```js
it.each([
  ['不是对象', null, 'patternOutputTransform'],
  ['角度不受支持', { rotation: 45, mirrorX: true }, 'rotation'],
  ['镜像不是 boolean', { rotation: 180, mirrorX: 'true' }, 'mirrorX'],
])('拒绝无效最终裁片图变换：%s', (_label, patternOutputTransform, message) => {
  const layout = createValidLayout();
  layout.patternOutputTransform = patternOutputTransform;

  expect(() => validateModelUvLayout(layout, VALID_MESHES)).toThrow(message);
});

it('允许旧测试布局省略最终裁片图变换', () => {
  expect(validateModelUvLayout(createValidLayout(), VALID_MESHES)).toBe(true);
});

it('bumps the product UV export version for the corrected production output', () => {
  expect(jerseyProduct.model.uvExportVersion).toBe('2');
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run src/features/configurator/config/modelUvLayouts.test.js`

Expected: FAIL，正式布局缺少 `patternOutputTransform`，无效参数未被拒绝，变换对象未被冻结。

- [ ] **Step 3: 实现最小模型配置和校验**

在 `freezeLayout` 中冻结可选参数：

```js
function freezeLayout(layout) {
  const frozenLayout = {
    ...layout,
    pieceGroups: freezeGroups(layout.pieceGroups),
  };
  if (layout.patternOutputTransform) {
    frozenLayout.patternOutputTransform = Object.freeze({
      ...layout.patternOutputTransform,
    });
  }
  if (layout.appearanceGroups) {
    frozenLayout.appearanceGroups = freezeGroups(layout.appearanceGroups);
  }
  return Object.freeze(frozenLayout);
}
```

把 Chelsea 与 FN8788 布局的 `version` 改为 `2`，并在布局根级加入带维护注释的参数：

```js
patternOutputTransform: {
  rotation: 180,
  mirrorX: true,
  // 当前 GLB/UV 的生产裁片图需要先旋转 180°再水平镜像。
  // 后续模型若导出时已经朝上，将 rotation 改为 0；
  // 若文字也已经从左到右可读，将 mirrorX 改为 false。
},
```

在 `validateModelUvLayout` 的版本校验后调用：

```js
validatePatternOutputTransform(layout.patternOutputTransform);
```

并增加：

```js
function validatePatternOutputTransform(transform) {
  if (transform === undefined) return;
  if (!isObject(transform)) {
    throwInvalidLayout('patternOutputTransform 必须是对象');
  }
  if (![0, 90, 180, 270].includes(transform.rotation)) {
    throwInvalidLayout('patternOutputTransform.rotation 必须是 0、90、180 或 270 度');
  }
  if (typeof transform.mirrorX !== 'boolean') {
    throwInvalidLayout('patternOutputTransform.mirrorX 必须是 boolean');
  }
}
```

在 `productDefinitions.js` 中修改：

```js
uvExportVersion: '2',
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npx vitest run src/features/configurator/config/modelUvLayouts.test.js`

Expected: PASS，正式模型均为 `{ rotation: 180, mirrorX: true }`，旧夹具仍可省略该字段。

- [ ] **Step 5: 提交配置契约**

```powershell
git add -- src/features/configurator/config/modelUvLayouts.js src/features/configurator/config/modelUvLayouts.test.js src/features/configurator/config/productDefinitions.js
git commit -m "feat: configure UV pattern output orientation"
```

### Task 2: 最终画布变换模块

**Files:**
- Create: `src/features/configurator/scene/uvPatternOutputTransform.js`
- Create: `src/features/configurator/scene/uvPatternOutputTransform.test.js`

- [ ] **Step 1: 写点、矩形、默认值和 Canvas 调用顺序的失败测试**

创建测试文件，核心断言为：

```js
import { describe, expect, it, vi } from 'vitest';
import {
  applyPatternOutputTransform,
  resolvePatternOutputTransform,
  transformPatternOutputBounds,
  transformPatternOutputPoint,
} from './uvPatternOutputTransform.js';

describe('UV pattern output transform', () => {
  it('defaults missing model configuration to identity', () => {
    expect(resolvePatternOutputTransform({})).toEqual({ rotation: 0, mirrorX: false });
  });

  it.each([
    [0, false, { x: 1, y: 2 }],
    [90, false, { x: 6, y: 1 }],
    [180, false, { x: 9, y: 6 }],
    [270, false, { x: 2, y: 9 }],
    [180, true, { x: 1, y: 6 }],
  ])('maps a point for rotation %i mirrorX=%s', (rotation, mirrorX, expected) => {
    expect(transformPatternOutputPoint(
      { x: 1, y: 2 },
      { width: 10, height: 8, rotation, mirrorX },
    )).toEqual(expected);
  });

  it('maps all four bounds corners before recomputing the rectangle', () => {
    expect(transformPatternOutputBounds(
      { x: 2, y: 1, width: 3, height: 4 },
      { width: 10, height: 8, rotation: 180, mirrorX: true },
    )).toEqual({ x: 2, y: 3, width: 3, height: 4 });
  });

  it('applies rotation before horizontal mirroring to Canvas coordinates', () => {
    const context = {
      rotate: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
    };
    applyPatternOutputTransform(context, {
      width: 4096,
      height: 4096,
      rotation: 180,
      mirrorX: true,
    });
    expect(context.translate.mock.calls).toEqual([[4096, 0], [4096, 4096]]);
    expect(context.scale).toHaveBeenCalledWith(-1, 1);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI);
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run src/features/configurator/scene/uvPatternOutputTransform.test.js`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现聚焦的最终变换模块**

创建：

```js
const IDENTITY_PATTERN_OUTPUT_TRANSFORM = Object.freeze({
  rotation: 0,
  mirrorX: false,
});

export function resolvePatternOutputTransform(uvLayout) {
  const transform = uvLayout?.patternOutputTransform;
  return transform
    ? { rotation: transform.rotation, mirrorX: transform.mirrorX }
    : { ...IDENTITY_PATTERN_OUTPUT_TRANSFORM };
}

export function transformPatternOutputPoint(point, {
  width,
  height,
  rotation,
  mirrorX,
}) {
  let transformed;
  switch (rotation) {
    case 90:
      transformed = { x: height - point.y, y: point.x };
      break;
    case 180:
      transformed = { x: width - point.x, y: height - point.y };
      break;
    case 270:
      transformed = { x: point.y, y: width - point.x };
      break;
    default:
      transformed = { ...point };
  }
  const outputWidth = rotation === 90 || rotation === 270 ? height : width;
  return mirrorX
    ? { x: outputWidth - transformed.x, y: transformed.y }
    : transformed;
}

export function transformPatternOutputBounds(bounds, transform) {
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => transformPatternOutputPoint(point, transform));
  const xValues = corners.map(({ x }) => x);
  const yValues = corners.map(({ y }) => y);
  const x = Math.min(...xValues);
  const y = Math.min(...yValues);
  return {
    x,
    y,
    width: Math.max(...xValues) - x,
    height: Math.max(...yValues) - y,
  };
}

export function applyPatternOutputTransform(context, {
  width,
  height,
  rotation,
  mirrorX,
}) {
  const outputWidth = rotation === 90 || rotation === 270 ? height : width;
  if (mirrorX) {
    context.translate(outputWidth, 0);
    context.scale(-1, 1);
  }
  switch (rotation) {
    case 90:
      context.translate(height, 0);
      context.rotate(Math.PI / 2);
      break;
    case 180:
      context.translate(width, height);
      context.rotate(Math.PI);
      break;
    case 270:
      context.translate(0, width);
      context.rotate(Math.PI * 3 / 2);
      break;
    default:
      break;
  }
}
```

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npx vitest run src/features/configurator/scene/uvPatternOutputTransform.test.js`

Expected: PASS，`180 + mirrorX` 的点映射等价于只翻转 Y。

- [ ] **Step 5: 提交变换模块**

```powershell
git add -- src/features/configurator/scene/uvPatternOutputTransform.js src/features/configurator/scene/uvPatternOutputTransform.test.js
git commit -m "feat: add UV pattern output transform"
```

### Task 3: 接入裁片渲染、坐标和指纹

**Files:**
- Modify: `src/features/configurator/scene/uvPatternPieces.test.js`
- Modify: `src/features/configurator/scene/uvPatternPieces.browser.test.js`
- Modify: `src/features/configurator/scene/uvPatternPieces.js`

- [ ] **Step 1: 写渲染结果和指纹的失败测试**

在 `uvPatternPieces.test.js` 增加：

```js
it('applies the model output transform once and returns transformed bounds', async () => {
  const harness = installCanvasHarness();
  const uvLayout = createLayout();
  uvLayout.patternOutputTransform = { rotation: 180, mirrorX: true };

  const result = await createUvPatternPieces(createInput(harness, { uvLayout }));

  expect(result.outputTransform).toEqual({ rotation: 180, mirrorX: true });
  expect(result.pieces[0].outputBounds.y).toBeGreaterThan(2048);
  expect(calls(harness.created, 'scale')
    .filter(({ args }) => args[0] === -1 && args[1] === 1)).toHaveLength(1);
});

it('includes the final output transform in the layout fingerprint', async () => {
  const harness = installCanvasHarness();
  const identity = createLayout();
  const corrected = createLayout();
  corrected.patternOutputTransform = { rotation: 180, mirrorX: true };

  const first = await createUvPatternPieces(createInput(harness, { uvLayout: identity }));
  const second = await createUvPatternPieces(createInput(harness, { uvLayout: corrected }));

  expect(second.layoutFingerprint).not.toBe(first.layoutFingerprint);
});
```

在 Chrome smoke 的 `uvLayout` 中给正、背片都使用 `rotation: 180, mirrorX: true`，并增加：

```js
patternOutputTransform: { rotation: 180, mirrorX: true },
```

把不对称四色角固定为原始可读方向：

```js
[
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
].forEach((color, index) => expectOpaqueColor(smokeResult.backCorners[index], color));
expect(smokeResult.outputTransform).toEqual({ rotation: 180, mirrorX: true });
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run src/features/configurator/scene/uvPatternPieces.test.js src/features/configurator/scene/uvPatternPieces.browser.test.js`

Expected: FAIL，结果缺少 `outputTransform`，画布未执行最终变换，指纹不变。

- [ ] **Step 3: 在排版画布上只应用一次最终变换**

在 `uvPatternPieces.js` 导入：

```js
import {
  applyPatternOutputTransform,
  resolvePatternOutputTransform,
  transformPatternOutputBounds,
} from './uvPatternOutputTransform.js';
```

创建画布后、绘制循环前加入：

```js
const outputTransform = resolvePatternOutputTransform(uvLayout);
const canvasTransform = {
  ...outputTransform,
  width: OUTPUT_SIZE,
  height: OUTPUT_SIZE,
};
context.save();
applyPatternOutputTransform(context, canvasTransform);
```

每片继续使用 `layout[index].outputBounds` 作为绘制坐标，但元数据改用最终矩形：

```js
const layoutBounds = layout[index].outputBounds;
context.drawImage(
  orientedCanvas,
  layoutBounds.x,
  layoutBounds.y,
  layoutBounds.width,
  layoutBounds.height,
);
const outputBounds = transformPatternOutputBounds(layoutBounds, canvasTransform);
const piece = createPieceMetadata(
  extracted.group,
  extracted.mappedTriangles,
  extracted.sourceBounds,
  outputBounds,
  scale,
);
```

用 `try/finally` 保证循环结束或失败时执行 `context.restore()`。`scanCoveragePixels` 使用最终 `piece.outputBounds`，因为 `getImageData` 不受当前 Canvas 变换矩阵影响。

布局指纹和返回值改为：

```js
const layoutFingerprint = createLayoutFingerprint(
  uvLayout.version,
  outputTransform,
  pieces,
);
return {
  blob,
  canvas,
  width: OUTPUT_SIZE,
  height: OUTPUT_SIZE,
  outputTransform,
  pieces,
  layoutFingerprint,
};
```

指纹序列化增加：

```js
outputTransform,
```

- [ ] **Step 4: 运行单元和原生 Canvas 测试并确认 GREEN**

Run: `npx vitest run src/features/configurator/scene/uvPatternOutputTransform.test.js src/features/configurator/scene/uvPatternPieces.test.js src/features/configurator/scene/uvPatternPieces.browser.test.js`

Expected: PASS；四色角证明当前单片修正与最终修正组合后恢复原始上下和左右方向。

- [ ] **Step 5: 提交裁片渲染接入**

```powershell
git add -- src/features/configurator/scene/uvPatternPieces.js src/features/configurator/scene/uvPatternPieces.test.js src/features/configurator/scene/uvPatternPieces.browser.test.js
git commit -m "fix: correct final UV pattern orientation"
```

### Task 4: Manifest、生产包和 CLI verifier

**Files:**
- Modify: `src/features/configurator/designs/productionPackage.test.js`
- Modify: `src/features/configurator/designs/productionPackage.js`
- Modify: `src/features/configurator/designs/productionManifest.test.js`
- Modify: `src/features/configurator/designs/productionManifest.js`
- Modify: `src/features/configurator/designs/productionFingerprint.test.js`
- Modify: `src/features/configurator/designs/productionFingerprint.js`
- Modify: `scripts/verify-production-package.test.js`
- Modify: `scripts/verify-production-package.mjs`

- [ ] **Step 1: 写生产包和 Manifest 的失败测试**

在所有 `createPatternPieces` / `createRenderedArtifacts().pieces` 夹具中加入：

```js
outputTransform: { rotation: 180, mirrorX: true },
```

把生产包 Schema 与正式产品导出版本断言改为：

```js
expect(PRODUCTION_PACKAGE_SCHEMA_VERSION).toBe(2);
expect(result.manifest.schemaVersion).toBe(2);
expect(result.manifest.uvExportVersion).toBe('2');
```

在生产包断言中加入：

```js
patternPieces: expect.objectContaining({
  outputTransform: { rotation: 180, mirrorX: true },
}),
```

在 Manifest 与 CLI verifier 的拒绝列表中加入：

```js
['missing output transform', (input) => ({
  ...input,
  patternPieces: { ...input.patternPieces, outputTransform: undefined },
})],
['unsupported output rotation', (input) => ({
  ...input,
  patternPieces: {
    ...input.patternPieces,
    outputTransform: { rotation: 45, mirrorX: true },
  },
})],
['invalid output mirror', (input) => ({
  ...input,
  patternPieces: {
    ...input.patternPieces,
    outputTransform: { rotation: 180, mirrorX: 'true' },
  },
})],
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run src/features/configurator/designs/productionPackage.test.js src/features/configurator/designs/productionManifest.test.js scripts/verify-production-package.test.js`

Expected: FAIL，生产包没有传递字段，两个校验器没有拒绝无效变换。

- [ ] **Step 3: 传递并校验最终变换**

在 `productionFingerprint.js` 中修改：

```js
export const PRODUCTION_PACKAGE_SCHEMA_VERSION = 2;
```

在 `productionPackage.js` 的 `patternPieces` 输入中加入：

```js
outputTransform: rendered.pieces.outputTransform,
```

在 `productionManifest.js` 增加：

```js
function isValidOutputTransform(transform) {
  return transform !== null
    && typeof transform === 'object'
    && !Array.isArray(transform)
    && [0, 90, 180, 270].includes(transform.rotation)
    && typeof transform.mirrorX === 'boolean';
}
```

并把以下条件加入 `validatePatternPieces` 的首段失败条件：

```js
|| !isValidOutputTransform(patternPieces.outputTransform)
```

在 `scripts/verify-production-package.mjs` 加入同样的结构校验条件：

```js
|| !isValidOutputTransform(declared.outputTransform)
```

同时在独立 CLI verifier 中定义 `EXPECTED_SCHEMA_VERSION = 2`，并在读取 Manifest 后拒绝其他版本：

```js
if (manifest?.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
  throw new Error(`manifest.json schemaVersion must be ${EXPECTED_SCHEMA_VERSION}`);
}
```

CLI 文件内使用相同字段约束，不导入浏览器模块，保持 Node verifier 独立可运行。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `npx vitest run src/features/configurator/designs/productionPackage.test.js src/features/configurator/designs/productionManifest.test.js scripts/verify-production-package.test.js`

Expected: PASS，Manifest 和 CLI verifier 都强制要求合法的 `outputTransform`。

- [ ] **Step 5: 提交生产包契约**

```powershell
git add -- src/features/configurator/designs/productionPackage.js src/features/configurator/designs/productionPackage.test.js src/features/configurator/designs/productionManifest.js src/features/configurator/designs/productionManifest.test.js src/features/configurator/designs/productionFingerprint.js src/features/configurator/designs/productionFingerprint.test.js scripts/verify-production-package.mjs scripts/verify-production-package.test.js
git commit -m "feat: record UV output transform in production packages"
```

### Task 5: 两个真实 GLB 的方向回归

**Files:**
- Modify: `src/features/configurator/scene/realGarmentPatternTestOracle.test.js`
- Modify: `src/features/configurator/scene/realGarmentPatternTestOracle.js`
- Modify: `src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js`

- [ ] **Step 1: 写独立 oracle 与真实模型元数据的失败测试**

在 oracle 测试中固定一个不依赖生产变换函数的坐标：

```js
it('maps a piece sample through the final 180 degree rotation and horizontal mirror', () => {
  const piece = {
    mirrorX: true,
    outputBounds: { height: 400, width: 300, x: 500, y: 3096 },
    rotation: 180,
    sourceBounds: { height: 200, width: 100, x: 10, y: 20 },
  };
  expect(mapAtlasPointToPieceOutput(piece, { x: 35, y: 70 }, {
    outputSize: { width: 4096, height: 4096 },
    outputTransform: { rotation: 180, mirrorX: true },
  })).toEqual({ x: 575, y: 3196 });
});
```

在真实模型测试中加入：

```js
expect(result.outputTransform).toEqual({ rotation: 180, mirrorX: true });
```

并要求浏览器结果返回 `extracted.outputTransform`。现有三色方向标记仍分别验证正片和背片，counterfactual 继续拒绝恒等、仅旋转和仅镜像的错误组合。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run src/features/configurator/scene/realGarmentPatternTestOracle.test.js src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js`

Expected: FAIL，oracle 尚未映射最终变换，真实结果尚未返回该字段。

- [ ] **Step 3: 独立实现测试 oracle 的最终坐标映射**

扩展 oracle 参数：

```js
export function mapAtlasPointToPieceOutput(piece, atlasPoint, {
  rotation = piece?.rotation,
  mirrorX = piece?.mirrorX,
  outputTransform = { rotation: 0, mirrorX: false },
  outputSize = { width: 4096, height: 4096 },
} = {}) {
  const layoutBounds = invertOutputBounds(
    piece.outputBounds,
    outputSize,
    outputTransform,
  );
  const relativePoint = {
    x: (atlasPoint.x - piece.sourceBounds.x) / piece.sourceBounds.width,
    y: (atlasPoint.y - piece.sourceBounds.y) / piece.sourceBounds.height,
  };
  let orientedPoint;
  switch (rotation) {
    case 0:
      orientedPoint = relativePoint;
      break;
    case 90:
      orientedPoint = { x: 1 - relativePoint.y, y: relativePoint.x };
      break;
    case 180:
      orientedPoint = { x: 1 - relativePoint.x, y: 1 - relativePoint.y };
      break;
    case 270:
      orientedPoint = { x: relativePoint.y, y: 1 - relativePoint.x };
      break;
    default:
      throw new Error(`真实模型方向 oracle 不支持 rotation=${rotation}。`);
  }
  if (mirrorX) orientedPoint = { x: 1 - orientedPoint.x, y: orientedPoint.y };
  const layoutPoint = {
    x: layoutBounds.x + orientedPoint.x * layoutBounds.width,
    y: layoutBounds.y + orientedPoint.y * layoutBounds.height,
  };
  return mapOutputPoint(layoutPoint, outputSize, outputTransform);
}

function mapOutputPoint(point, { width, height }, { rotation, mirrorX }) {
  let rotated;
  switch (rotation) {
    case 90:
      rotated = { x: height - point.y, y: point.x };
      break;
    case 180:
      rotated = { x: width - point.x, y: height - point.y };
      break;
    case 270:
      rotated = { x: point.y, y: width - point.x };
      break;
    default:
      rotated = { ...point };
  }
  const rotatedWidth = rotation === 90 || rotation === 270 ? height : width;
  return mirrorX ? { x: rotatedWidth - rotated.x, y: rotated.y } : rotated;
}

function invertOutputBounds(bounds, outputSize, transform) {
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => invertOutputPoint(point, outputSize, transform));
  const xValues = corners.map(({ x }) => x);
  const yValues = corners.map(({ y }) => y);
  const x = Math.min(...xValues);
  const y = Math.min(...yValues);
  return {
    x,
    y,
    width: Math.max(...xValues) - x,
    height: Math.max(...yValues) - y,
  };
}

function invertOutputPoint(point, { width, height }, { rotation, mirrorX }) {
  const rotatedWidth = rotation === 90 || rotation === 270 ? height : width;
  const rotated = mirrorX ? { x: rotatedWidth - point.x, y: point.y } : point;
  switch (rotation) {
    case 90:
      return { x: rotated.y, y: height - rotated.x };
    case 180:
      return { x: width - rotated.x, y: height - rotated.y };
    case 270:
      return { x: width - rotated.y, y: rotated.x };
    default:
      return { ...rotated };
  }
}
```

实现中必须在测试文件内独立写出旋转、镜像和逆变换公式，不能导入 `uvPatternOutputTransform.js`，避免再次用生产实现证明生产实现。`uvPatternPiecesGarmentModels.test.js` 调用 oracle 时显式传入：

```js
{
  outputSize: { width: extracted.width, height: extracted.height },
  outputTransform: extracted.outputTransform,
}
```

浏览器结果增加：

```js
outputTransform: extracted.outputTransform,
```

- [ ] **Step 4: 运行真实 GLB 测试并确认 GREEN**

Run: `npx vitest run src/features/configurator/scene/realGarmentPatternTestOracle.test.js src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js`

Expected: PASS；Chelsea 和 FN8788 的正背片图案均保留，方向标记在最终画布位置匹配，透明图案中心仍透明。

- [ ] **Step 5: 提交真实模型回归**

```powershell
git add -- src/features/configurator/scene/realGarmentPatternTestOracle.js src/features/configurator/scene/realGarmentPatternTestOracle.test.js src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js
git commit -m "test: verify final UV orientation on garment models"
```

### Task 6: 完整验证、真实生产包与变更记录

**Files:**
- Create: `project-logs/changes/2026-08-03-uv-pattern-output-transform.md`

- [ ] **Step 1: 运行静态差异和相关测试**

```powershell
git diff --check
npx vitest run src/features/configurator/config/modelUvLayouts.test.js src/features/configurator/scene/uvPatternOutputTransform.test.js src/features/configurator/scene/uvPatternPieces.test.js src/features/configurator/scene/uvPatternPieces.browser.test.js src/features/configurator/scene/realGarmentPatternTestOracle.test.js src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js src/features/configurator/designs/productionPackage.test.js src/features/configurator/designs/productionManifest.test.js scripts/verify-production-package.test.js
```

Expected: `git diff --check` 无输出；所有相关测试 PASS。

- [ ] **Step 2: 运行完整自动化验证**

```powershell
npm test
npm run build
npm run build:showcase
npx wrangler deploy --dry-run
```

Expected: 全部 exit 0；仅允许项目已有的 jsdom navigation、Vite chunk、Shopify `inlineDynamicImports` 或 Wrangler 代理提示。

- [ ] **Step 3: 生成并核验真实七文件 ZIP**

启动本地 Showcase，在浏览器中建立包含正面文字/徽章和背面 `PLAYER 16` 的设计并下载 ZIP。随后运行：

```powershell
$productionZip = Get-ChildItem -LiteralPath 'C:\Users\Administrator\Downloads' -Filter '*-jersey-design-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
node scripts/verify-production-package.mjs $productionZip.FullName
```

Expected: verifier 输出 PASS；ZIP 精确包含七个文件，两张生产 PNG 为 4096×4096，PDF 为两页，Manifest 中为：

```json
"outputTransform": {
  "rotation": 180,
  "mirrorX": true
}
```

- [ ] **Step 4: 视觉检查 PNG 和 PDF**

打开解包后的 `uv-pattern-pieces.png` 与 PDF 第二页，固定验收：领口朝上，`YOUR TEXT`、`PLAYER` 和 `16` 均从左到右且上下正向，徽章不镜像，正背片未裁切，袖片/领片无黑块。`uv-atlas.png` 与正背面预览不得发生方向变化。

- [ ] **Step 5: 写变更记录**

创建 `project-logs/changes/2026-08-03-uv-pattern-output-transform.md`，包含：

```markdown
# UV 裁片最终导出方向修正

## 根因

原有裁片级 `rotation: 180` 与 `mirrorX: true` 组合等价于上下翻转；测试使用配置反算期望点，没有独立验证文字可读方向。

## 修正

- 增加模型级 `patternOutputTransform`；
- 当前模型配置为先旋转 180°再水平镜像；
- 同步更新最终像素、裁片坐标、指纹、Manifest、PDF 和 verifier；
- 新增不对称 Canvas 与真实 GLB 回归。

## 验证

- 相关测试：PASS
- 完整测试：PASS
- app / Showcase 构建：PASS
- Wrangler dry-run：PASS
- 真实七文件 ZIP 与 PDF 视觉检查：PASS

## 发布状态

仅本地分支完成；未推送、未合并、未部署。
```

- [ ] **Step 6: 提交验证记录并确认工作区干净**

```powershell
git add -- project-logs/changes/2026-08-03-uv-pattern-output-transform.md
git commit -m "docs: record UV output orientation verification"
git diff --check
git status --short --branch
```

Expected: 工作区干净，分支只领先本地基线；未发生 push、merge 或 deploy。

### Task 7: 完成审查与交付选择

**Files:**
- Review only: 本计划列出的全部文件

- [ ] **Step 1: 对照设计规格自审范围**

逐项检查 `docs/superpowers/specs/2026-08-03-uv-pattern-output-transform-design.md`：原始 Atlas/预览未改、最终变换只执行一次、参数有维护注释、坐标/指纹/Manifest 一致、错误失败关闭、无顾客 UI 变化。

- [ ] **Step 2: 运行提交后最终验证**

```powershell
git diff showcase...HEAD --check
npm test
npm run build:showcase
```

Expected: 全部 exit 0，且 `git status --short --branch` 无文件改动。

- [ ] **Step 3: 使用完成分支流程交付**

调用 `superpowers:finishing-a-development-branch`，向用户提供该技能要求的四个本地/远端集成选项。未经用户明确确认，不执行 merge、push、PR 或 Cloudflare 发布。
