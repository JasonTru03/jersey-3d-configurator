# 2026-08-03 UV 裁片发布收口摘要

## 结论

UV 裁片发布候选必须使用本地 `codex/uv-pattern-pieces-clean`，不能继续使用夹带 Shopify form ownership / 结账链路的原 `codex/uv-pattern-pieces`。clean 分支已从 `0a0bd1c` 重建并排除全部 Shopify 提交；当前没有 push、merge、release 或 deploy。

## 关键决策

- 工厂裁片方向以真实 GLB 非对称像素证据为准：Chelsea、FN8788 的 front/back 均采用 `rotation: 180`、`mirrorX: true`。
- front 与 back 必须分别证明方向；identity、仅 mirror、仅 rotation 都是失败路径，不能只用正片证据推断背片。
- 基础外观与工厂裁片职责分离：`appearanceGroups` 负责所有可渲染服装 mesh 的基础颜色/花型，`pieceGroups` 只负责 front/back factory pieces。
- Chelsea 19 个、FN8788 16 个服装 mesh 必须全部进入 appearance coverage；袖底和袖口归 `sleeves`。配置 mesh 没有有效 UV 时 fail closed。
- 旧浏览器 ZIP/preview 是 release-fix 前的历史证据。它们显示裁片文字垂直翻转以及下摆/侧面黑块，不能继续作为最终视觉通过材料。

## 被否决路径

- 否决直接发布或继续整理原 `codex/uv-pattern-pieces`：该分支混入了本 UV 任务之外的 Shopify 结账链路。
- 否决沿用 `rotation: 0`、`mirrorX: false`，也否决 identity、仅 mirror、仅 rotation 的替代变换：真实 GLB 正背片非对称像素证据不能通过。
- 否决用 `pieceGroups` 同时承担基础外观覆盖：只覆盖 front/back 会遗漏袖底、袖口、肩侧、下摆或领口 mesh，并在旧导出中表现为黑块。
- 否决把 3D preview 方向正确当作工厂裁片图方向正确：两者验证目标不同。
- 否决复用旧 ZIP 或伪造新 ZIP/截图结果：release-fix 后的真实浏览器导出尚未完成。

## 当前分支与回滚点

- 当前本地分支：`codex/uv-pattern-pieces-clean`
- clean 重建基线 / 全量 UV 回退点：`0a0bd1c`
- release-fix 前检查点：`1bc781a`
- 文档收口前代码 HEAD：`acbe882`
- 原分支：`codex/uv-pattern-pieces`，不作为发布候选
- 远端/发布状态：未 push、未 merge、未发布、未部署

## 验收前验证边界（历史状态）

- `c8f5709`、`543ce0c`、`0216c55`、`acbe882` 已有 focused/agent 定向验证证据。
- 旧全量测试、构建、ZIP verifier 和浏览器导出早于 release-fix，只能作为历史或结构证据。
- 本次文档代理只负责文档范围检查、`git diff --check` 和 diff 自审，不声明功能全量验证完成。

## 当时下一步（已执行）

以下清单中的 clean HEAD 全量验证、Chelsea 浏览器 ZIP、manifest/裁片视觉检查和 handoff 回写均已由后续真实验收完成；FN8788 因页面没有切换入口，继续保留 native Canvas 自动化证据。

1. 主代理在 clean 分支最新 HEAD 上重新执行最终全量测试、构建和发布前检查。
2. 主代理用真实浏览器重新导出 Chelsea 七文件 ZIP；产品入口允许时补 FN8788 同等导出。
3. 检查新 manifest 的 front/back 方向均为 `rotation: 180`、`mirrorX: true`。
4. 目视检查新裁片图/PDF：文字不垂直翻转，下摆/侧面无黑块，袖底/袖口/肩侧/领口外观完整，正背面内容隔离且透明间隔正确。
5. 把新 ZIP 路径、截图/解包证据、测试计数、构建结果和风险补回 handoff；如果任何一项失败，不进入发布确认。

## 发布需用户确认

完成上述最终验证后，仍需用户明确批准才能 push、merge、release 或 deploy。不得因本地 focused 测试、文档提交或旧 ZIP verifier PASS 自动视为获得发布授权。

## 后续真实验收结论

- 首次 release-fix 后 WebGL 检查发现大块黑色仍存在，根因不是 GLB 或 appearance mesh 覆盖，而是 production Atlas 使用 `1 - v`、运行时 appearance texture 却设置 `flipY = false`。
- 已按 TDD 修正两个运行时入口为 `flipY = true`；测试先 2 failed，再 2 passed。
- 硬刷新后 Chelsea 正背面完整，旧下摆/侧面黑块消失；正面 `FRONT` 与背面 `FACTORY / 18` 均在真实预览中正确隔离。
- 新生产包：`C:\Users\Administrator\Downloads\fn8788-jersey-design-07f60cd8.zip`，精确七文件，CLI verifier PASS，4K Atlas/pieces 与两页 PDF 均已目视检查。
- front/back 裁片放大后领口朝上、文字正向；manifest 两片均为 `rotation: 180`、`mirrorX: true`。
- in-app Browser 因局域网非安全上下文无法执行 SHA-256，完整生成改由 Chrome localhost 验收。这不改变代码发布边界。
- FN8788 仍无页面切换入口；不把 Chelsea ZIP 外推成 FN8788 浏览器证据。
- 释放 Chrome 标签页并停止本轮 Vite 后，最终门槛通过：42/42 package verifier tests、76 files / 1,096 全量 tests、app/Shopify build、showcase build、Wrangler dry-run、新 ZIP verifier 均 exit 0。
- 当前仍未 push、merge、release 或 deploy，最终动作必须由用户明确选择。
