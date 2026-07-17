# Artwork List Camera Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Artwork 已添加图案改为纯文字列表，点击名称时快速平滑聚焦其 3D 位置。

**Architecture:** `ArtworkLibrary` 只渲染名称与删除；`DecorationPanel` 将显式点击通知 `ProductStage`；舞台委托 `GarmentRenderer` 从 `DecorationEditor` 取得 decal 世界中心并以 GSAP 同时动画 camera/OrbitControls target。

**Tech Stack:** React、Three.js、GSAP、OrbitControls、Vitest。

---

## Files

- `src/features/configurator/ui/ArtworkLibrary.jsx` / `.test.jsx`：删除预览图片与 `resolveAsset` prop，保留 `aria-pressed` 名称按钮和同级删除按钮。
- `src/features/configurator/ui/DecorationPanel.jsx` / `.test.jsx`：新增可选 `onArtworkSelect(id)`，仅在用户点击列表名称后调用。
- `src/features/configurator/ui/configurator.css`：单列、36px 高的紧凑文字行，保留选中态、焦点环与删除按钮。
- `src/features/configurator/scene/decorationEditor.js` / `.test.js`：新增 `getDecorationWorldCenter(id)`，缺失 layer 返回 `null`。
- `src/features/configurator/scene/garmentRenderer.js` / `.test.js`：新增 `focusDecoration(id)`，取消旧 camera/target tween，以 0.4 秒动画聚焦 decal 中心，不写入设计数据；dispose 清理 tween。
- `src/features/configurator/scene/ProductStage.jsx` / `.test.jsx`：将面板回调转发到 `rendererRef.current.focusDecoration(id)`。

## Task 1: Text-only artwork list (TDD)

- [ ] 写失败测试：`queryByRole('img')` 为空；`getByRole('button', { name: 'Crest Badge' })` 有 `aria-pressed`；删除按钮仍存在且不调用选择。
- [ ] 运行 `npm test -- --run src/features/configurator/ui/ArtworkLibrary.test.jsx`，确认失败。
- [ ] 从 `ArtworkLibrary` 删除 `<img>` 和 `resolveAsset`，将选择按钮保留为：

```jsx
<button aria-pressed={decoration.id === activeDecorationId} className="artwork-library-select" onClick={() => onSelect(decoration.id)} type="button"><span>{decoration.label}</span></button>
```

- [ ] 改 CSS：`.artwork-library { display:grid; gap:6px; }`，`.artwork-library-select { display:flex; min-height:36px; padding:8px 38px 8px 10px; }`；删除图片选择器。
- [ ] 运行聚焦测试并提交 `feat: compact artwork list`。

## Task 2: UI-to-stage selection signal (TDD)

- [ ] 写失败测试：点击 `Roundel Badge` 后 `onArtworkSelect('roundel-1')` 被调用；只更新 active id，不改图案转换数据。
- [ ] 运行 `npm test -- --run src/features/configurator/ui/DecorationPanel.test.jsx src/features/configurator/scene/ProductStage.test.jsx`，确认失败。
- [ ] 在 `selectArtwork` 中实现：

```js
updateDecorations(decorations, id);
onArtworkSelect?.(id);
```

- [ ] ProductStage 将回调转发：

```jsx
onArtworkSelect={(id) => rendererRef.current?.focusDecoration(id)}
```

- [ ] 运行聚焦测试并提交 `feat: focus camera from artwork selection`。

## Task 3: Animated 3D focus (TDD)

- [ ] 写失败测试：`getDecorationWorldCenter('missing')` 返回 null；有效 id 返回 surface 世界坐标；`focusDecoration` 对 camera position 和 controls target 创建 0.4 秒 tween；无 layer 不创建 tween；不调用 state patch。
- [ ] 运行 `npm test -- --run src/features/configurator/scene/decorationEditor.test.js src/features/configurator/scene/garmentRenderer.test.js`，确认失败。
- [ ] 编辑器实现：

```js
getDecorationWorldCenter(id) {
  const layer = this.layers.get(id);
  return layer?.surface ? layer.surface.getWorldPosition(new THREE.Vector3()) : null;
}
```

- [ ] renderer 实现：取得中心，使用当前 `camera.position - controls.target` 方向和 clamp 后距离；`gsap.killTweensOf([camera.position, controls.target])`；以 `duration:0.4, ease:'power2.out'` 同时 tween camera 和 target；无中心返回 false；dispose 清 tween。
- [ ] 运行聚焦测试并提交 `feat: animate camera to selected artwork`。

## Task 4: Verify, merge, and push

- [ ] 运行：`npm test`、`npm run build`、`git diff --check`。
- [ ] 本地验收：点击两个文字名称均产生快速平滑镜头移动；删除不触发镜头；拖动图案、空白旋转、Name set 正常。
- [ ] 检查主工作树仅保留原有 `package-lock.json`、`.superpowers/` 未提交项后，合并 `codex/artwork-list-camera` 到 `showcase`，执行 `git push origin showcase` 和 `git push backup showcase`。
