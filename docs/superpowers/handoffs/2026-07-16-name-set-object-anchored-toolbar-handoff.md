# Name Set 对象锚定工具栏交接（2026-07-16）

## 本次目标

- 删除最后一个 Name set 后，再次选择 `Name set` 能重新创建默认 `PLAYER / 16`。
- 工具栏仅在存在选中印花且其 3D 投影可见时显示，并紧贴该印花。
- 工具栏随拖动、旋转、缩放与镜头移动重新投影；靠近右侧或顶部时自动翻转到可用一侧。

## 已完成实现

- `ensurePrintItems` 为删除后的 Name set 恢复默认不可变印花对象。
- `GarmentRenderer` 将选中印花的世界坐标投影到舞台像素坐标，并在坐标、可见性或避让方向变化时通知 React。
- `ProductStage` 将选中对象同步回渲染器；复制后新对象会成为工具栏锚定对象，删除时立即清除锚点。
- `PrintToolbarOverlay` 使用 CSS 变量定位，并支持 `right-top`、`left-top`、`right-bottom`、`left-bottom` 四种避让方向。

## 验证证据

- `npm test -- --run`：18 个测试文件、59 项测试通过。
- `npm run build:showcase`：Vite 生产构建通过。
- 定向覆盖包括：删除后重加、锚点可见性、四向翻转、重复回调去重、复制对象选中同步、编辑与删除页面流程。

## 浏览器验收限制

本机自动化可用的内嵌浏览器与 Chrome 控制页均未提供 WebGL，均显示 `3D` 降级占位，无法自动观察真实 GLB 球衣上的移动效果。该限制不影响构建和渲染器单测结论；发布前仍建议在用户正常 Chrome/Cloudflare 展示页手动确认一次：添加 Name set、拖动印花、将镜头移至右上边缘、删除后再次添加。

## Git 与发布状态

- 功能分支：`codex/name-set-object-anchored-toolbar`
- 本阶段功能提交：`ea29ad8 feat: anchor name set toolbar to selected print`
- 已推送到 `origin`（JasonTru03/jersey-3d-configurator）和 `backup`（SuJianben/Custom-made-jerseys）。
- 尚未合并 `showcase`，也未触发 Cloudflare 发布；等待明确的合并/发布指令。
