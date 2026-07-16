# Name Set 圆周拖动旋转规格

日期：2026-07-16  
分支：`codex/circular-print-rotation`  
状态：待用户审阅

## 目标

将 Name Set 右上旋转控件从固定点击 `+15°` 改为可持续圆周拖动的手柄，使文字跟随鼠标围绕自身中心的运动实时旋转。

## 交互规则

- 按住右上旋转手柄后，以选中框中心为圆心记录鼠标角度。
- 鼠标顺时针运动时文字顺时针旋转，逆时针时反向旋转。
- 每次指针移动仅计算与上一帧之间的最短角度差，处理跨过 `0°/360°` 的边界时不会出现反向跳转。
- 允许用户持续转过任意多圈；状态中每次写回的旋转值始终标准化为 `0` 到小于 `360` 的范围。超过 `359°` 后回到 `0°`，视觉上连续不变。
- 旋转手柄使用 Pointer Capture；鼠标或手指移出手柄按钮区域后，旋转仍持续。
- `pointerup`、`pointercancel` 或失去 Pointer Capture 时清理旋转拖动状态。
- 只点击而未拖动旋转手柄不会改变文字角度。

## 修改范围

- `src/features/configurator/scene/PrintToolbarOverlay.jsx`
  - 增加指针角度、角度差、回绕标准化的最小工具函数。
  - 将旋转按钮由 `onClick` 改为完整 Pointer Capture 生命周期。
- `src/features/configurator/scene/ProductStage.jsx`
  - 接收并直接写入旋转手柄给出的标准化绝对角度，而不再叠加固定 `15°`。
- `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
  - 覆盖顺/逆时针连续拖动、跨越 0° 的回绕、Pointer Capture 和点击不改变旋转。
- `docs/superpowers/handoffs/`
  - 实施完成后增加验证和发布交接记录。

## 不做的内容

- 不修改右下缩放、文字拖放位置、球衣模型、贴花纹理、商品选项或 Cloudflare 配置。
- 不为旋转增加角度数值输入框、吸附角度或动画效果。

## 验证与发布

1. 为圆周角度差和手柄交互先写失败测试。
2. 运行受影响测试、完整 `npm test`、`npm run build:showcase`。
3. 在真实 WebGL 浏览器确认：可多圈连续拖动、跨越 0° 连续、拖出手柄不中断、点击不改角度、松手后刷新保存。
4. 每个完成阶段提交并推送 `origin` 与 `backup`；得到合并/发布授权后才更新 `showcase`。

## 回退

如需回退，对本次合并提交使用常规 `git revert`，不修改已发布历史。
