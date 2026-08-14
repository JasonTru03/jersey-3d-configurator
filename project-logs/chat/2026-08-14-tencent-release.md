# 2026-08-14 对话交接：腾讯云与固定 Worker 网关

用户确认继续部署无自有域名方案。本轮已完成腾讯云备份、候选镜像构建与切换、固定 workers.dev 网关发布、受密钥保护的 TCP 8080 回源及完整测试。

当前可用公网入口：`https://jersey-3d-configurator.jason1064969838.workers.dev`。

继续时先做以下检查：

1. `GET /healthz` 应为 200。
2. 腾讯云容器 `app-jersey-server-1` 应为 `healthy`。
3. 不要直接用 `/auth?shop=...` 判断 OAuth；必须从 Shopify 正式 App 安装入口触发带 HMAC 的请求。
4. 最终部署 Worker 后必须重新执行 secret bulk，否则普通 deploy 产生的新版本可能未携带预期的 `TENCENT_GATEWAY_SECRET`。
5. 不要删除 `/opt/jersey-data`；回滚优先使用 `jersey-3d-configurator-server:rollback-20260814-092107` 与发布前备份。

详细变更、备份路径、版本号与验证结果见：
`project-logs/changes/2026-08-14-tencent-worker-tcp-release.md`。

## Shopify 正式 App 推进

- 已发布并在 Dev Dashboard 核验活跃版本 `secure-jersey-configurator-pro-4`（`1089094615041`）。
- 已确认 `read_products`、两个 Functions、Theme App Extension、App Proxy、OAuth callback 和全部 Webhook 地址正确。
- 目标店铺为 `testcsj-secure-bundle.myshopify.com`；安装授权页已打开，下一步是在用户确认后点击最终“安装”，再验证 OAuth 回调、商家后台和端到端订单绑定。

### 安装后的关键结论

- 正式 App 已安装，腾讯云 App Secret 已切换为正式 App 对应值，旧环境文件已有服务器备份。
- OAuth 已完成到令牌交换；剩余失败是服务端对 Shopify 规范 scope 返回的误判，而非权限实际缺失。
- OAuth scope 修正版已部署到腾讯云，容器健康；重新进入 App 后 OAuth 成功，商家页已能读取商品并保存配置草稿。
- 当前唯一核心阻塞已从“登录/授权”收敛为 Shopify 平台资格：正式 App 是 Custom distribution，目标店是 Basic，因此不能激活该 App 的 Cart Transform 和 Validation Functions。
- 下一步需要用户确认路线：推荐先切回 Development App 完成这家开发店的购物车、结账和订单绑定回归；多店铺正式商用则另建 Public distribution App 并进入 Shopify 审核流程。

## Development App 回归最新状态

- 已按用户确认切回 Development App，并发布版本 `csj-development-20260814-workers`（`1089113194497`）；错误正式 App 已从开发店卸载。
- 商家配置、两个 Functions、商品 3D 启动入口均已恢复，腾讯云容器保持 `healthy`。
- 已修复 Cloudflare Worker 到腾讯云的 3.5 MB 生产 ZIP TCP 大包发送：64 KiB 分块写入，最终 Worker 版本为 `0369edd7-a999-48a4-adb5-73936cf0b0c2`。
- 真实上传与签名链路全部返回成功，最新设计 `dsg_6801592c-683b-47f1-b707-957c6542bdd5` 已为 `cart_draft`；服务器端不再存在上传阻塞。
- 当前浏览器停在已签发的 Shopify App Proxy handoff URL，但 Chrome 本地扩展返回 `ERR_BLOCKED_BY_CLIENT`。需要在 Chrome 中暂停对应广告拦截/隐私扩展，或将 `testcsj-secure-bundle.myshopify.com` 加入白名单，然后刷新当前页；随后应进入购物车。不要重新生成设计，当前 token 尚未到达 Shopify。

## 购物车交接最终状态

- 用户刷新后页面从 `expired` 变为 `invalid`；检查腾讯云运行容器发现仍为旧版 `appProxy.js`，说明此前发布动作没有真正切换源码。
- 已重新上传并按 SHA-256 校验多店铺签名修复，构建候选镜像并强制重建 `jersey-server`；最终确认容器 `SOURCE_NEW`、`healthy`，公网健康检查正常。
- 同一 handoff 页面刷新后已成功跳转 Shopify `/cart`，购物车中出现 1 件 `$89.00 USD` 的定制球衣，生产包和设计文件元数据完整显示。
- 当前端到端范围已完成到“定制设计 → 生产文件上传 → 安全 App Proxy 交接 → Shopify 购物车”。尚未代用户进入结账或创建新订单。

## 测试订单最终验证

- 用户明确授权由 AI 直接执行测试结账；已使用 Shopify `Test Payment Gateway` 的批准交易模式完成测试，不涉及真实扣款。
- 新订单 `#1003` 创建成功，确认号 `FHATKL84G`，金额 `$89.00 USD`。
- `orders/paid` Webhook 已到达腾讯云，设计记录已从购物车草稿推进为 `paid_pending_production`，并正确写入 Shopify 订单号。
- 生产 ZIP 的存在性、大小、ZIP 文件头和 SHA-256 均通过真实服务器校验；订单和 3D 生产文件绑定目标已完成。
- Shopify Admin 中也已确认 `#1003` 显示为已付款、未发货，金额和商品数量正确。
- 后续如继续推进，重点将从核心链路修复转为后台下载操作验收、订单取消/退款状态回归，以及 Public distribution App 的审核准备。

## 1.0.0 项目收尾

- 用户确认将本轮稳定链路作为 `1.0.0`，并同意按建议完善 Shopify 应用打开页。
- 已把临时授权成功页替换为正式商家控制台入口；从 Shopify Admin 的应用菜单真实打开验证通过。
- 新首页集中展示店铺连接、结账功能、生产流程、商品映射、定制订单和在线商店入口。
- 腾讯云服务、固定 workers.dev HTTPS 入口和 Shopify Development App 版本均已完成发布；不需要自有域名。
- 版本 `1.0.0` 的 Shopify App 版本 ID 为 `1089238073345`，完整发布记录见 `project-logs/releases/2026-08-14-v1.0.0.md`。
