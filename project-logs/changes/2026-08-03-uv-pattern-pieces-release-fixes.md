# 2026-08-03 UV 裁片发布修复收口

## 日期

2026-08-03

## 本次目标

- 将 UV 裁片发布候选收敛到不含 Shopify form ownership / 结账链路的纯 UV 分支。
- 更正工厂裁片方向和基础外观 mesh 覆盖记录。
- 修复 release-fix 后运行时贴图 V 轴不一致，并完成新的真实浏览器生产包验收。
- 明确用户发布确认边界。

## 修改范围

- 更新阶段二生产文件 handoff 的当前分支、方向、外观覆盖、证据状态和发布前待验收项。
- 清理 UV 裁片设计规格第 3 行尾随空格。
- 新增本变更日志和对应聊天收口日志。
- 修改 `garmentRenderer.js` 与对应测试，更新交接和项目日志。
- 代码与文档修复阶段不修改依赖、Shopify 或 Cloudflare 配置；用户明确批准后，发布收口更新 Cloudflare 生产 Worker 版本。

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

- 代码只影响基础外观 CanvasTexture 的运行时 V 轴方向；生产 Atlas、factory pieces、七文件契约和 Shopify/Cloudflare 链路不变。
- 文档更新发布交接、规格格式、变更记录、聊天收口和真实 ZIP 证据。
- 发布前未 push、merge 或部署；用户批准后已按后文“生产发布”完成。

## 自检

- 已核对当前分支为 `codex/uv-pattern-pieces-clean`，修复前 HEAD 为 `f4840e3`。
- 已核对当前配置：两模型 front/back 均为 `rotation: 180`、`mirrorX: true`；Chelsea 19 个、FN8788 16 个 appearance mesh；factory pieces 仍为 front/back。
- 已完成 TDD RED/GREEN、真实 Chrome WebGL/ZIP/PDF 验收、42 项 package verifier tests、1,096 项全量测试、两类构建和 Wrangler dry-run。
- 提交前继续执行 `git diff --check`、完整 diff 自审和文件范围检查。

## 遗留问题

- 页面没有 FN8788 模型切换入口，因此 FN8788 仍无同等浏览器 ZIP；保留真实 GLB native Canvas 自动化证据。
- 页面标题/模型为 Chelsea，但产品 ID 与 ZIP 前缀仍为 `fn8788-jersey`；本阶段不改命名。
- 用户已明确确认发布；实际远端、Worker 版本和回滚点见后文。

## 运行时贴图方向与真实生产包补充

### 修复内容

- 修复 release-fix 后 WebGL 外观画布与运行时 `CanvasTexture` 的 V 轴约定不一致：模型加载和外观更新两个入口均改为 `flipY = true`。
- 保留生产 Atlas 的 `1 - v` 坐标和 factory piece 变换，不改变七文件契约或工厂裁片布局。
- 在 `garmentRenderer.test.js` 为两个运行时入口补充方向断言。RED 为 2 failed，GREEN 为 2 passed。

### 真实链路自检

- Chrome `http://localhost:4182/` 真实 WebGL 中，正背主身、袖子和领口均完整；旧版下摆/侧面大块黑块消失。
- 生成新包 `C:\Users\Administrator\Downloads\fn8788-jersey-design-07f60cd8.zip`，大小 3,872,784 bytes，设计指纹 `07f60cd8`。
- 七文件齐全；两张 PNG 为 4096×4096；PDF 为两页 A4 横向；CLI verifier 输出 `PASS (07f60cd8, 4096x4096, 2 PDF pages)`。
- 正面 preview 仅含 `FRONT`，背面 preview 仅含 `FACTORY / 18`。放大后的 front/back factory pieces 均领口朝上、文字正向可读。
- manifest 的 front/back 均为 `rotation: 180`、`mirrorX: true`。

### 验证边界

- in-app Browser 的局域网地址不是 secure context，不能调用 SHA-256；这是验收环境限制，Chrome localhost 已覆盖完整生成链路。
- 页面仍只提供 Chelsea 模型；FN8788 继续依赖真实 GLB native Canvas 自动化证据。
- 页面标题/模型为 Chelsea，但 `productId` 和 ZIP 前缀仍为既有 `fn8788-jersey`。本阶段未改产品命名。
- 浏览器资源释放并停止本轮 Vite 后，新鲜验证结果为：package verifier tests 42/42；默认全量 76 files / 1,096 tests；app/Shopify build、showcase build、Wrangler dry-run 和新 ZIP CLI verifier 均 exit 0。
- 全量仍有两条既有 jsdom navigation 提示；构建仍有大 chunk 与 Shopify `inlineDynamicImports` 警告；Wrangler 仅有代理环境提示，均不阻塞。
- 此条为发布前验证边界；后续已获得用户明确批准并完成发布。

## 生产发布

- 发布提交：`0d4ac9c8b2e22507d007f3c32eee75c034d81f85`。
- `showcase` 已 fast-forward 推送至 `origin` 与 `backup`；未强推、未改写历史。
- Cloudflare Worker：`jersey-3d-configurator`。
- 生产地址：`https://jersey-3d-configurator.jason1064969838.workers.dev/`。
- 新版本：`211c1c5d-b6f8-4860-b77e-a41c30823678`，100% 流量。
- 该 ID 是代码发布版本；后续仅文档的收口提交可能触发内容等价的新部署，最终流量版本以 Wrangler 状态为准。
- 发布前版本/回滚点：`a5a075aa-438a-46d7-8e7d-f6b950836768`。
- 发布前复核：合并后 76 files / 1,096 tests passed；clean release worktree 的 showcase build 与 Wrangler dry-run 均 exit 0，dry-run 读取 7 个静态资源。
- 公网复核：首页、JS、CSS、Chelsea GLB 均 HTTP 200；三个静态产物哈希与本次 `dist` 完全一致；in-app Browser 中 Chelsea 模型和 594×610 WebGL canvas 正常渲染，错误/警告日志为空。
- 本次未发布 Shopify 主题，未修改商品、订单、价格、支付、binding、KV 数据或 secret。
- 回滚命令：`npx wrangler rollback a5a075aa-438a-46d7-8e7d-f6b950836768`，随后执行 `npx wrangler deployments status --name jersey-3d-configurator`。
