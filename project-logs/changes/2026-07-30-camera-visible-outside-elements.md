# 2026-07-30 镜头可见的球衣外侧元素

## 目标

- 隐藏 Design 面板中的高级 `Continuous bottom pattern` 区域与开关，同时保留旧设计数据兼容。
- 阻止从球衣当前不可见的一侧穿透选择文字、号码或 Artwork。
- 让文字、号码和 Artwork 只在球衣外侧渲染、放置和拖动。

## 新增

- 新增共享表面可见性判断：统一检查射线命中的世界空间法线、朝向和球衣遮挡关系。
- 新增 Chelsea 与 FN8788 真实 GLB 回归，覆盖 badge/upload × front/back 的默认 Artwork 投影。
- 新增外侧命中、遮挡选择、拖动、镜像模型与非退化贴花几何回归。

## 变更

- 文字与号码选择、Artwork 选择、球衣拖动命中统一接入朝外命中与球衣遮挡判断。
- Artwork 默认位置、拖动位置和已保存位置重新定位球衣网格时，统一忽略背向三角形。
- Artwork 与 personalization 共用朝向三角形过滤器；当前调用输入均为非索引 `DecalGeometry`。
- 元素材质改为 `THREE.FrontSide`；球衣基础材质仍保持 `THREE.DoubleSide`。
- Design 页面不再渲染高级 pattern 面板；底层旧字段与兼容路径未移除。

## 修复

- 修复相机从正面或背面观察时仍可选择被球衣遮挡的对侧元素。
- 修复贴花三角形可能跨到球衣内侧的问题。
- 修复负 determinant 镜像模型中过滤后三角形 winding 方向错误的问题。

## 影响范围

- 独立 3D 定制器与 Shopify section 共用的元素渲染、选择、放置和拖动链路。
- Design 面板中的高级 bottom pattern 入口。
- Chelsea 与 FN8788 两个现有球衣模型的 Artwork 默认投影回归。

## 验证

### 自动化与构建

| 检查 | 结果 |
| --- | --- |
| `npx vitest run --exclude=".worktrees/**"` | exit `0`；61/61 个测试文件、736/736 项测试通过。输出两条 jsdom `Not implemented: navigation to another Document` 提示，无失败。 |
| `npm run build` | exit `0`；`build:app`、`build:shopify` 与 CSS export 命令链完成。 |
| 构建提示 | 非阻断：app chunk 超过 500 kB；Shopify 构建提示 `inlineDynamicImports` 因 `codeSplitting: false` 被忽略。 |
| 五个关键定向文件 | exit `0`；surfaceVisibility、garmentRenderer、decorationEditor、decorationEditorGarmentModels、ConfiguratorPage 共 5/5 个文件、165/165 项测试通过。 |
| 真实 GLB 定向回归 | exit `0`；1/1 个文件、8/8 项测试通过，覆盖 Chelsea/FN8788 × badge/upload × front/back。 |
| `git diff --check` | exit `0`。 |

### 真实浏览器 WebGL

- Chelsea standalone：
  - Design 面板保留 Jersey templates 与 Zone colors；`Continuous bottom pattern` 区域和 checkbox 均不显示。
  - front PLAYER/16 与 back YOUR TEXT 只在各自外侧可见；点击被球衣遮挡的对侧投影位置不会选中隐藏元素。
  - front PLAYER 拖到左肩曲面后仍贴在外侧；约 45° 斜角下可见元素可点击。
  - front Crest 与 back Roundel 只在各自外侧可见，隐藏对侧 Artwork 不会被穿透选择。
  - Crest 拖到右胸曲面后仍在外侧；近距离衣领检查未发现图案出现在衣服内侧。
  - 浏览器 error/warn/warning 日志为空，无模型或纹理加载失败。
  - 结论：Chelsea front/back/45° 完整人工矩阵通过。
- FN8788 Shopify section 临时 harness：
  - 真实模型加载可见；front Name set PLAYER/16 与 front Crest 在外侧显示。
  - Crest 切到 back 后在背面可见，front Name set 不再显示；正背面外侧渲染通过。
  - 浏览器 error/warn 日志为空。
  - 临时 harness 的 section canvas 因长控制面板达到 2090 px，高度不利于可靠完成 45° 逐元素人工矩阵。因此未把 FN8788 的完整 45° 人工矩阵标记为通过；该模型的 front/back 真实 GLB 投影由上述 8/8 自动化回归覆盖。
  - 临时 `fn8788-preview.html` 已删除，开发服务器已停止。

## 边界与遗留

- 球衣基础材质仍为 `THREE.DoubleSide`；本次只把文字、号码和 Artwork 元素材质限定为 `THREE.FrontSide`。
- `surfaceVisibility` 当前不支持 `THREE.InstancedMesh`。
- 公共 triangle filter 当前不支持 indexed geometry；现有调用均使用非索引 `DecalGeometry`。
- 建议后续增加旧 bottom pattern 设计经真实 `Open design` 页面重新打开的页面级兼容回归。
- Phase 2 仅规划 UV reference PDF/JSON/ZIP，不代表 1:1 工厂生产输出。
- PDF/CDR 工厂文件、R2/D1、Shopify paid order、model admin 均留待后续。
- 未部署、未 push、未修改 Shopify live theme；发布必须等待用户明确确认。
