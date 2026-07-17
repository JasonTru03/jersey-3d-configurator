# Artwork List And Camera Focus Design

## Goal

把 Artwork 面板中已添加图案的缩略图网格改为紧凑的纯文字列表；点击图案名称时选中该图案，并以快速、平滑的镜头动画把 3D 视图定位到图案的实际位置。

## User-visible behavior

- 已添加图案区域每项只显示图案名称和删除图标，不再显示图片缩略图。
- 点击名称会更新当前选中图案，随后在约 0.4 秒内平滑移动镜头和 OrbitControls 焦点至该图案位置；不会瞬移。
- 删除图标继续只删除对应图案，不触发选择或镜头移动。
- 图案拖动、空白点击取消、空白拖动旋转、上传、8 个图案上限和 Name set 控制保持原有行为。

## Architecture

- `ArtworkLibrary` 保持纯 UI 职责：删除预览 `<img>`，保留可访问的名称选择按钮和独立删除按钮。
- `DecorationPanel` 的选择回调维持状态更新，并新增一个可选的 `onArtworkSelect` 通知，以避免 UI 直接依赖 Three.js。
- `ProductStage` 接收该通知并委托 `GarmentRenderer`。
- `GarmentRenderer` 从 `DecorationEditor` 查询已渲染图案表面对应的世界空间中心点，使用现有 GSAP 与 OrbitControls 同时补间 camera position 与 target。镜头方向沿当前 camera-to-target 向量保持，距离限制在 controls 的 min/maxDistance 范围内。
- 不写入 decoration 的 x/y/scale/rotation/placement，动画仅改 camera 与 controls target。

## Error handling and lifecycle

- 图案尚未完成加载、已被删除或找不到表面时，只完成右侧选择，不启动镜头动画。
- 新的图案选择会覆盖前一个图案聚焦动画，避免叠加抖动。
- `dispose()` 中杀掉镜头补间，防止场景卸载后继续更新已释放对象。

## Verification

- UI 测试：不渲染图像预览；名称可选择；删除仍不触发选择；列表保持最多 8 项。
- 场景测试：有渲染表面时计算图案中心并创建 camera/target 补间；无表面时无动画；重复聚焦会覆盖旧补间；不修改图案持久化数据。
- 运行完整 `npm test`、`npm run build` 和 `git diff --check`。
- 在本地 3D 页面人工验证：点击列表名称可见快速平滑移动，删除、拖动和 orbit 行为没有回归。
