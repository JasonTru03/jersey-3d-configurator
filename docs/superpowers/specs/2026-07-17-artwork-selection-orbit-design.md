# Artwork 选择反馈与球衣旋转设计

日期：2026-07-17
状态：已确认，待用户审阅书面规格
适用分支：`codex/artwork-selection-orbit`

## 背景与目标

现有 Artwork 面板把图案绑定到 `Front`、`Back`、`Left sleeve`、`Right sleeve` 四个部位选择器；但用户可以在 3D 球衣上自由移动图案，因此该选择器没有实际价值。与此同时，当前 Artwork 被选中后没有可见的选择反馈，且选中状态会禁用 OrbitControls。用户移动图案后会误以为页面卡住，必须先点击图案外部取消选择才能旋转球衣。

本次只改善 Artwork 的可见性与手势归属：删除不适用的部位 UI 和不可见预设；为选中的 Artwork 显示选择框；在保留 Artwork 选择状态时仍允许旋转球衣。Name set 的选中框、控制按钮和旋转行为不在本次范围内。

## 用户可见行为

1. Artwork 面板不再显示 `Front`、`Back`、`Left sleeve`、`Right sleeve` 按钮。
2. `Golden Stripe` 与 `Night Grid` 预设从面板和产品配置移除；仅保留 `Crest Badge`、`Roundel Badge` 和上传入口。
3. 新增 Artwork 和上传 Artwork 都按现有默认前方可见位置创建；用户可直接通过拖动将其移动至任意可命中的球衣表面。既有设计文件中的 `region` 字段仍可读取，用于兼容旧贴花位置。
4. 点击 Artwork 后，舞台在该图案的屏幕投影边界显示细橙色选择框；图案被相机遮挡、离开舞台或投影无效时，选择框隐藏。
5. 鼠标或触摸从 Artwork 本体开始拖动时，只移动该 Artwork；松开后仍保持选中框与侧边 Artwork 操作。
6. 鼠标或触摸从未命中 Artwork 的球衣区域开始拖动时，旋转球衣，即使 Artwork 仍为选中状态。该动作不取消 Artwork 选择。
7. 选择其他 Artwork、从右侧面板添加新的 Artwork 或删除当前 Artwork 时，选择框和当前操作对象同步更新；删除后选择框隐藏。

## 实现边界与数据流

### 产品与 Artwork 面板

- `productDefinitions.js` 删除两个不可见预设，并删除不再对用户公开的 `decorationRegions` 配置。
- `DecorationPanel.jsx` 停止读取、展示和写入 `activeDecorationRegion`；预设与上传 Artwork 统一使用现有默认 `front` 区域作为初次投影提示。
- `region`、`placement`、`activeDecorationId` 和现有保存/导入格式保持不变。`region` 仍是旧设计兼容与初次投影所需的内部数据，不再作为用户可编辑设置。
- 侧边已有的旋转、缩放、删除按钮继续作用于 `activeDecorationId`，不新增 Artwork 工具按钮。

### 3D 选择与相机手势

- `DecorationEditor` 将“已选中”与“正在拖动”分离：`selectedId` 仅用于高亮、选择框和右侧操作；只有 `dragging` 为真时才占用相机手势。
- 点击未命中 Artwork 时不再清除 `selectedId`，并返回未处理状态，让已有 OrbitControls 接收本次指针操作。
- 点击命中 Artwork 时选中并开始 Artwork 拖动；拖动中继续通过已有的球衣网格射线检测更新 `placement`。未命中网格时保留最后一个有效位置。
- `GarmentRenderer` 只在 Artwork 拖动期间禁用 OrbitControls；指针抬起后立即恢复。Name set 的现有命中与拖动优先级不改变。

### Artwork 选择框

- 新增独立 `ArtworkSelectionOverlay`，只负责渲染不可交互的屏幕选择框，不复用 Name set 的五按钮工具栏。
- 渲染器把选中 Artwork 的 3D 边界投影为舞台 CSS 像素矩形，并通过 `onDecorationAnchorChange` 传给 `ProductStage`。相机旋转、缩放、Artwork 移动或尺寸变化时同步更新。
- 选择框容器为 `pointer-events: none`，因此不会拦截对图案本体的拖动，也不会影响图案外球衣区域的 OrbitControls 手势。
- 与 Name set 的投影通知相同：仅在矩形实际变化时更新 React 状态，避免每帧无效渲染。

## 错误处理与兼容性

- 预设删除不会删除用户旧设计中已保存的 `golden-stripe` 或 `night-grid` 图案；加载旧设计时仍按其已保存的素材来源尝试恢复。若旧预设资源无法解析，沿用现有图片加载错误处理，不以静默默认图替代。
- 贴花渲染层尚未建立、选中 ID 不存在、矩形投影无效时，选择框不显示，且不会保留上一次的旧位置。
- 不改变 8 个 Artwork 槽位上限、上传文件校验、设计文件格式、Shopify 集成、购物车、Checkout、支付、服务器保存或 Cloudflare 配置。

## 测试与验收

先写失败测试，再做最小实现。至少覆盖：

1. 产品配置只暴露两枚徽章预设，Artwork 面板不渲染部位选择器。
2. 新增或上传 Artwork 仍采用默认初始区域，且现有选中、缩放、旋转、删除操作可用。
3. 选中但未拖动 Artwork 时，编辑器不占用 OrbitControls；从图案本体开始的拖动仍占用手势并更新位置。
4. 选中 Artwork 后，从未命中 Artwork 的位置开始拖动，不清除选择且允许相机操作。
5. 选择框在有效投影时显示并随相机/图案变化更新；选中项删除、不可见或无效时隐藏；覆盖层不接收指针事件。
6. 运行目标 Vitest 测试、完整 `npm test` 与 `npm run build:showcase`。在支持 WebGL 的浏览器人工验证：选中反馈清晰、拖图案移动、拖空白球衣旋转、删除后无残留框，桌面与移动端布局正常。

## 风险与回退

风险集中在 3D 几何的屏幕投影：非常小或被遮挡的贴花可能没有可用矩形；此时隐藏选择框优于显示过期位置。图案拖动仍使用既有网格射线检测，本次不改变贴花几何或保存结构。

所有修改在该独立分支内提交。若上线验收不符合预期，可回退本次单一功能提交，不改写 `showcase` 历史。未经用户再次确认，不合并、推送或发布。
