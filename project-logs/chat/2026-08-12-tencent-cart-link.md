# 2026-08-12 腾讯云生产草稿与 Shopify 加购联调

## 当前目标

让 `testcsj-secure-bundle.myshopify.com` 的 3D 定制流程在付款前把生产 ZIP 保存到腾讯云，再通过 Shopify App Proxy 安全加入购物车，最终由 `orders/paid` webhook 绑定订单。

## 已确认事实

- 商品页当前启动地址仍是 `jersey-3d-configurator.jason1064969838.workers.dev`，该展示站不把生产包写入腾讯云；这是历史订单 `#1001` 缺少生产草稿的根因。
- 使用同一组真实商品与 variant 参数直接打开 `https://139.199.202.173/` 后，腾讯云成功生成新设计 `dsg_9a61a3c5-110a-4cba-b680-a64db449cef4`、manifest 和生产 ZIP。
- SQLite 中该设计状态为 `cart_draft`，`design_quotes` 中存在对应报价记录且未过期。
- Chrome 请求 Shopify handoff 后被本机客户端拦截；把同一地址交给已登录的 Comet 后返回 `Secure cart handoff expired.`。
- 腾讯云 `server_rate_limits` 只有本次 `production_upload` 和 `cart_quote`，没有 `cart_handoff`，证明 Shopify 当前没有把 handoff 请求代理到腾讯云。
- Dev Dashboard 活跃版本 `phase3-test-20260810` 显示 App Proxy 目标为 `https://139.199.202.173/apps/jersey-configurator`，但该 App 在 7 月 27 日已安装，早于 8 月 10 日的代理目标更新。
- Shopify Admin 的店铺级代理路径仍为 `/apps/jersey-configurator`；当前发布主题是 `Horizon`，theme ID `141064339543`，已有草稿备份 `Horizon 的副本`，theme ID `141069877335`。

## 当前判断

已有安装仍保留旧 App Proxy 目标，属于 Shopify 已有安装代理配置未刷新，而不是腾讯云草稿、报价、签名或 ZIP 生成失败。

## 推荐修复

1. 备份私有 `shopify.app.phase3-test.toml` 并记录当前活跃版本。
2. 发布一个临时版本，移除 `[app_proxy]`，清除旧代理值。
3. 立即恢复 `[app_proxy]` 指向腾讯云并发布第二个版本。
4. 用现有未过期草稿重新生成报价，验证腾讯云出现 `cart_handoff` 记录并成功进入购物车。
5. 代理修复后，再经主题发布确认把商品页启动 URL 从旧 Worker 改为腾讯云入口。

## 风险与回滚

- 两次发布之间 App Proxy 会短暂不可用；当前仅为开发测试 App。
- 不卸载 App，避免丢失 Functions 或店铺级 App 配置。
- 任一步失败时重新激活 `phase3-test-20260810`，服务器数据和现有草稿保持不变。
- 不进入结账，不创建新订单，直到付款前链路完整通过。
