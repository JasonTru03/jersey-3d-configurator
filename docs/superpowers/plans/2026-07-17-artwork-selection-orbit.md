# Artwork 选择反馈与球衣旋转实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除不适用的 Artwork 部位选择和不可见预设，并让选中的 Artwork 具有清晰选择框，同时不阻止球衣旋转。

**Architecture:** Artwork 仍使用现有 `DecorationEditor`、网格射线检测和保存格式。将“当前选中”与“正在拖动”解耦，只有拖动 Artwork 时占用 OrbitControls。渲染器把当前 Artwork 的 3D 边界投影为舞台矩形，`ProductStage` 用一个只读 DOM 覆盖层显示细选择框；Name set 的现有工具栏不改动。

**Tech Stack:** React 19、Three.js、Vitest、Testing Library、CSS 自定义属性。

---

## 文件结构

- 修改 `src/features/configurator/config/productDefinitions.js`：删除部位选择的公开配置和两个不可见预设。
- 修改 `src/features/configurator/ui/DecorationPanel.jsx`：移除部位选择 UI 与状态写入，所有新 Artwork 使用默认 `front` 初始区域。
- 修改 `src/features/configurator/ui/DecorationPanel.test.jsx`：验证没有部位选择器，且保留两枚徽章添加和槽位上限反馈。
- 修改 `src/features/configurator/scene/decorationEditor.js`：仅在实际拖动时拦截相机手势，并向渲染器暴露当前选择的表面。
- 修改 `src/features/configurator/scene/decorationEditor.test.js`：覆盖“已选中但未拖动”不占用手势，以及 Artwork 本体拖动仍更新位置。
- 修改 `src/features/configurator/scene/garmentRenderer.js`：计算选中 Artwork 的屏幕投影矩形并通过回调发送；仅在 Artwork 拖动时禁用 OrbitControls。
- 修改 `src/features/configurator/scene/garmentRenderer.test.js`：覆盖投影矩形的可见/隐藏和变化去重。
- 新增 `src/features/configurator/scene/ArtworkSelectionOverlay.jsx`：只渲染 Artwork 选择框。
- 新增 `src/features/configurator/scene/ArtworkSelectionOverlay.test.jsx`：验证框的显示、定位和不拦截指针事件。
- 修改 `src/features/configurator/scene/ProductStage.jsx` 与 `ProductStage.test.jsx`：接收渲染器 Artwork 锚点并挂载选择框，不影响 Name set 工具栏。
- 修改 `src/features/configurator/ui/configurator.css`：新增 Artwork 选择框样式，删除不再使用的部位选择样式。
- 新增 `project-logs/changes/2026-07-17-artwork-selection-orbit.md`：记录用户可见改动、验证与手工验收范围。
- 新增 `docs/superpowers/handoffs/2026-07-17-artwork-selection-orbit-handoff.md`：记录分支、验证、发布边界和回退方式。

### Task 1: 清理 Artwork 面板与预设

**Files:**
- Modify: `src/features/configurator/config/productDefinitions.js:18-52`
- Modify: `src/features/configurator/ui/DecorationPanel.jsx:6-37,45-75`
- Modify: `src/features/configurator/ui/DecorationPanel.test.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx:60-68`
- Modify: `src/features/configurator/shopify/ShopifyConfiguratorSection.test.jsx:58-68`

- [ ] **Step 1: 写出失败的产品/面板测试**

将测试产品改为不提供 `decorationRegions`，并加入以下断言；现状会因 `product.decorationRegions.map` 抛错或仍显示已删除预设而失败：

```jsx
const product = {
  decorationPresets: [{ id: 'crest', kind: 'badge', label: 'Crest Badge', source: 'crest', assetUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' }],
};

render(<DecorationPanel product={product} state={{ overrides: { decorations: [] } }} updateState={updateState} />);
expect(screen.queryByLabelText('Artwork region')).not.toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: 'Crest Badge' }));
expect(updateState).toHaveBeenCalledWith(expect.objectContaining({
  overrides: expect.objectContaining({ activeDecorationId: expect.stringContaining('preset-crest-') }),
}));
```

在 `ConfiguratorPage.test.jsx` 与 Shopify 嵌入测试中，将 `Golden Stripe` 的点击改为 `Crest Badge`，断言消息更新为 `Crest Badge added`。

- [ ] **Step 2: 运行目标测试并确认失败**

Run:

```powershell
npm test -- --run src/features/configurator/ui/DecorationPanel.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/shopify/ShopifyConfiguratorSection.test.jsx
```

Expected: FAIL，指出 `decorationRegions` 仍被读取，或旧预设名称断言已不匹配。

- [ ] **Step 3: 用最小配置改动删除部位 UI 与两个预设**

在 `productDefinitions.js` 删除整个 `decorationRegions` 数组及前两个预设对象，仅保留：

```js
decorationPresets: [
  { id: 'crest-badge', kind: 'badge', label: 'Crest Badge', source: 'crest-badge', assetUrl: '...' },
  { id: 'roundel-badge', kind: 'badge', label: 'Roundel Badge', source: 'roundel-badge', assetUrl: '...' },
],
```

在 `DecorationPanel.jsx` 添加固定初始区域常量，删除 `activeRegion`、`selectRegion` 与 `region-picker` 渲染；新增和上传均使用该常量。`updateDecorations` 只写入 `decorations` 与 `activeDecorationId`：

```jsx
const DEFAULT_ARTWORK_REGION = 'front';

function updateDecorations(next, nextActiveId = activeId) {
  updateState({ overrides: { decorations: next, activeDecorationId: nextActiveId } });
}

const next = createDecoration({ ...preset, id, region: DEFAULT_ARTWORK_REGION });
```

旧设计中的 `region` 和 `activeDecorationRegion` 不迁移、不删除；它们只是不会再由面板读取或写入。

- [ ] **Step 4: 运行目标测试并确认通过**

Run:

```powershell
npm test -- --run src/features/configurator/ui/DecorationPanel.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/shopify/ShopifyConfiguratorSection.test.jsx
```

Expected: PASS。

- [ ] **Step 5: 提交独立的面板清理检查点**

```powershell
git add src/features/configurator/config/productDefinitions.js src/features/configurator/ui/DecorationPanel.jsx src/features/configurator/ui/DecorationPanel.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/shopify/ShopifyConfiguratorSection.test.jsx
git commit -m "feat: simplify artwork presets and placement"
```

### Task 2: 解除选中 Artwork 对球衣旋转的锁定

**Files:**
- Modify: `src/features/configurator/scene/decorationEditor.js:257-323`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js:158-164,449-502`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1: 写出失败的手势归属测试**

在 `decorationEditor.test.js` 构造一个已选择但未拖动的编辑器，加入：

```js
editor.selectedId = 'crest-1';
editor.dragging = false;
expect(editor.isEditing()).toBe(false);
```

再构造未命中 Artwork 的指针事件并断言：

```js
editor.selectedId = 'crest-1';
expect(editor.handlePointerDown({ clientX: 12, clientY: 12 })).toBe(false);
expect(editor.selectedId).toBe('crest-1');
```

在 `garmentRenderer.test.js` 为一个新增的纯判断函数加入：

```js
expect(shouldEnableOrbitControls({ isDraggingDecoration: false, isDraggingPrint: false })).toBe(true);
expect(shouldEnableOrbitControls({ isDraggingDecoration: true, isDraggingPrint: false })).toBe(false);
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run:

```powershell
npm test -- --run src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.test.js
```

Expected: FAIL，因为 `isEditing()` 在仅选中时返回真，且空白点击会清除选择并返回已处理。

- [ ] **Step 3: 最小化解耦选择与拖动状态**

在 `DecorationEditor` 中保留命中 Artwork 后的 `selectedId` 与 `dragging = true`，但未命中时不得清除选择：

```js
handlePointerDown(event) {
  const decoration = this.pickDecoration(event);
  if (!decoration) return false;
  this.selectedId = decoration.id;
  this.onSelectionChange?.(decoration.id);
  this.dragging = true;
  this.refreshSelection();
  return true;
}

isEditing() {
  return this.dragging;
}
```

在 `garmentRenderer.js` 新增并导出纯函数：

```js
export function shouldEnableOrbitControls({ isDraggingDecoration, isDraggingPrint }) {
  return !isDraggingDecoration && !isDraggingPrint;
}
```

将 `update`、Artwork 指针按下和指针抬起后的 `controls.enabled` 都改为调用此函数，并传入 `this.decorationEditor.isEditing()` 与 `this.isDraggingPrint`。不要修改 Name set 的命中优先级、四像素拖动阈值或贴花网格射线逻辑。

- [ ] **Step 4: 运行目标测试并确认通过**

Run:

```powershell
npm test -- --run src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交手势检查点**

```powershell
git add src/features/configurator/scene/decorationEditor.js src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "fix: keep jersey orbit available with artwork selected"
```

### Task 3: 为 Artwork 添加只读选择框

**Files:**
- Create: `src/features/configurator/scene/ArtworkSelectionOverlay.jsx`
- Create: `src/features/configurator/scene/ArtworkSelectionOverlay.test.jsx`
- Modify: `src/features/configurator/scene/garmentRenderer.js:20-46,108-119,344-365,435-440`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`
- Modify: `src/features/configurator/scene/ProductStage.jsx:24-27,46-63,113-140`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css:126-170`

- [ ] **Step 1: 写出失败的矩形与覆盖层测试**

在 `garmentRenderer.test.js` 增加八个投影点，断言任一点在视锥外时隐藏、全部可见时返回舞台坐标矩形：

```js
expect(getDecorationSelectionRect(visibleCorners, { width: 500, height: 400 })).toEqual({
  visible: true, left: 180, top: 120, width: 140, height: 130,
});
expect(getDecorationSelectionRect([...visibleCorners.slice(0, 7), { x: 1.2, y: 0, z: 0 }], { width: 500, height: 400 }))
  .toEqual({ visible: false });
```

新增 `ArtworkSelectionOverlay.test.jsx`：

```jsx
render(<ArtworkSelectionOverlay anchor={{ visible: true, left: 20, top: 30, width: 80, height: 60 }} />);
const frame = screen.getByTestId('artwork-selection-frame');
expect(frame).toHaveStyle({ left: '20px', top: '30px', width: '80px', height: '60px', pointerEvents: 'none' });
```

并断言 `visible: false` 时不渲染。扩展 `ProductStage.test.jsx` 的渲染器 mock，调用 `options.onDecorationAnchorChange(...)` 后断言 Artwork 框出现；调用 `{ visible: false }` 后断言隐藏，同时原有 `Selected print controls` 测试仍通过。

- [ ] **Step 2: 运行目标测试并确认失败**

Run:

```powershell
npm test -- --run src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/scene/ArtworkSelectionOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx
```

Expected: FAIL，原因是投影函数、组件和渲染器回调尚不存在。

- [ ] **Step 3: 实现投影回调和只读覆盖层**

在 `garmentRenderer.js` 复用现有 `getPrintSelectionRect` 的可见性规则，新增：

```js
export function getDecorationSelectionRect(projectedCorners, dimensions) {
  return getPrintSelectionRect(projectedCorners, dimensions);
}
```

使用 `new THREE.Box3().setFromObject(surface)` 的 8 个世界坐标角并 `project(camera)` 生成 `projectedCorners`。在构造器接受 `onDecorationAnchorChange`、保存 `lastDecorationAnchor`；每帧 `controls.update()` 后调用 `syncDecorationAnchor()`。该方法只在 `decorationEditor.selectedSurface` 存在时计算矩形，并用现有 `hasPrintSelectionRectChanged` 去重：

```js
syncDecorationAnchor() {
  const surface = this.decorationEditor?.selectedSurface;
  const anchor = surface
    ? getDecorationSelectionRect(getObjectProjectedCorners(surface, this.camera), this.host.getBoundingClientRect())
    : { visible: false };
  if (!hasPrintSelectionRectChanged(this.lastDecorationAnchor, anchor)) return;
  this.lastDecorationAnchor = anchor;
  this.onDecorationAnchorChange?.(anchor);
}
```

在 `DecorationEditor` 增加只读 getter：

```js
get selectedSurface() {
  return this.selectedId ? this.surfaces.get(this.selectedId) ?? null : null;
}
```

创建 `ArtworkSelectionOverlay.jsx`，只在有效锚点时渲染：

```jsx
export function ArtworkSelectionOverlay({ anchor }) {
  if (!anchor?.visible) return null;
  return <div
    aria-hidden="true"
    className="artwork-selection-frame"
    data-testid="artwork-selection-frame"
    style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }}
  />;
}
```

在 `ProductStage` 保存 `decorationAnchor`，将回调传进 `GarmentRenderer`，并在 `.stage` 中渲染 `<ArtworkSelectionOverlay anchor={decorationAnchor} />`。不向此组件加入按钮、键盘处理或状态写入。CSS 使用与 Name set 框一致的橙色，且必须保持非交互：

```css
.artwork-selection-frame {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  border: 2px solid #ef5d43;
  border-radius: 3px;
  pointer-events: none;
}
```

- [ ] **Step 4: 运行目标测试并确认通过**

Run:

```powershell
npm test -- --run src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/scene/ArtworkSelectionOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx
```

Expected: PASS。

- [ ] **Step 5: 提交选择框检查点**

```powershell
git add src/features/configurator/scene/ArtworkSelectionOverlay.jsx src/features/configurator/scene/ArtworkSelectionOverlay.test.jsx src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/scene/ProductStage.jsx src/features/configurator/scene/ProductStage.test.jsx src/features/configurator/ui/configurator.css
git commit -m "feat: show selection frame for artwork"
```

### Task 4: 完整验证与交接记录

**Files:**
- Create: `project-logs/changes/2026-07-17-artwork-selection-orbit.md`
- Create: `docs/superpowers/handoffs/2026-07-17-artwork-selection-orbit-handoff.md`

- [ ] **Step 1: 运行全量自动化验证**

Run:

```powershell
npm test
npm run build:showcase
```

Expected: 所有 Vitest 测试通过；展示构建以退出码 0 完成。记录既有大 JavaScript chunk 警告，但不将其作为本次失败。

- [ ] **Step 2: 在 WebGL 浏览器进行真实链路验收**

Run:

```powershell
npm run dev
```

按顺序人工验证：打开 Artwork；仅有 Crest Badge 与 Roundel Badge；上传图片入口可用；点击 Artwork 出现橙色框；从框内图案开始拖动会移动图案；从图案外球衣开始拖动会旋转球衣且框保留；右侧旋转、缩放、删除仍作用于所选 Artwork；删除后框消失；Name set 的五个控制按钮仍按既有逻辑工作；在窄视口下选择框不拦截手势。

- [ ] **Step 3: 写入变更与交接记录**

在 `project-logs/changes/2026-07-17-artwork-selection-orbit.md` 记录日期、目标、文件范围、用户可见变化、自动化/人工验证、既有 chunk 警告和遗留风险。交接文档记录分支名、提交、未触及的主工作区 `package-lock.json` 与 `.superpowers/`、发布前需要用户确认、以及以 `git revert <feature-commit>` 回退而不改写历史的方式。

- [ ] **Step 4: 提交验证记录**

```powershell
git add project-logs/changes/2026-07-17-artwork-selection-orbit.md docs/superpowers/handoffs/2026-07-17-artwork-selection-orbit-handoff.md
git commit -m "docs: record artwork selection verification"
```

- [ ] **Step 5: 请求用户决定集成方式**

不要自动合并、推送或发布。报告分支、提交、测试/构建结果和手工验收结果，询问用户选择：合并至 `showcase`、创建 Pull Request，或保留分支稍后处理。
