# Name Set 可靠选择、拖动与缩放规格

日期：2026-07-16  
分支：`codex/reliable-print-interactions`  
状态：待用户审阅

## 目标

修复 Name Set 选中状态下的两项交互问题：

1. 右下缩放手柄在拖出按钮区域后会失去响应，且缺少直观的缩小路径。
2. 点击未命中 Name Set 的球衣区域会意外把当前文字移动到点击位置；期望是仅取消选中。

## 用户交互约定

### 选中与取消选中

- 点击 Name Set 文字：选中该项，显示紧贴文字投影边界的控制框。
- 点击球衣的其他位置：仅取消选中并隐藏控制框；不会修改任何 Name Set 的位置、角度或大小。
- 在球衣空白处拖动：继续由现有相机轨道控制旋转球衣。

### 移动文字

- 在已命中 Name Set 的位置按下时，先记录初始指针位置，不立即改变文字位置。
- 指针移动超过 4px 后才进入文字拖动状态，并把文字贴到当前命中的球衣网格位置。
- 仅发生过实际拖动时才写回位置状态；普通点击不会产生位置变更。

### 缩放文字

- 右下缩放手柄在按下后调用 Pointer Capture，因此鼠标或手指离开小按钮区域仍持续接收移动事件。
- 缩放以选择框中心的径向距离计算：向外拖动放大，向内拖动缩小。
- 结果限制在 0.45 到 2.5 倍，避免文字过小不可操作或过大遮挡球衣。
- 在 `pointerup`、`pointercancel` 与失去 Pointer Capture 时完整清理拖动状态。
- 手柄禁用浏览器默认触摸手势，避免移动端滚动或缩放与编辑手势竞争。

## 修改范围

- `src/features/configurator/scene/PrintToolbarOverlay.jsx`
  - 重写缩放手柄的指针生命周期与双向比例计算。
- `src/features/configurator/scene/garmentRenderer.js`
  - 区分“点选 Name Set”和“拖动 Name Set”。
  - 空白区域点击后立即结束本组件处理，不再进入贴花落点逻辑。
- `src/features/configurator/ui/configurator.css`
  - 为缩放手柄补充必要的触摸交互约束。
- 现有 Vitest 测试文件
  - 覆盖 Pointer Capture、双向缩放、缩放边界、空白点击不移动，以及移动阈值行为。
- `docs/superpowers/handoffs/`
  - 完成后增加交接与发布验证记录。

## 不做的内容

- 不修改球衣 GLB、贴花网格投射算法、商品配置、价格、保存/导入格式。
- 不新增服务端接口、购物车、Shopify 嵌入页或 Cloudflare 配置。
- 不改变编辑、旋转、复制、删除按钮的功能含义。

## 验证与发布

1. 先为每项新增交互写失败测试，再实现最小修复。
2. 运行相关 Vitest 测试、完整 `npm test` 及 `npm run build:showcase`。
3. 在可用 WebGL 浏览器中手工确认：缩放可连续放大缩小、拖出手柄不断开、点击空白只取消选中、单击文字不跳位、实际拖动仍可移动文字。
4. 每个完成阶段提交并推送至 `origin` 与 `backup`；取得用户发布授权后，再合入 `showcase` 并验证 Cloudflare 公网地址。

## 回退

如需回退，使用对本次合并提交的常规 `git revert`，不改写已发布历史。
