# 2026-08-04 Phase 3 云端暂存与订单关联

## 目标

- 在加入购物车前把七文件生产包安全上传到私有 R2，并用 D1 保存权威草稿索引。
- 报价和 App Proxy 只接受已验证且仍有效的云端草稿。
- 用签名 `orders/paid` webhook 将 Shopify 订单关联到设计文件，并幂等处理取消、退款和文件异常。
- 用有租约的定时清理删除过期未付款草稿，绝不删除已付款或终态订单文件。
- 给出可审计的上线顺序、资源门禁和保留数据回滚方案。

## 代码与文件归属

- 浏览器上传与设计审核：`src/features/configurator/api/productionDraftApi.js`、`DesignReviewDialog.jsx`、`ConfiguratorPage.jsx` 及测试。
- Worker 上传验证与流式存储：`workers/production/productionDraftRequest.js`、`productionPackageValidator.js`、`productionDrafts.js`、`incrementalSha256.js` 及测试。
- D1 schema/仓储：`migrations/0001_production_designs.sql`、`workers/production/productionRepository.js`、`productionLifecycleSql.js` 及单元/SQLite 集成测试。
- 云端报价和购物车交接：`workers/shopify/cloudProductionDraft.js`、`cartQuotes.js`、`appProxy.js` 及测试。
- Shopify 生命周期：`workers/shopify/orderLifecycleWebhooks.js`、Worker router、`shopify-app/shopify.app.toml` 及测试。
- 草稿清理与 bindings：`workers/production/cleanupDrafts.js`、`workers/index.js`、`wrangler.jsonc` 及测试。
- 上线说明：`docs/deployment/phase3-production-storage.md`、Shopify App README、设计规格、变更日志和聊天摘要。

## 主要提交

- `c14978c`：定义生产草稿上传客户端。
- `df7f3c5`：验证上传的生产包。
- `bbdcff2`：增加生产设计 D1 索引。
- `c66e8ca`：把已验证草稿写入 R2。
- `00e6ff7`：报价必须使用权威云端草稿。
- `7b1d88d`：加入购物车前先上传生产包。
- `4679c8b`：关联 Shopify 订单生命周期。
- `a8a575f`：清理过期未付款生产草稿。

期间的 hardening 和测试提交继续保留在分支历史中，本日志不把单个 feature commit 误写成全部安全修复。

## RED/GREEN 证据

- Task 7 RED：webhook route/handler 尚不存在；补 raw-body HMAC、D1/R2、幂等和终态测试后进入 GREEN。
- Task 7 GREEN：订单 webhook 与 router 聚焦测试通过，Shopify scaffold 校验通过；提交为 `4679c8b`。
- Task 8 RED：`cleanupDrafts.js` 不存在且 Worker 没有 `scheduled` handler。
- Task 8 GREEN：清理、Worker、router、仓储和真实 SQLite 竞态测试通过；真实 `shop_[A-Za-z0-9_-]{12}` key contract、R2 成功但 D1 删除失败、payment/cleanup 双向竞态均有直接回归；提交为 `a8a575f`。
- Task 9 单一端到端测试由 `d38d500` 补齐：实际 handlers/router、真实 migration 的内存 SQLite D1、共享内存 R2/KV、七文件生产包、fake Turnstile/rate limits、签名 App Proxy 与 `orders/paid` 全部贯通；bundle 内容和 native checksum 被改写后，D1 转为 `file_error`。focused 1/1、相邻 227 tests、完整 86 files / 1,534 tests passed。

## 已验证行为

- 上传在 D1 原子预留后才写 R2，七个文件和一个重建 ZIP 都有受限 key、metadata 和哈希。
- 报价会重新读取 D1/R2/manifest 并绑定一个权威 `bundleId`；App Proxy 私有属性携带 `designId`，买家摘要不作为授权证据。
- `orders/paid` 校验 raw-body HMAC、shop/topic/delivery identity、订单 line properties、D1 绑定和 R2 文件；缺失/损坏文件进入 `file_error`。
- 取消和退款只更新已绑定到同一 shop/order 的设计，不删除 R2 文件。
- 清理每次最多处理 100 条，只选择过期 `upload_pending`/`cart_draft` 或租约已过期的 `cleanup_pending`；顺序为原子 claim、删除 8 个 R2 keys、同 token 条件删除 D1。
- payment 与 cleanup 只允许一个数据库状态转换获胜，R2/D1 删除失败保留 `cleanup_pending` 供后续重试。

## 本地 migration 证据

仅执行了本地命令，没有使用 `--remote`：

```powershell
npx wrangler d1 migrations apply PRODUCTION_DB --local
npx wrangler d1 execute PRODUCTION_DB --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Wrangler 4.118.0 成功执行 8 条 migration commands，表清单包含：

- `_cf_METADATA`
- `d1_migrations`
- `production_designs`
- `shopify_webhook_deliveries`
- `sqlite_sequence`

其中 `_cf_METADATA`、`sqlite_sequence` 是 Wrangler/SQLite 内部表。本地 `.wrangler` 状态只用于取证，已在核对其位于当前 worktree 后删除，没有进入提交。

## 配置与安全边界

- 检入默认仍是 `LOCAL_PRODUCTION_FILES=true`；未确认 Workers Paid / Standard 和线上 `cpu_ms=30000` 前不得开启上传。
- R2 `PRODUCTION_ASSETS`、D1 `PRODUCTION_DB` 使用 Wrangler 自动 provision 形式，仓库没有 bucket 名或 database ID。
- cron 为 `0 3 * * *`，上传 rate limit 为 10 requests / 60 seconds。
- 仓库不包含 Turnstile keys、`SHOPIFY_API_SECRET` 或报价签名 secret。
- Turnstile 必须配置显式 allowed hostnames，禁止 `Any Hostname`。
- `read_orders` 必须完成适用的 protected customer data 审批/声明和商家授权，并实测 granted scopes。

## 未完成的线上验收和阻塞

- 未创建/自动 provision 线上 R2/D1，未执行远程 migration，未写入 secrets。
- 未发布本阶段 Worker/Shopify App，未使 TOML webhook 订阅在线生效。
- 未进行 Shopify 测试支付或真实支付。
- 未在 Workers Paid / Standard 上观察代表包与 32 MiB 边界包的 CPU、内存和失败率。
- 未实现 Phase 4 Shopify 订单文件卡片、App 定制订单列表或后台安全下载；当前不能声称工厂人员已经能从后台取 ZIP。
- 已付款文件的正式保留期限仍需业务确认。

## 回滚

- 使用被 `.git/info/exclude` 排除的 `wrangler.phase3-test.jsonc` 和 `shopify.app.phase3-test.toml` 锁定唯一测试目标；恢复上一 Worker/App/Functions 版本并重新启用 `LOCAL_PRODUCTION_FILES=true`。
- 禁用新 webhook 订阅。
- `LOCAL_PRODUCTION_FILES=true` 只停止新上传，不会自动停止 webhook；两项回滚必须分别执行。
- 保留 R2 对象、D1 rows、migration 记录和 delivery receipts，不删除云端数据或历史订单文件。
- Git push、文档提交或本地验证均不构成任何远端动作授权。

## 最终验证

- `npm test`：86 files / 1,534 tests passed。
- `npx vitest run workers/phase3CloudOrderLinking.integration.test.js`：单一端到端契约 1/1 passed。
- `npm run build`、`npm run build:showcase`：应用、Shopify 和 showcase 构建通过；只出现既有的大 chunk 与 `inlineDynamicImports` 警告。
- `npm --prefix shopify-app test`：scaffold 27 个必需文件、deploy 4/4、store config 12/12、transform Rust 23/23、validation Rust 13/13 全部通过。当前 Windows 默认 PATH 与 Unicode worktree 对 GNU linker 不兼容，验证使用本机已安装 Rust 1.97.1 并把临时 target 指向 ASCII 路径；验证后已删除该临时目录。
- `npx wrangler deploy --dry-run`：Wrangler 4.118.0 打包通过并识别 `DESIGN_QUOTES`、`PRODUCTION_DB`、`PRODUCTION_ASSETS`、三项 rate-limit bindings 及 `LOCAL_PRODUCTION_FILES=true`；没有部署或创建远程资源。
- 提交前 `git diff --check` 无空白错误，文件范围仅包含六份 Task 9 文档/日志，敏感值扫描无命中；README 中的安装模板占位符和禁止保留 `TARGET_*` 的说明不是凭据。本阶段没有远程 migration、secret 写入、webhook 注册、Worker/App 发布或支付。
