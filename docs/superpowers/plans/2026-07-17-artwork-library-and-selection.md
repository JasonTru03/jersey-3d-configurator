# Artwork Library And Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除衣服上的红色选中框，新增右侧最多 8 个已添加图案的缩略图库；用户可从图库选择、单独删除图案，并在画布上通过“空白点击取消、空白拖动旋转”完成自然交互。

**Architecture:** 将图案资源解析移至配置层，供 3D 编辑器与 UI 缩略图共享，保证历史保存的 Golden Stripe / Night Grid 仍可正确显示。`DecorationPanel` 组合新增的 `ArtworkLibrary`，负责图案列表选择与删除；`GarmentRenderer` 负责区分空白点击与空白拖动，并清理旧的 DOM 投影选框链路。3D 端保留轻量、短暂的材质反馈，不把反馈写入设计数据。

**Tech Stack:** React 18、Three.js、Vitest、Testing Library、lucide-react、现有 CSS。

---

## 实施约束

- 只在工作树 `C:\Users\Administrator\Documents\可编辑自定义产品\jersey-3d-configurator\.worktrees\codex\artwork-library` 修改本功能相关文件。
- 不改产品配置、Name set 的五个既有编辑按钮、文件上传校验、8 个图案上限或设计文档格式。
- 不修改主工作树中的 `package-lock.json` 与 `.superpowers/` 未提交内容。
- 缩略图不嵌套 `<button>`：图案选择与删除使用同一图块内的两个同级按钮，避免无效 HTML 和键盘访问问题。
- 删除图案仅删除该图案；删除当前选中项时将 `activeDecorationId` 设为 `null`，删除非当前项时保留当前选择。
- 历史设计中已保存但不再展示为新增预设的 `golden-stripe` 和 `night-grid` 仍须在 3D 及缩略图库中有可用资源。

## 文件地图

| 文件 | 责任 |
| --- | --- |
| `src/features/configurator/config/decorations.js` | 图案创建、校验、删除，以及 UI 与场景共用的资源解析。 |
| `src/features/configurator/config/decorations.test.js` | 配置层资源解析与既有转换规则测试。 |
| `src/features/configurator/ui/ArtworkLibrary.jsx`（新增） | 已添加图案缩略图、选择与单项删除控件。 |
| `src/features/configurator/ui/ArtworkLibrary.test.jsx`（新增） | 图库可访问性、选中和删除交互测试。 |
| `src/features/configurator/ui/DecorationPanel.jsx` | 注入图库，统一更新 decoration 与 active id。 |
| `src/features/configurator/ui/DecorationPanel.test.jsx` | 面板级选择、删除、上限及现有操作回归。 |
| `src/features/configurator/ui/configurator.css` | 缩略图库、选中态、删除按钮和小屏布局样式。 |
| `src/features/configurator/scene/decorationEditor.js` | 使用共用解析器，提供明确取消选择和短暂的材质反馈。 |
| `src/features/configurator/scene/decorationEditor.test.js` | 选择取消、旧图案资源和短暂反馈的行为测试。 |
| `src/features/configurator/scene/garmentRenderer.js` | 空白按下、移动阈值与抬起的点击/旋转判定；移除图案选框投影。 |
| `src/features/configurator/scene/garmentRenderer.test.js` | 空白点击取消、空白拖动保留选择、轨道控制回归。 |
| `src/features/configurator/scene/ProductStage.jsx` | 移除图案选框状态与回调。 |
| `src/features/configurator/scene/ProductStage.test.jsx` | 确认不再渲染选框且既有舞台交互继续工作。 |
| `src/features/configurator/scene/ArtworkSelectionOverlay.jsx`、`ArtworkSelectionOverlay.test.jsx`（删除） | 不再需要的红色矩形组件和测试。 |

## Task 1：提取共用资源解析器（先写测试）

**Files:**
- Modify: `src/features/configurator/config/decorations.js`
- Modify: `src/features/configurator/config/decorations.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`

- [ ] 1.1 在 `decorations.test.js` 先补充 `resolveDecorationAsset` 用例：
  - upload 直接返回 data URL；
  - 当前预设按 `source` 返回 `assetUrl`；
  - 没有当前预设时，历史 `golden-stripe` / `night-grid` 返回固定的兼容资源；
  - 无匹配资源时回退 `decoration.source`。
- [ ] 1.2 运行聚焦测试，确认新用例先失败：

```powershell
npm test -- --run src/features/configurator/config/decorations.test.js
```

- [ ] 1.3 将 `LEGACY_PATTERN_ASSET_URLS` 和 `resolveDecorationAsset(decoration, presets = [])` 从场景文件迁入 `config/decorations.js` 并导出。保持资源 URL、解析优先级和现有保存设计的兼容行为完全一致。
- [ ] 1.4 `decorationEditor.js` 从 `../config/decorations.js` 导入解析器，删除本地重复常量和导出；不让 UI 依赖 Three.js 场景模块。
- [ ] 1.5 更新 `decorationEditor.test.js` 的 import，使场景测试只验证编辑器渲染/选择职责；资源解析断言集中在 config 测试。
- [ ] 1.6 运行：

```powershell
npm test -- --run src/features/configurator/config/decorations.test.js src/features/configurator/scene/decorationEditor.test.js
```

**验收：** 资源解析存在单一来源；当前预设、上传图与历史隐藏预设在迁移后表现一致。

## Task 2：实现右侧已添加图案缩略图库（TDD）

**Files:**
- Create: `src/features/configurator/ui/ArtworkLibrary.jsx`
- Create: `src/features/configurator/ui/ArtworkLibrary.test.jsx`
- Modify: `src/features/configurator/ui/DecorationPanel.jsx`
- Modify: `src/features/configurator/ui/DecorationPanel.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css`

- [ ] 2.1 先新增 `ArtworkLibrary.test.jsx`，覆盖：
  - 每个 `decorations` 项均呈现一个可访问名称为其 `label` 的选择按钮和缩略图；
  - `activeId` 项带 `aria-pressed="true"`，视觉类名只作附加断言；
  - 点击一个图案会以其 id 调用 `onSelect`；
  - 每个图案都有 `aria-label="Delete {label}"` 的删除按钮；
  - 点击删除仅以该 id 调用 `onDelete`，不触发 `onSelect`；
  - 使用传入的 `resolveAsset` 作为 `<img src>`，包括历史图案和上传图。
- [ ] 2.2 运行并确认失败：

```powershell
npm test -- --run src/features/configurator/ui/ArtworkLibrary.test.jsx
```

- [ ] 2.3 新建无状态组件，建议接口如下：

```jsx
export function ArtworkLibrary({ decorations, activeId, onSelect, onDelete, resolveAsset }) {
  // 每个图块包含选择 button 与同级、绝对定位的删除 button。
}
```

  使用 `decoration.id` 做 key；图片 `alt=""`，可访问名称由按钮文本/`aria-label` 提供；缺少资源时仍显示带名称的图块，避免把坏资源当作空白交互。
- [ ] 2.4 在 `DecorationPanel` 内：
  - 从 `product.decorationPresets` 构造 `resolveAsset(decoration) => resolveDecorationAsset(decoration, product.decorationPresets)`；
  - 在 slot 计数下、当前操作区前渲染 `ArtworkLibrary`；
  - 新增 `selectDecoration(id)`，调用 `updateDecorations(decorations, id)`，不改变任何图案转换数据；
  - 将现有 `removeActive` 拆成 `removeDecorationById(id)`：计算剩余数组，并仅当 `id === activeId` 时传入 `null`，否则传入原 active id；保留成功消息；
  - 现有操作区继续只在 `active` 存在时显示，且删除按钮仍可保留为当前项的快捷入口；图库里的每一项均有自己的删除入口。
- [ ] 2.5 扩充 `DecorationPanel.test.jsx`：
  - 新增预设后缩略图库出现且该项为选中；
  - 点击非当前缩略图只改变 `activeDecorationId`；
  - 删除非当前缩略图不改变选择；删除当前缩略图清空选择和操作区；
  - 8 项上限仍阻止新增；上传流程仍选择新图案。
- [ ] 2.6 在 CSS 中新增限定在 `.decoration-panel` 下的样式：紧凑两列图库、缩略图固定比例 `object-fit: contain`、选中项低调的品牌色边框/背景、删除按钮悬浮于右上角、触控尺寸不低于现有小操作按钮。窄侧栏下保持不溢出，不添加红色描边或常驻画布框。
- [ ] 2.7 运行：

```powershell
npm test -- --run src/features/configurator/ui/ArtworkLibrary.test.jsx src/features/configurator/ui/DecorationPanel.test.jsx
```

**验收：** 用户能在右侧直接定位全部已添加图案、切换当前图案、删除任一图案；页面只显示 8 个槽位以内的图块，现有上传和变换控件没有回归。

## Task 3：移除红框，加入短暂的 3D 选中反馈

**Files:**
- Modify: `src/features/configurator/scene/decorationEditor.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`
- Modify: `src/features/configurator/scene/ProductStage.jsx`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`
- Delete: `src/features/configurator/scene/ArtworkSelectionOverlay.jsx`
- Delete: `src/features/configurator/scene/ArtworkSelectionOverlay.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css`

- [ ] 3.1 先在 `decorationEditor.test.js` 写失败用例：
  - `clearSelection()` 会清空 `selectedId`、触发 `onSelectionChange(null)` 并刷新材质选择态；
  - 通过画布点选或右侧 state 同步选中时，选中图层会接受一次短暂的材质透明度/亮度反馈，反馈结束恢复 `refreshSelection()` 规定的材质值；
  - 反馈不调用 `onChange`，不会修改 `x/y/scale/rotation` 或持久化设计数据。
- [ ] 3.2 运行失败测试：

```powershell
npm test -- --run src/features/configurator/scene/decorationEditor.test.js
```

- [ ] 3.3 在 `DecorationEditor` 中实现：
  - 公共 `clearSelection()`，只处理编辑器内存选中状态和回调；
  - 仅对新选中的表面执行约 160–220ms 的可取消材质 opacity/brightness 闪现，然后调用 `refreshSelection()`；
  - 保存并在 `dispose()` 时清除 timer，避免卸载后访问 disposed material；
  - `sync()` 外部 active id 变化也走同一套反馈，但相同 id 的重复 sync 不重复闪烁；
  - 保持拖动时已有的 `isEditing()`、位置更新和材质资源释放逻辑。
- [ ] 3.4 从 `garmentRenderer.js` 删除只服务红框的内容：`getDecorationSelectionRect`、投影角点/anchor 计算、`lastDecorationAnchor`、`syncDecorationAnchor`、`onDecorationAnchorChange` 及调用点。保留打印文字工具条所用的 `getPrintSelectionRect` 和 print anchor 链路。
- [ ] 3.5 从 `ProductStage.jsx` 移除 `decorationAnchor` state、传给 `GarmentRenderer` 的对应回调和 `ArtworkSelectionOverlay` 渲染/import；删除 overlay 文件与测试；从 CSS 移除 `.artwork-selection-frame`。
- [ ] 3.6 更新 `ProductStage.test.jsx`、`garmentRenderer.test.js`：保留打印选框断言，但改为断言图案红色 overlay 不存在；确保不再向 renderer 注入 decoration anchor callback。
- [ ] 3.7 运行：

```powershell
npm test -- --run src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/scene/ProductStage.test.jsx
```

**验收：** 画布不再出现不准确的红色框；点选图案仍有短暂反馈；反馈不会产生未保存的转换数据或资源泄漏。

## Task 4：实现空白点击取消、空白拖动旋转

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`
- Modify: `src/features/configurator/scene/decorationEditor.js`
- Modify: `src/features/configurator/scene/decorationEditor.test.js`

- [ ] 4.1 在 `garmentRenderer.test.js` 先为纯判定函数/事件流程加失败用例：
  - 选中图案后，空白区域 pointerdown + 未超过既有 `PRINT_DRAG_THRESHOLD` 的 pointerup 调用 `decorationEditor.clearSelection()`；
  - 空白区域 pointerdown + 超阈值 pointermove 标记为 orbit gesture，pointerup 不清除图案选择；
  - 图案命中时继续进入图案拖动并禁用 orbit；
  - print 命中时继续使用 print 的现有选择/拖动规则，不能误清空图案或 print 状态。
- [ ] 4.2 运行失败测试：

```powershell
npm test -- --run src/features/configurator/scene/garmentRenderer.test.js
```

- [ ] 4.3 在 renderer 增加独立的 `pendingDecorationDeselect` 指针起点：
  - `pointerdown` 在没有 print 命中、没有图案命中且当前存在 `selectedId` 时记录坐标；不 `preventDefault`，让 `OrbitControls` 可接收后续拖动；
  - `pointermove` 使用现有统一阈值函数检查移动；超阈值即清空 pending 标记，但不清空图案选择；
  - `pointerup` 若 pending 标记仍在，则调用 `decorationEditor.clearSelection()`；之后清理标记；
  - 图案拖动、打印拖动、dispose、状态重置都应清理该 pending 标记；不要改变 orbit 启用条件或 print 控制行为。
- [ ] 4.4 若为了测试抽取 helper，导出语义明确且无 Three.js 依赖的函数，例如：

```js
export function shouldClearDecorationOnPointerUp({ hasPendingDeselect, exceededThreshold }) {
  return hasPendingDeselect && !exceededThreshold;
}
```

  仅在它确实降低事件分支复杂度时添加，避免重复维护两个阈值状态。
- [ ] 4.5 运行场景聚焦测试：

```powershell
npm test -- --run src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/scene/ProductStage.test.jsx
```

**验收：** 空白单击明确取消当前图案；空白拖动仍平滑旋转衣服且不要求先取消选择；拖动图案和 Name set 逻辑维持原行为。

## Task 5：全量验证、构建与视觉检查

**Files:**
- Modify if needed: `project-logs/changes/2026-07-17-artwork-library-and-selection.md`（仅记录实际完成项与验证）

- [ ] 5.1 运行完整单测：

```powershell
npm test
```

- [ ] 5.2 运行生产构建：

```powershell
npm run build
```

- [ ] 5.3 本地启动预览，使用浏览器按以下顺序人工验证：
  1. 添加 Crest Badge、Roundel Badge 和一张上传图，确认右侧三张缩略图、槽位计数和选中态正确；
  2. 点击不同缩略图，确认当前操作区跟随切换且画布没有红框；
  3. 点击每个图块右上角删除，确认只删除目标项；分别验证删选中项和删未选中项；
  4. 在画布点图案后拖动，确认可移动；空白短点后确认右侧选中态消失；再次点图案并在空白处拖动确认衣服旋转、右侧仍保持该项选中；
  5. 导入含历史 Golden Stripe / Night Grid 的保存设计，确认可渲染和缩略图预览；
  6. 验证 Name set 的打印编辑与工具条仍可用。
- [ ] 5.4 运行变更检查并仅提交本功能文件：

```powershell
git diff --check
git status --short
git diff -- src/features/configurator docs/superpowers project-logs
```

- [ ] 5.5 如确有实际变更日志，写入日期、用户可见行为、测试/构建命令结果和遗留事项；不记录为已部署。

**验收：** 单测和构建通过，人工检查覆盖新增、选择、删除、拖动、旋转与历史设计兼容；Git diff 仅包含本计划范围内的功能文件和必要记录。

## 最终交付检查

- [ ] 页面上没有 Artwork 的红色选中矩形或相关 DOM/CSS/测试残留。
- [ ] 右侧显示全部已添加（最多 8 个）图案，每项可选择、可删除。
- [ ] 图案选择不会改变转换数据；短暂反馈会自动结束并可在卸载时清理。
- [ ] 空白点击取消图案选择；空白拖动旋转且保留图案选择。
- [ ] 当前预设、上传图、历史隐藏预设和 Name set 均经过回归验证。
- [ ] 未触碰主工作树的 `package-lock.json` 和 `.superpowers/` 未提交内容。
