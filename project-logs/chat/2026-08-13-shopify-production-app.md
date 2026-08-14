# 2026-08-13 Shopify 正式 App 创建与套餐限制

## 目标

在 `csj` 组织创建新的正式 Shopify App，安装到
`testcsj-secure-bundle.myshopify.com`，并启用两个 Shopify Functions、App
Proxy 与订单 Webhook。

## 已完成

- 卸载了目标店中身份不匹配的旧 `Secure Jersey Configurator`。
- 在 `csj` 组织创建 `Secure Jersey Configurator Pro`，App 记录 ID
  `410066124801`。
- 只申报“受保护客户数据 → 商店管理”，未申请姓名、邮箱、电话或地址字段。
- 发布版本 `csj-production-20260813`，版本 ID `1086887854081`，包含：
  - `secure-jersey-transform`
  - `secure-jersey-validation`
  - App Proxy `/apps/jersey-configurator`
  - `orders/paid`、`orders/cancelled`、`refunds/create` Webhook
- 选择 Custom distribution，并安装到
  `testcsj-secure-bundle.myshopify.com`。
- 新 App 的 client-credentials 授权成功，实际 granted scopes 包含
  `read_orders`、`write_app_proxy`、`write_cart_transforms`、
  `write_validations`。

## 阻塞结论

创建 Cart Transform 注册时，Shopify 返回：Custom App 只有 Shopify Plus
商店才能激活 Functions。目标开发店是 Basic，因此 Custom distribution
路线无法在该店启用本项目需要的 Cart Transform/Validation。

Shopify 官方规则：任意套餐商店可使用包含 Functions 的公开 App；只有 Plus
商店可使用包含 Functions 的自定义 App。

## 安全状态

- Functions 注册未创建，Shopify 后台显示 0 个活动 Functions。
- 未更新腾讯服务器 `SHOPIFY_API_SECRET`。
- 未更新 Cloudflare Worker `SHOPIFY_API_SECRET`。
- 未重启腾讯服务器容器。
- 旧 App secret 仍保留在本地忽略文件中作为回滚材料，本文不记录任何 secret。

## 待决策

1. 测试优先：在 `csj` 组织再创建一个不选择分发方式的开发 App，安装到 Basic
   开发店，先完成真实端到端测试。
2. 正式多店：创建公开分发 App，完成 App Store（可限制可见性）产品页面、隐私与
   数据保护材料并提交审核；审核通过后可在 Basic 商店启用 Functions。
3. 升级到 Shopify Plus 后继续使用当前 Custom distribution App，不建议仅为测试
   采用此方案。

## 后续决定：无自有域名路线

- 不购买域名也继续推进，固定公开入口使用
  `jersey-3d-configurator.jason1064969838.workers.dev`。
- Cloudflare Worker 只负责 HTTPS 反向代理，腾讯云继续作为唯一业务运行时和存储位置。
- 不再使用临时 `trycloudflare.com` Quick Tunnel，也不在根 Worker 中另建 R2/D1 业务状态。
- 公共 App 模板已统一固定 App URL、OAuth callback 和 App Proxy；本地测试、构建和 Wrangler dry-run 已通过。
- 线上 Worker 尚未切换；当前 `/healthz` 为 404，腾讯云 `/healthz` 为 200。
