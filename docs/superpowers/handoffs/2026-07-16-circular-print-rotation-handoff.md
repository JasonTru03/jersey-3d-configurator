# Name Set 圆周拖动旋转交接记录

日期：2026-07-16  
分支：`codex/circular-print-rotation`  
状态：待合入 `showcase` 与发布

## 本次变更

- 右上旋转控件从固定点击 `+15°` 改为 Pointer Capture 圆周拖动。
- 旋转以 Name Set 选中框中心为圆心；顺时针与逆时针鼠标轨迹分别产生对应方向旋转。
- 每一帧使用相邻角度的最短差值，跨越 `0°/360°` 时不产生反向跳转。
- 可以连续转过多圈；每次写入的 `rotation` 归一化为 `0` 到小于 `360`，因此超过一圈后数值回绕、视觉持续。
- 只按下并松开不改变文字角度；`pointerup`、`pointercancel` 和失去 Pointer Capture 会清理临时旋转状态。
- `ProductStage` 直接保存旋转手柄传入的绝对角度，不再额外叠加固定 15 度。

## 修改文件

- `src/features/configurator/scene/PrintToolbarOverlay.jsx`
  - 增加角度计算、最短角度差和角度回绕逻辑。
- `src/features/configurator/scene/ProductStage.jsx`
  - 将旋转回调改为直接写入标准化绝对角度。
- `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
  - 覆盖 Pointer Capture、跨零回绕、多圈拖动与点击不旋转。
- `src/features/configurator/scene/ProductStage.test.jsx`
  - 覆盖绝对角度写回配置状态。
- `src/features/configurator/ui/configurator.css`
  - 旋转手柄禁用默认触摸手势竞争。

## 验证证据

| 检查项 | 结果 |
| --- | --- |
| 旋转与状态专项测试 | 2 个文件、14 项通过 |
| 全量 `npm test` | 18 个测试文件、66 项通过 |
| `npm run build:showcase` | 成功；产物为 `index-DZ77aMAW.js` |
| 构建提示 | 仍有既有单 chunk 超过 500 kB 的非阻塞提示，本次未修改拆包策略 |

## 待在真实 WebGL 浏览器确认

自动化环境不能驱动实际 WebGL 画布，需要在桌面浏览器或发布后网页确认：

1. 按住右上旋转手柄，顺时针转动超过一整圈，文字持续旋转。
2. 逆时针跨越 `0°`，数值回绕到高位且视觉连续。
3. 指针拖离旋转按钮区域，旋转继续直至松手。
4. 只点击并松开旋转按钮，文字角度不改变。
5. 松手后刷新或保存/打开设计，最终标准化角度仍保留。

## Git 与发布

规格、计划、实现和验证提交均已推送到：

- `origin`：`JasonTru03/jersey-3d-configurator`
- `backup`：`SuJianben/Custom-made-jerseys`

建议使用常规非快进合并把 `codex/circular-print-rotation` 合入 `showcase`，合并后重新运行测试与构建并推送两个远程；Cloudflare 应从 `showcase` 自动部署。
