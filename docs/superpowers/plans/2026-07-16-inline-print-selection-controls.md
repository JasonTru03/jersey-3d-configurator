# Name Set 贴边选中控件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Name Set 仅在用户点击文字后显示紧贴文字的边框和五个操作控件，并在空白点击时完全隐藏。

**Architecture:** Three.js 渲染器将选中贴花平面的四个角投影为舞台 CSS 像素矩形，并仅在矩形变化时通知 React。`ProductStage` 保存显式选中状态；覆盖层只根据可见矩形渲染边框和角落控件，覆盖层本体不截获画布拖动和旋转手势。

**Tech Stack:** React、Three.js、Vitest、Testing Library、CSS。

---

## 文件结构

- `src/features/configurator/scene/garmentRenderer.js`：投影贴花四角、选中与取消选中事件，以及变化节流。
- `src/features/configurator/scene/garmentRenderer.test.js`：投影矩形和变化判断的纯函数测试。
- `src/features/configurator/scene/ProductStage.jsx`：显式选择状态、复制/删除后的选择规则，以及渲染器回调连接。
- `src/features/configurator/scene/ProductStage.test.jsx`：选中、空白取消、删除和复制的舞台回归测试。
- `src/features/configurator/scene/PrintToolbarOverlay.jsx`：紧贴矩形的边框、五个按钮和缩放拖动处理。
- `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`：未选中隐藏、边框样式、五个操作及 `×2` 视觉文案测试。
- `src/features/configurator/ui/configurator.css`：覆盖层边框与五个角落按钮的布局；不修改全局页面布局。

### Task 1: 将选中贴花投影为屏幕矩形

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Test: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: 写出失败的投影矩形测试**

在 `garmentRenderer.test.js` 导入 `getPrintSelectionRect` 和 `hasPrintSelectionRectChanged`，加入：

```js
it('converts four visible plane corners into a stage-relative selection rectangle', () => {
  expect(getPrintSelectionRect([
    { x: -0.2, y: 0.3, z: 0 }, { x: 0.2, y: 0.3, z: 0 },
    { x: -0.2, y: -0.3, z: 0 }, { x: 0.2, y: -0.3, z: 0 },
  ], { width: 500, height: 400 })).toEqual({ visible: true, left: 200, top: 140, width: 100, height: 120 });
});

it('hides a selection rectangle when a corner is behind the camera or outside the stage', () => {
  expect(getPrintSelectionRect([{ x: 0, y: 0, z: 1.1 }], { width: 500, height: 400 })).toEqual({ visible: false });
});

it('only reports a changed selection rectangle when its geometry changes', () => {
  const previous = { visible: true, left: 200, top: 140, width: 100, height: 120 };
  expect(hasPrintSelectionRectChanged(previous, { ...previous })).toBe(false);
  expect(hasPrintSelectionRectChanged(previous, { ...previous, width: 101 })).toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run src/features/configurator/scene/garmentRenderer.test.js`  
Expected: FAIL，因为新的纯函数尚未导出。

- [ ] **Step 3: 实现纯矩形转换函数**

在 `garmentRenderer.js` 用下列逻辑替换旧的中心锚点计算函数，保留现有 `clamp` 辅助函数：

```js
export function getPrintSelectionRect(projectedCorners, { width, height }) {
  if (!width || !height || projectedCorners.length !== 4 || projectedCorners.some((corner) => (
    corner.x < -1 || corner.x > 1 || corner.y < -1 || corner.y > 1 || corner.z < -1 || corner.z > 1
  ))) return { visible: false };

  const points = projectedCorners.map((corner) => ({
    x: Math.round((corner.x * 0.5 + 0.5) * width),
    y: Math.round((-corner.y * 0.5 + 0.5) * height),
  }));
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  if (right <= left || bottom <= top) return { visible: false };
  return { visible: true, left, top, width: right - left, height: bottom - top };
}

export function hasPrintSelectionRectChanged(previous, next) {
  return !previous || previous.visible !== next.visible || previous.left !== next.left
    || previous.top !== next.top || previous.width !== next.width || previous.height !== next.height;
}
```

- [ ] **Step 4: 从 Three.js 平面取得四角并节流回调**

在 `GarmentRenderer` 中增加复用的四个 `THREE.Vector3` 顶点。`syncPrintAnchor` 改为：读取 `plane.geometry.attributes.position` 的四个极值角、用 `plane.localToWorld()` 转到世界坐标、`project(this.camera)` 后交给 `getPrintSelectionRect`。只在 `hasPrintSelectionRectChanged(this.lastPrintAnchor, rect)` 为真时更新 `lastPrintAnchor` 并调用 `onPrintAnchorChange(rect)`。

```js
const rect = plane ? getPrintSelectionRect(
  this.printSelectionCorners.map((corner) => plane.localToWorld(corner.clone()).project(this.camera)),
  this.host.getBoundingClientRect(),
) : { visible: false };
if (!hasPrintSelectionRectChanged(this.lastPrintAnchor, rect)) return;
this.lastPrintAnchor = rect;
this.onPrintAnchorChange?.(rect);
```

删除不再使用的 `PRINT_TOOLBAR_WIDTH`、`PRINT_TOOLBAR_HEIGHT`、位置翻转常量和 `getPrintToolbarAnchor`，防止旧侧边面板逻辑残留。

- [ ] **Step 5: 运行渲染器测试确认通过**

Run: `npm test -- --run src/features/configurator/scene/garmentRenderer.test.js`  
Expected: PASS，且现有材质选择和复制位置测试继续通过。

- [ ] **Step 6: 提交并推送投影检查点**

```powershell
git add src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "feat: project selected print bounds"
git push origin codex/inline-print-selection-controls
git push backup codex/inline-print-selection-controls
```

### Task 2: 引入显式选中与空白取消选中

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/ProductStage.jsx`
- Test: `src/features/configurator/scene/ProductStage.test.jsx`

- [ ] **Step 1: 写出失败的舞台选择测试**

修改 renderer mock，使其捕获 `onPrintSelectionChange`。加入以下断言：

```jsx
act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
expect(screen.getByRole('group', { name: 'Selected print controls' })).toBeInTheDocument();

act(() => rendererHarness.options.onPrintSelectionChange(null));
expect(screen.queryByRole('group', { name: 'Selected print controls' })).not.toBeInTheDocument();
```

还要把既有删除测试补为删除后覆盖层不存在，把复制测试补为副本 ID 成为已选中项。

- [ ] **Step 2: 运行舞台测试确认失败**

Run: `npm test -- --run src/features/configurator/scene/ProductStage.test.jsx`  
Expected: FAIL，因为舞台当前会自动选择第一个贴花并显示工具栏。

- [ ] **Step 3: 在 ProductStage 中分离“可编辑 ID”和“用户选中 ID”**

保留 `activePrintId` 作为渲染器的当前编辑目标；新增 `selectedPrintId`，初始值为 `null`。将覆盖层项目改为：

```jsx
const selectedPrint = printItems.find((item) => item.id === selectedPrintId);
const selectedAnchor = selectedPrintId === activePrintId ? printAnchor : { visible: false };
```

将渲染器的选择回调改为同时更新两个值：

```js
onPrintSelectionChange: (id) => {
  setActivePrintId(id);
  setSelectedPrintId(id);
},
```

当现有 `state` 变化导致项目不存在时，清除 `selectedPrintId`；但不得因为默认项目出现就自动选中它。

- [ ] **Step 4: 在渲染器未命中贴花时发出取消选择**

在 `handlePointerDown` 中，在 `printHit` 和 `decorationEditor` 分支之后、开始球衣拖动前插入：

```js
this.onPrintSelectionChange?.(null);
this.lastPrintAnchor = null;
this.onPrintAnchorChange?.({ visible: false });
```

继续允许现有球衣命中后的文字拖动；空白点击会先取消工具框，再按当前逻辑拖动当前文本或旋转球衣。

- [ ] **Step 5: 明确复制与删除后的选择规则**

在复制回调的 `setActivePrintId(copy.id)` 后增加 `setSelectedPrintId(copy.id)`。在删除回调中，在清空锚点之前增加 `setSelectedPrintId(null)`。`None` 或没有 `printItems` 时也将 `selectedPrintId` 清为 `null`。

- [ ] **Step 6: 运行舞台测试确认通过**

Run: `npm test -- --run src/features/configurator/scene/ProductStage.test.jsx`  
Expected: PASS，覆盖“初始隐藏、文字点击显示、空白点击隐藏、删除隐藏、复制选中副本”。

- [ ] **Step 7: 提交并推送选择检查点**

```powershell
git add src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/ProductStage.jsx src/features/configurator/scene/ProductStage.test.jsx
git commit -m "feat: select prints only on direct click"
git push origin codex/inline-print-selection-controls
git push backup codex/inline-print-selection-controls
```

### Task 3: 渲染贴边边框与五个角落控件

**Files:**
- Modify: `src/features/configurator/scene/PrintToolbarOverlay.jsx`
- Test: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
- Modify: `src/features/configurator/scene/ProductStage.jsx`
- Modify: `src/features/configurator/ui/configurator.css`

- [ ] **Step 1: 写出失败的覆盖层组件测试**

把测试锚点换为矩形数据，并加入：

```jsx
render(<PrintToolbarOverlay anchor={{ visible: true, left: 180, top: 220, width: 96, height: 54 }} item={{ id: 'print-1', scale: 1 }} {...callbacks} />);
expect(screen.getByTestId('print-selection-frame')).toHaveStyle({
  '--print-left': '180px', '--print-top': '220px', '--print-width': '96px', '--print-height': '54px',
});
expect(screen.getByRole('button', { name: 'Duplicate print' })).toHaveTextContent('×2');
```

另加 `anchor.visible === false` 与 `item === undefined` 均不渲染框的测试。

- [ ] **Step 2: 运行覆盖层测试确认失败**

Run: `npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx`  
Expected: FAIL，因为当前组件只支持中心锚点及固定网格面板。

- [ ] **Step 3: 替换为选择框和五个独立按钮**

将 `PrintToolbarOverlay` 根元素改为仅负责定位且 `pointerEvents: 'none'` 的容器；内部边框使用 `data-testid="print-selection-frame"`。五个按钮各自添加类：`print-control--edit`、`--rotate`、`--delete`、`--duplicate`、`--resize`，并设置 `pointerEvents: 'auto'`。复制按钮保留 `aria-label="Duplicate print"`，内容改为 `×2`：

```jsx
<button aria-label="Duplicate print" className="print-control print-control--duplicate" onClick={() => onCopy(item.id)} type="button">×2</button>
```

保留编辑、旋转、删除及指针缩放的现有回调行为与无障碍标签。

- [ ] **Step 4: 以矩形数据连接 ProductStage**

将 `PrintToolbarOverlay` 的 `anchor` 传为 `selectedAnchor`，`item` 传为 `selectedPrint`。不在覆盖层中推断当前项目，避免非选中状态意外显示。

- [ ] **Step 5: 替换旧的侧边网格 CSS**

移除 `.print-toolbar-overlay.is-*` 和三列面板样式。新增：

```css
.print-toolbar-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.print-selection-frame { position: absolute; left: var(--print-left); top: var(--print-top); width: var(--print-width); height: var(--print-height); border: 2px solid #ef5d43; pointer-events: none; }
.print-control { position: absolute; width: 28px; height: 28px; pointer-events: auto; }
.print-control--edit { left: calc(var(--print-left) - 14px); top: calc(var(--print-top) - 14px); }
.print-control--rotate { left: calc(var(--print-left) + var(--print-width) - 14px); top: calc(var(--print-top) - 14px); }
.print-control--delete { left: calc(var(--print-left) - 14px); top: calc(var(--print-top) + var(--print-height) - 14px); }
.print-control--duplicate { left: calc(var(--print-left) + (var(--print-width) - 28px) / 2); top: calc(var(--print-top) + var(--print-height) - 14px); }
.print-control--resize { left: calc(var(--print-left) + var(--print-width) - 14px); top: calc(var(--print-top) + var(--print-height) - 14px); }
```

为小于 44px 的宽高添加最小视觉边距，但不改变文字本身的尺寸或位置。

- [ ] **Step 6: 运行覆盖层和舞台回归测试确认通过**

Run: `npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx`  
Expected: PASS，五个操作仍可用，未选中状态不渲染覆盖层。

- [ ] **Step 7: 提交并推送 UI 检查点**

```powershell
git add src/features/configurator/scene/PrintToolbarOverlay.jsx src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.jsx src/features/configurator/ui/configurator.css
git commit -m "feat: render inline print selection controls"
git push origin codex/inline-print-selection-controls
git push backup codex/inline-print-selection-controls
```

### Task 4: 完整验证与交接

**Files:**
- Create: `docs/superpowers/handoffs/2026-07-16-inline-print-selection-controls-handoff.md`

- [ ] **Step 1: 执行完整自动验证**

Run:

```powershell
npm test -- --run
npm run build:showcase
```

Expected: 全部 Vitest 测试通过，showcase 构建成功；若仍有既有 bundle 体积告警，仅记录为非阻塞告警。

- [ ] **Step 2: 完成 WebGL 浏览器手工验收**

在支持 WebGL 的浏览器依次验证：未点击名字时无框；点击文字后出现紧贴框；点击球衣空白处隐藏；拖动、旋转、缩放文字后控件同步；复制后选中新副本；删除后再次选择 `Name set` 可重新添加；桌面与移动视口中按钮可点且不遮挡侧面板。

- [ ] **Step 3: 写入交接记录**

交接文档必须记录：用户可见的行为变化、实际修改文件、自动测试和构建结果、手工浏览器证据、WebGL 自动化限制、两个远程的推送状态、以及部署需要用户单独确认。

- [ ] **Step 4: 提交并推送验证记录**

```powershell
git add docs/superpowers/handoffs/2026-07-16-inline-print-selection-controls-handoff.md
git commit -m "docs: hand off inline print selection controls"
git push origin codex/inline-print-selection-controls
git push backup codex/inline-print-selection-controls
```

- [ ] **Step 5: 在用户明确授权后再合并和发布**

向用户报告源分支、`showcase` 目标分支、测试/构建证据、Cloudflare 的预期发布来源与回退提交。只有收到明确“合入并发布”指令后，才合并至 `showcase`、推送并验证线上 URL。

## 自检结论

- 规格中的未选中隐藏、点击选中、空白取消、五个固定功能、复制/删除规则、投影跟随、边界隐藏、无依赖扩张和完整验证，均有对应任务。
- 本计划未包含 Shopify、购物车、支付、存储或 Cloudflare 配置修改。
- 函数和状态名称统一使用 `getPrintSelectionRect`、`hasPrintSelectionRectChanged`、`selectedPrintId` 和 `selectedAnchor`；不会与旧 `getPrintToolbarAnchor` 混用。
