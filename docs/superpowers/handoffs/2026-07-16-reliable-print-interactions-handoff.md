# Name Set 可靠交互修复交接记录

日期：2026-07-16  
分支：`codex/reliable-print-interactions`  
状态：待合入 `showcase` 与发布

## 本次修复

- 右下缩放手柄在按下时捕获对应指针；即使指针离开 28px 按钮区域，拖动仍持续生效。
- 缩放以选择框中心为基准：向外拖动放大、向内拖动缩小；范围限制为 `0.45` 至 `2.5`。
- 缩放手柄在 `pointerup`、`pointercancel` 与失去 Pointer Capture 时清理临时状态，并禁用默认触摸手势。
- 点击 Name Set 只选中，不会立即改变位置；指针移动超过 4px 后才进入文字拖动。
- 点击未命中 Name Set 或装饰编辑器的球衣区域时，只取消选中并隐藏控制框，不再把文字移动至点击处。
- 未选中 Name Set 时，球衣空白区域的拖动仍由原有轨道相机处理。

## 代码与测试

- `src/features/configurator/scene/PrintToolbarOverlay.jsx`
  - 封装缩放距离计算、范围限制与 Pointer Capture 生命周期。
- `src/features/configurator/scene/garmentRenderer.js`
  - 增加点选/装饰/取消选中的明确决策函数，以及 4px 的文字拖动阈值。
- `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
  - 覆盖 Pointer Capture、向外/向内缩放和缩放上下界。
- `src/features/configurator/scene/garmentRenderer.test.js`
  - 覆盖空白点击取消选中决策与文字拖动阈值。

## 验证证据

| 检查项 | 结果 |
| --- | --- |
| 缩放组件测试 | 5 项通过 |
| 渲染器与缩放组件联合测试 | 12 项通过 |
| 全量 `npm test` | 18 个测试文件、64 项测试通过 |
| `npm run build:showcase` | 成功；产物为 `index-DEkjf2ix.js` |
| 构建提示 | 仍有既有的单个 chunk 超过 500 kB 警告，未阻塞构建，本次未调整拆包策略 |

## 待在真实 WebGL 浏览器确认

自动化环境无法提供实际 WebGL 画布，因此下列视觉与手势项目需要在桌面浏览器或发布后公网页确认：

1. 选中 Name Set 后，拖动右下手柄越过按钮边界，缩放不中断。
2. 从手柄向外拖会放大，向文字中心拖会缩小；最小与最大尺寸不会越界。
3. 仅点击 Name Set 而不移动时，文字位置不会跳动。
4. 拖动 Name Set 超过 4px 时，文字仍能沿球衣网格重新定位并在松手后保存。
5. 点击球衣其他位置后，控制框消失，Name Set 停留在原位置；在空白处拖动仍可旋转球衣。

## Git 与发布

本分支的规格、计划、缩放修复、点击/拖动修复和范围回归测试均已推送到：

- `origin`：`JasonTru03/jersey-3d-configurator`
- `backup`：`SuJianben/Custom-made-jerseys`

建议合入方式：由 `showcase` 合并 `codex/reliable-print-interactions`，不改写历史；合并后推送两个远程，等待 Cloudflare 基于 `showcase` 生成部署，再核验公网首页与最终 bundle 标识。
