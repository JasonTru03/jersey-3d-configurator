# 2026-07-14 球衣素材区域贴合修复

## 目标

修复 Artwork 素材在背面与袖子区域悬空、遮挡错误和拖拽坐标错位的问题。

## 修改

- 将四个编辑区域定义为各自的锚点、法线、水平与垂直坐标轴。
- 素材平面不再每帧面向相机，改为依区域法线定向。
- 启用素材的深度检测，使球衣与素材保持正确遮挡关系。
- 拖拽使用区域局部坐标进行世界坐标转换与反向恢复。
- 拖拽仅更新位置，不会重置已设置的缩放或旋转。

## 兼容性

- 继续使用既有 `region`、`x`、`y`、`scale`、`rotation` 字段。
- 已验证 `C:/Users/Administrator/Downloads/fn8788-jersey-design.json` 可通过产品匹配校验，并保留 8 个素材。

## 自检

- `npx vitest run src/features/configurator/scene/decorationEditor.test.js`：6 项通过。
- `npm test`：13 个测试文件、29 项测试通过。
- `npm run build`：应用与 Shopify 构建通过。
- `npm run build:showcase`：展示构建通过。

## 遗留

- 需要在推送到 `showcase` 后进行线上视觉验收：背面、左右袖、拖拽、保存后再打开。
- 同一预设可被连续添加多次，确认弹层会如实显示素材总数；该交互体验项保留为 P2 后续优化。
