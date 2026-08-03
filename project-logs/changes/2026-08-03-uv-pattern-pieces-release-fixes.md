# 2026-08-03 UV 裁片发布修复收口

## 日期

2026-08-03

## 本次目标

- 将 UV 裁片发布候选收敛到不含 Shopify form ownership / 结账链路的纯 UV 分支。
- 更正工厂裁片方向和基础外观 mesh 覆盖记录。
- 明确旧浏览器 ZIP 仅为修复前证据，保留最终主代理验证和用户发布确认边界。

## 修改范围

- 更新阶段二生产文件 handoff 的当前分支、方向、外观覆盖、证据状态和发布前待验收项。
- 清理 UV 裁片设计规格第 3 行尾随空格。
- 新增本变更日志和对应聊天收口日志。
- 本次不修改代码、测试、依赖、Shopify、Cloudflare 或任何线上环境。

## 新增内容

- 新增 `UV release-fix 收口（2026-08-03）`：记录 clean 分支来源、四个修复提交、factory pieces 边界和最终验收清单。
- 新增发布收口聊天摘要，保存关键决策、否决路径、分支/回滚点和发布确认要求。

## 调整内容

- 当前发布候选改记为本地 `codex/uv-pattern-pieces-clean`。该分支从 `0a0bd1c` 重建，只保留 UV 范围提交；原 `codex/uv-pattern-pieces` 夹带的 Shopify form ownership / 结账链路不进入发布候选。
- Chelsea 与 FN8788 的 factory `pieceGroups` 仍保持 `front` / `back`，两面方向均调整为 `rotation: 180`、`mirrorX: true`。
- 基础外观改由独立 `appearanceGroups` 管理：Chelsea 19 个、FN8788 16 个服装 mesh 全覆盖；袖底、袖口归入 `sleeves`。
- 旧 ZIP、preview 和 verifier PASS 改记为 pre-fix/结构历史证据，不再代表修复后的视觉通过。

## 修复内容

- 修复 handoff 中把当前方向写成 `rotation: 0`、`mirrorX: false` 的过时描述。
- 修复把旧裁片文字倒置归因于可忽略 raw UV 朝向的错误结论；现已记录其为需要修复的垂直翻转。
- 修复“外观仅覆盖 front/back 主身 mesh”的过时边界说明，补充下摆/侧面黑块根因相关的全 mesh 覆盖和无有效 UV fail-closed 行为。
- 修复设计规格中的尾随空格，避免本 range 出现 diff-check 空白问题。

## 影响范围

- 只影响发布交接、规格格式、变更记录和聊天收口记录。
- 不改变 `c8f5709`、`543ce0c`、`0216c55`、`acbe882` 已实现的代码行为。
- 不代表已经生成新的 ZIP、截图或浏览器视觉证据。
- 未 push、未 merge、未发布、未部署。

## 自检

- 已核对当前分支为 `codex/uv-pattern-pieces-clean`，文档修改前工作区干净，HEAD 为 `acbe882`。
- 已核对当前配置：两模型 front/back 均为 `rotation: 180`、`mirrorX: true`；Chelsea 19 个、FN8788 16 个 appearance mesh；factory pieces 仍为 front/back。
- 四个 release-fix 已有 focused/agent 定向验证证据；本日志不把这些证据扩大为当前分支的最终全量发布验证。
- 文档提交前执行 `git diff --check`、完整 diff 自审和文件范围检查；结果以本次提交前的新鲜命令输出为准。

## 遗留问题

- 主代理仍需在 clean 分支 HEAD 上执行最终全量测试、构建和发布前检查。
- 主代理仍需重新生成真实浏览器 Chelsea ZIP，并在入口允许时补 FN8788；旧 ZIP 不可复用为最终证据。
- 新裁片图/PDF 仍需确认文字方向、下摆/侧面黑块、透明间隔和正背面隔离。
- 新导出的 manifest 仍需确认 front/back 均为 `rotation: 180`、`mirrorX: true`。
- push、merge、release、deploy 均需用户明确确认。
