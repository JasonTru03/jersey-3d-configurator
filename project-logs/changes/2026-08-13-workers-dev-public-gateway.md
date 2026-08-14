# 2026-08-13 固定 workers.dev 公开入口

## 本次目标

在不购买自有域名的前提下，为 Shopify 公开多店 App 准备固定 HTTPS 入口，同时继续由腾讯云统一处理 OAuth、店铺配置、购物车、订单和生产文件。

## 关键决定

- 固定公开入口使用 `https://jersey-3d-configurator.jason1064969838.workers.dev`。
- Cloudflare Worker 收敛为无状态 HTTPS 反向代理，回源 `https://139.199.202.173`。
- 移除根 Wrangler 配置中的临时 Quick Tunnel、R2、D1、KV、Cron 和店铺静态映射，避免 Cloudflare 与腾讯云各保存一套业务状态。
- Shopify 公共 App 模板的 App URL、OAuth callback 和 App Proxy 统一使用固定 `workers.dev` 地址。
- 自有品牌域名仍是商业正式上线的可靠性升级项，但不阻塞候选版本和开发店回归。

## 新增与变更

### Worker 网关

- `workers/tencentTunnelGateway.js`
  - 接受任意合法的纯 HTTPS 回源，而不再限定 `trycloudflare.com`。
  - 流式转发请求 body，保留方法、路径与查询参数。
  - 设置公开的 forwarded host/protocol，并将腾讯云同源重定向改写回公开 Worker 域名。
  - 非法回源返回 503，连接失败返回不泄露细节的 502。
- `workers/tencentTunnelGateway.test.js`
  - 覆盖流式转发、非法回源、连接失败、同源重定向和 Shopify 外部重定向。

### 发布配置

- `wrangler.jsonc`
  - 入口改为 `workers/tencentTunnelGateway.js`。
  - `workers_dev` 显式启用。
  - 仅保留非敏感 `TENCENT_ORIGIN`，无云端业务存储绑定。
- `shopify-app/shopify.app.toml`
  - App URL、OAuth callback 和 App Proxy 改为固定 Worker 地址。
- `shopify-app/scripts/verify-scaffold.mjs`
  - 同步校验固定公开入口。
- `.env.server.example`
  - `PUBLIC_ORIGIN` 示例改为固定 Worker 地址。

### 文档

- 更新公开发布计划、业务信息清单、提交清单和腾讯云部署说明。
- 增加“腾讯候选镜像先上线，Worker 后切流”的发布顺序与回滚原则。

## 验证结果

- 根项目：113 个测试文件、1564 项测试全部通过。
- 根项目前端与 Shopify 构建：通过；仅保留既有大 chunk 提示。
- Shopify 脚手架与部署防护：17/17 通过。
- Shopify Functions：Cart Transform 23/23、Validation 13/13 通过。
- Wrangler 4.122.0 dry-run：通过，只识别 `TENCENT_ORIGIN` 一个非敏感绑定。
- `git diff --check`：通过；只有 Windows CRLF 提示。
- 腾讯云 `https://139.199.202.173/healthz`：HTTP 200。
- 当前线上 Worker `/healthz`：HTTP 404，证明新网关尚未发布，未对线上流量产生影响。

## 发布与回滚检查点

- 当前 Worker 部署版本为 `3a07f922-c2f7-4d5b-a5a5-d23d9557c628`（secret change）。
- 上一个明确代码版本为 `8903f6c3-3d16-4975-b719-35643f5808cf`。
- 真正切流前必须先备份并部署腾讯云候选镜像，再发布 Worker；失败时优先回滚 Worker，然后恢复腾讯云上一镜像和 `.env.server`，不得删除 `/opt/jersey-data`。

## 遗留事项

- 尚未部署腾讯云候选镜像或 Cloudflare Worker。
- 尚未创建公开 App 候选版本，也未选择 Public distribution。
- 隐私政策、服务条款和支持页仍需开发者公开名称、支持邮箱、定价和保留期等业务信息。
- Cloudflare 官方建议业务关键生产环境使用自定义域名；`workers.dev` 可用于当前无域名候选路线，但正式商业接单前仍建议评估自有域名。
