# Phase 3 生产文件云存储上线指南

## 当前状态与授权边界

Phase 3 Task 1-8 的本地代码、自动测试、构建和本地 D1 migration 已完成；Task 9 单一端到端契约测试由 `d38d500` 补齐。但尚未完成任何线上资源创建、远程 migration、secret 写入、Shopify App 发布、webhook 注册或测试支付。本指南是上线操作清单，不是线上验收记录。

推送 Git 分支或提交代码不代表授权以下外部动作：创建或自动 provision R2/D1、执行远程 migration、写入 Cloudflare secret、注册 Shopify webhook、发布 Shopify App、部署生产 Worker、修改商店数据或发起支付。每类动作都必须获得用户单独明确批准。

## 上线前硬门禁

- 只能先在非 live 的 Shopify app-development store 验证，不能用真实顾客订单或真实支付。
- Cloudflare 账号必须确认使用 Workers Paid / Standard Usage Model，并确认 `wrangler.jsonc` 中 `limits.cpu_ms = 30000` 在线上生效。未确认套餐或 CPU 上限时，必须保持 `LOCAL_PRODUCTION_FILES=true`，不得启用生产包上传。
- 记录当前 Worker 版本、Shopify App 版本、Functions 版本、webhook 订阅状态和已脱敏配置摘要，作为回滚点。
- `read_orders` 属受保护客户数据范围。Partner/public app 应完成适用的 Shopify Dashboard protected customer data 流程并重新安装授权；商家组织内 Dev Dashboard custom app 也必须完成适用声明和商家授权。两种路径最终都要实测 granted scopes 包含 `read_orders`，不能仅以 TOML 声明为准。
- 明确一个可安装 App 和 Shopify Functions 的测试店，并确认该店不承载 live 销售。
- 明确已付款生产文件的保留期限；在确定前不得实施破坏性清理。

## 精确激活顺序

必须按以下顺序操作。任一门禁失败都停止，不得跳到后续步骤。

### 1. 锁定测试环境和回滚点

1. 确认目标是非 live app-development store。
2. 确认 Workers Paid / Standard Usage Model 和 30 秒 CPU ceiling。
3. 在仓库根复制 `wrangler.jsonc` 为本地私有 `wrangler.phase3-test.jsonc`，把 `name` 改为经批准且唯一的测试 Worker 名称，并保持 `LOCAL_PRODUCTION_FILES=true`。删除复制文件中 `DESIGN_QUOTES` 的现有 `id`，让 Wrangler 为测试 Worker 自动 provision 独立 KV。把三项 rate-limit binding 的 `namespace_id` 全部改为已记录的测试专用数字字符串，且每项都与默认配置和彼此不同，避免与默认 Worker 共享计数。在 `shopify-app` 下复制 `shopify.app.toml` 为 `shopify.app.phase3-test.toml`。
4. 使用 `git rev-parse --git-path info/exclude` 定位当前 worktree 的 exclude 文件，把 `/wrangler.phase3-test.jsonc` 和 `/shopify-app/shopify.app.phase3-test.toml` 加入该文件。确认 `git status` 不显示这两个私有配置；不得提交它们。
5. 先确定测试 Worker 的完整 HTTPS URL，再把 Shopify 私有配置中的 `client_id`、`application_url`、`auth.redirect_urls` 和 `[app_proxy].url` 全部解析为该测试 App/Worker 的真实测试值；不得保留 `TARGET_*` 或其他占位值，不得指向当前生产 Worker。
6. 在上线记录中写下这两个私有配置的绝对路径、唯一 Worker 名、完整 URL、测试店域名、当前 Worker/App/Functions 版本、granted scopes 和 webhook 状态。
7. 套餐、CPU、权限、目标身份或回滚点有一项不明确时，上传继续禁用并停止。

### 2. dry-run 后自动 provision 独立 KV、私有 R2 与 D1

检查入库配置应只包含：

```json
{
  "kv_namespaces": [{ "binding": "DESIGN_QUOTES" }],
  "r2_buckets": [{ "binding": "PRODUCTION_ASSETS" }],
  "d1_databases": [{
    "binding": "PRODUCTION_DB",
    "migrations_dir": "migrations"
  }]
}
```

不要修改入库默认配置，也不要在仓库中补 KV/R2/D1 资源身份或 secret。先执行：

```powershell
npm test
npm run build
npm run build:showcase
npx wrangler deploy --dry-run --config wrangler.phase3-test.jsonc
```

确认 dry-run 显示唯一测试 Worker 和预期 bindings 后，另行获得 bootstrap 部署/资源创建授权，再执行：

```powershell
npx wrangler deploy --config wrangler.phase3-test.jsonc
```

这是唯一允许的资源 provision 路径。bootstrap 必须保持 `LOCAL_PRODUCTION_FILES=true`，只用于让 Wrangler 为独立测试 Worker 自动 provision 独立 KV、私有 R2 和 D1；不要在同一次操作中开启上传。部署后立即回读 `wrangler.phase3-test.jsonc` 和 Wrangler 输出，记录自动写入的精确 KV/R2/D1 身份与名称，并再次确认三项都不属于默认/生产 Worker；同时复核三项 rate-limit namespace IDs 都是测试专用值。未能获得或核对任一资源身份时，不得执行远程 migration。

### 3. 先本地、后远程执行 migration

先在当前提交运行：

```powershell
npx wrangler d1 migrations apply PRODUCTION_DB --local --config wrangler.phase3-test.jsonc
npx wrangler d1 execute PRODUCTION_DB --local --config wrangler.phase3-test.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

确认存在 `production_designs`、`shopify_webhook_deliveries` 和 `d1_migrations`。只有获得远程 migration 的明确批准，并把步骤 2 回读的测试 D1 精确身份与 `wrangler.phase3-test.jsonc` 再次核对一致后，才可把同一命令的 `--local` 改为 `--remote`。所有 D1 命令都必须显式使用 `--config wrangler.phase3-test.jsonc`；不得改用默认配置。资源身份只保存在私有上线记录，不进入 Git 文档。

### 4. 配置 Turnstile、Shopify 权限和 secrets

1. Turnstile 必须使用显式 allowed hostnames，不得选择 `Any Hostname`。清单应逐项列出实际测试 Worker/App 公网 hostname 和测试 storefront hostname；不要加入通配域名或尚未使用的生产域名。
2. 完成适用的 `read_orders` 受保护数据审批/声明和商家授权，重新安装或更新 App 授权后实测 granted scopes。
3. 使用交互式 `wrangler secret put` 写入，不打印值：

   ```powershell
   npx wrangler secret put TURNSTILE_SITE_KEY --config wrangler.phase3-test.jsonc
   npx wrangler secret put TURNSTILE_SECRET_KEY --config wrangler.phase3-test.jsonc
   npx wrangler secret put SHOPIFY_API_SECRET --config wrangler.phase3-test.jsonc
   npx wrangler secret put CART_QUOTE_SIGNING_SECRET --config wrangler.phase3-test.jsonc
   ```

4. Cloudflare 当前行为是每次 `wrangler secret put` 都会创建并立即部署一个新 Worker version；它不是纯配置动作。四次命令都必须包含在明确的外部部署批准范围内，执行时继续保持 `LOCAL_PRODUCTION_FILES=true` 且尚未注册 Shopify webhook，并逐次记录产生的测试 Worker version。
5. `CART_QUOTE_SIGNING_SECRET` 的字节必须与两项 Shopify Functions app-owned metafield 一致。任何 secret 都不得进入 Git、截图、命令行参数或日志。

### 5. 构建并 dry-run

```powershell
npm test
npm run build
npm run build:showcase
npm --prefix shopify-app test
npx wrangler deploy --dry-run --config wrangler.phase3-test.jsonc
npm --prefix shopify-app run deploy:check -- phase3-test
```

必须确认应用、Shopify 构建和 Rust Functions 通过，Wrangler 能识别 D1、R2、三项 rate-limit bindings、cron 与 30 秒 CPU ceiling，输出中没有 secret 值。dry-run 不会证明线上套餐、CPU、内存或权限已经正确。

### 6. 发布启用上传的测试版本并注册 webhook

1. 另行获得启用上传的测试 Worker 部署和 Shopify App 发布授权。此处不是首次 Worker 部署：步骤 2 的 bootstrap 和步骤 4 的每次 `secret put` 已产生测试 Worker versions。
2. 只在前述门禁通过后，在私有 `wrangler.phase3-test.jsonc` 把 `LOCAL_PRODUCTION_FILES` 改为 `false`；若无法确认 Workers Paid / Standard 或 CPU ceiling，保持 `true` 并停止。
3. 用 `npx wrangler deploy --config wrangler.phase3-test.jsonc` 部署测试 Worker，核对命令目标仍是步骤 1 锁定的唯一测试 Worker，并记录新旧版本。
4. 执行 `npm --prefix shopify-app run deploy:check -- phase3-test`，确认私有 Shopify 配置的 `application_url` 与该测试 Worker 完全一致后，经单独授权执行 `npm --prefix shopify-app run deploy -- phase3-test`。该 App deploy 才会使相对 URI `/webhooks/shopify/orders` 的订阅配置生效；发布后读取实际订阅，确认 `orders/paid`、`orders/cancelled`、`refunds/create` 指向测试 App URL。
5. 在 Shopify 测试模式完成测试支付，不使用真实付款方式。

### 7. 验证订单关联、文件和运行资源

测试支付后逐项确认：

- D1 状态实际经过 `upload_pending -> cart_draft -> paid_pending_production`；缺失或损坏文件进入 `file_error`。
- 同一个 `designId` 出现在上传响应、KV 报价记录、App Proxy 私有 line property 和最终 D1 已付款记录中。
- 七文件和重建 ZIP 直接流式写入私有 R2；应用响应、日志和 Shopify line properties 均不暴露原始 R2 key。
- manifest 与 ZIP 的 R2 `sha256` metadata、ZIP native checksum、content type 和 content length 一致。
- 分别用代表性真实生产包和 32 MiB 边界包观察 Worker CPU time、wall time、内存和失败率。两档都必须在已确认的线上套餐与 30 秒 CPU ceiling 内完成；本地测试和 dry-run 不能替代该证据。
- 记录测试订单号、脱敏 design 指纹、Worker/App 版本和结果，不记录顾客信息、secret 或原始对象路径。

阶段 4 尚未实现 Shopify 订单文件卡片、App 定制订单列表和后台安全下载。因此 Phase 3 即使订单关联成功，也不能声称工作人员已经能在后台下载 ZIP；当前只能通过受控的 D1/R2 运维检查验证文件存在。

### 8. 保留数据回滚

如任一测试失败：

1. 在私有配置中重新设置 `LOCAL_PRODUCTION_FILES=true` 并用 `--config wrangler.phase3-test.jsonc` 部署，或使用同一显式配置恢复步骤 1 记录的上一测试 Worker 版本，停止新的云端上传。
2. 单独禁用新 webhook 订阅或使用 `phase3-test` Shopify 配置恢复上一 App 版本，并确认测试店不再投递到新 handler。`LOCAL_PRODUCTION_FILES=true` 只禁用上传，不会自动停止订单 webhook。
3. 恢复上一 Functions/App 配置和已记录的 Worker/App 版本。
4. 保留 R2 对象、D1 rows、migration 表和 webhook delivery receipts；不得删除 bucket、database、订单文件或历史索引。
5. 对失败订单保留 `file_error`/终态证据，修复后使用新的测试订单复验。不要把 schema 回滚实现成 `DROP TABLE` 或批量删除。
6. 复核 webhook 已停止、上传已禁用、旧版服务恢复，再记录回滚结果。

## 当前本地证据（2026-08-04）

- Task 7：`4679c8b feat: link shopify order lifecycle to production drafts`。
- Task 8：`a8a575f feat: clean expired production drafts`。
- 本地 migration：Wrangler 4.118.0 成功应用 `0001_production_designs.sql`；schema 查询返回 `d1_migrations`、`production_designs`、`shopify_webhook_deliveries`，另含 Wrangler/SQLite 内部表。
- Task 8 完整测试：85 files / 1,533 tests passed；应用、Shopify、showcase build、Shopify scaffold 和 Wrangler dry-run 通过。
- 单一端到端契约测试：`d38d500 test: cover phase 3 cloud order contract`；focused 1/1、相邻 227 tests、完整 86 files / 1,534 tests passed。

以上均为本地证据，不代表线上资源、权限、订阅、测试支付、32 MiB CPU/内存门禁或后台下载已经验收。
