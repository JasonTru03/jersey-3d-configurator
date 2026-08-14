# 2026-08-13 Shopify 开发 App 端到端验证

## 目标

在 `csj` 组织内使用开发 App，将 Basic 开发店
`testcsj-secure-bundle.myshopify.com` 的 3D 定制、Shopify 购物车、测试结账、
付款 Webhook 与腾讯云生产文件后台跑通。

## App 与部署结果

- 开发 App：`Secure Jersey Configurator Dev`
- App ID：`410075201537`
- 发布版本：`csj-development-20260813`
- 版本 ID：`1086912659457`
- 已安装到：`testcsj-secure-bundle.myshopify.com`
- App Proxy：`/apps/jersey-configurator`
- 已激活 Shopify Functions：
  - Cart Transform：`gid://shopify/CartTransform/84410455`
  - Cart/Checkout Validation：`gid://shopify/Validation/90210391`
- Cloudflare Worker 的 App secret 已切换到开发 App。
- 腾讯云 `/opt/jersey/app/.env.server` 已备份后切换，并使用
  `compose.server.yaml` 强制重建 `jersey-server`。
- 容器状态：`healthy`
- 本地健康接口：通过
- 腾讯云 HTTPS 健康接口：HTTP 200
- Cloudflare Tunnel 健康接口：HTTP 200

本文不记录任何 App secret、Admin token、后台密码或 Webhook 签名。

## 真实链路验证

1. 从 Shopify 商品页进入腾讯云 3D 配置器。
2. 使用默认 S 码设计生成新的安全购物车交接请求。
3. App Proxy 验证成功并跳回 Shopify 购物车。
4. 购物车显示 1 件 `Custom 3D Football Jersey`，金额 `$89.00`，并包含：
   - 生产 ZIP 文件名
   - `design.json`
   - `uv-atlas.png`
   - UV Atlas SHA-256
5. 为开发店启用 `Test Payment Gateway`，不产生真实扣款。
6. 使用批准型测试交易完成结账。
7. Shopify 生成测试订单 `#1002`，金额 `$89.00`，状态为已付款、未发货。
8. 腾讯云生产数据库收到并绑定订单：
   - 订单：`#1002`
   - 状态：`paid_pending_production`
   - 设计编号：`dsg_3af65683-0aa7-4dbe-b917-0243191e0582`
   - 生产包：`fn8788-jersey-design-b8e86bab.zip`
   - 生产包索引：存在

## 自动测试

- store config：13/13 通过
- deploy tests：4/4 通过
- Shopify Functions Rust tests：23/23 与 13/13 通过
- App Proxy、路由、购物车交接与生产后台相关 Vitest：91/91 通过
- 前端构建：通过

## 结论

开发店端到端链路已跑通：

`3D 定制 → 安全交接 → Shopify 购物车 → 测试付款 → orders/paid Webhook → 订单绑定生产 ZIP`

正式多店铺上线仍需走 Shopify 公共分发/App Store 审核；Basic 店铺不能使用包含
Functions 的 Custom distribution App。
