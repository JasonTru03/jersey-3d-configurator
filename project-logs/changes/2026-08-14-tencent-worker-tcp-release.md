# 2026-08-14 腾讯云候选版与 Workers TCP 网关发布

## 结果

- 腾讯云正式容器已切换到候选镜像并保持 `healthy`。
- 固定公网入口继续使用 `https://jersey-3d-configurator.jason1064969838.workers.dev`。
- Cloudflare Worker 通过 `cloudflare:sockets` 直连腾讯云公网 IP 的 TCP 8080 端口，避免 Workers `fetch()` 访问裸 IP 的 1003 限制。
- 腾讯云 8080 入口由 Nginx 转发到 `127.0.0.1:8080`，并使用独立随机密钥拒绝绕过 Worker 的请求。
- 公网 `/healthz` 与 `/` 均返回 HTTP 200；直接访问 `139.199.202.173:8080` 返回 HTTP 403。

## 腾讯云发布与回滚点

- 发布前备份：`/opt/jersey/backups/20260814-092107-pre-workers-dev`
- 备份已通过 SHA-256、应用归档和数据归档读取检查。
- 旧镜像回滚标签：`jersey-3d-configurator-server:rollback-20260814-092107`
- 候选发布目录：`/opt/jersey/releases/20260814-0945-candidate`
- 候选镜像：`jersey-3d-configurator-server:candidate-20260814`
- 正式镜像标签：`jersey-3d-configurator-server:local`
- `.env.server` 新增正式 App client ID、独立 token 加密密钥，并将 `PUBLIC_ORIGIN` 固定为 workers.dev。
- 修复旧 `ADMIN_PASSWORD_HASH` 的 CRLF/引号兼容问题；Compose 文件中继续保留单引号，容器内接收无引号的合法 scrypt 哈希。
- Nginx 原配置备份：`/opt/jersey/backups/20260814-092107-pre-workers-dev/nginx-default-before-gateway`
- 新 Nginx 配置：`/etc/nginx/conf.d/jersey-worker-origin.conf`
- Lighthouse 防火墙新增 TCP 8080 规则，应用层仍由随机密钥保护。

## Cloudflare 发布

- 最终代码版本：`6be4a466-215d-4c5e-b496-9054cf00d8b2`
- 最终部署后使用 `wrangler secret bulk` 写入 `TENCENT_GATEWAY_SECRET`；临时本地密钥文件随后删除。
- Worker 对固定 `http://139.199.202.173:8080` 使用原始 TCP、HTTP/1.0 和 `Connection: close`，保留请求方法、路径、查询、正文与响应状态/响应头。
- Worker 只向上游发送内部密钥；Nginx 不再把该密钥继续转发给 Node 应用。
- 临时密钥指纹诊断端点和详细 502 回显已经删除。

## 验证

- 网关定向测试：9/9 通过。
- 相关定向测试：50/50 通过。
- 全量测试：113 个测试文件、1565 项测试全部通过。
- 前端与 Shopify 构建：通过。
- Wrangler 4.122.0 dry-run：通过。
- 腾讯云本机 `/healthz`：HTTP 200，Compose 容器状态 `healthy`。
- workers.dev `/healthz`：HTTP 200，响应 `{"ok":true}`。
- workers.dev `/`：HTTP 200。
- 腾讯云公网 8080 无密钥直连：HTTP 403。

## 已知风险与下一步

- 依赖安装仍报告 2 个高危审计项；本次未擅自升级依赖，需单独评估兼容性后处理。
- 构建仍有既有大 chunk 警告。
- `/auth` 必须由 Shopify 携带合法 `timestamp` 与 `hmac` 调用；手工只传 `shop` 返回 400 属于预期安全行为。
- 下一步是在 Shopify 后台确认正式 App URL、OAuth callback 和 App Proxy 均指向固定 workers.dev，再从正确 App 安装流程完成 OAuth、App Proxy、购物车、测试结账与订单绑定端到端回归。

## Shopify 正式 App 修正版

- 正式 App `Secure Jersey Configurator Pro` 已发布活跃版本 `secure-jersey-configurator-pro-4`，版本 ID `1089094615041`。
- App URL、OAuth callback 与 App Proxy 已统一指向固定 workers.dev 入口。
- 权限范围新增 `read_products`，用于商家端商品与变体配置。
- 订单、卸载/权限变更以及隐私合规 Webhook 均改为完整 workers.dev URL，避免相对路径被错误拼接到 `/auth/webhooks/...`。
- 新版本包含两个 Shopify Functions 和 `secure-jersey-launcher` Theme App Extension。
- Theme App Extension 新增最小默认语言文件 `locales/en.default.json`，修复 Shopify CLI 构建失败。
- Shopify CLI 构建与发布均已通过；安装流程已到达目标开发店的最终“安装”确认页，等待用户确认授权安装。

## 正式 App 安装与 OAuth 修复

- `Secure Jersey Configurator Pro` 已安装到 `testcsj-secure-bundle.myshopify.com`。
- 首次 OAuth 失败根因是腾讯云使用的 App Secret 与正式 App 不一致；已备份旧环境文件并以隐藏输入方式切换到正确 Secret，未记录密钥原文。
- 密钥切换备份：`/opt/jersey/backups/20260814-103425-pre-shopify-secret.env.server`。
- 容器已强制重建并恢复 `healthy`，本机 `/healthz` 返回 `200`。
- 第二次 OAuth 已完成令牌交换，但服务端把 Shopify 省略的冗余 `read_cart_transforms`、`read_validations` 误判为缺少权限。
- Shopify 实际授予 `read_orders`、`read_products`、`write_app_proxy`、`write_cart_transforms`、`write_validations`；两个写权限已包含对应读取能力。
- 已修正 `REQUIRED_SHOPIFY_SCOPES` 的规范化判断，发布配置仍保留完整请求范围。
- OAuth/生命周期定向测试 13/13 通过，全量 113 个测试文件、1565 项测试通过，前端与 Shopify 构建通过。
- OAuth scope 修正版已通过 OrcaTerm 发布到腾讯云；服务器源码 SHA-256 与本地一致，候选镜像已切换为正式 `local` 标签，容器健康检查通过。
- 发布前源码备份：`/opt/jersey/backups/20260814-104515-pre-oauth-scope-fix`；回滚镜像：`jersey-3d-configurator-server:rollback-pre-oauth-fix-20260814-104515`。
- 重新进入 App 后 OAuth 已成功，商家配置页可正常读取目标店铺商品与变体，证明正式 App 安装、授权、令牌保存及 `read_products` 链路均已打通。

## Shopify Functions 激活阻塞

- 已保存 `Custom 3D Football Jersey` 的 S/M/L/XL 变体及 33 个附加费映射，但“保存并启用结账功能”返回结账功能启用失败。
- Shopify Admin GraphQL 可查询到 `secure-jersey-transform` 与 `secure-jersey-validation` 两个已发布 Function，但店铺中的 Cart Transform 与 Validation 注册记录均为 0。
- 根因是正式 App 已选择 **Custom distribution（商店专属应用）**，而目标开发店当前为 Basic。Shopify 官方规则只允许 Shopify Plus 店铺激活自定义分发 App 中的 Functions；Basic 店铺若要使用 Functions，App 必须采用 Public distribution。
- 该限制属于 Shopify 平台资格校验，重复部署、重装或重试启用无法绕过。
- 推荐推进方式：先用现有 Development App 在开发店完成端到端回归；面向多个 Basic 店铺的正式版本另建 Public distribution App，并按 Shopify App Store 审核流程发布。

## Development App 回归与 TCP 大包修复

- 已卸载目标店中的错误正式 App，保留并重新授权 Development App；Development App 活跃版本为 `csj-development-20260814-workers`（版本 ID `1089113194497`）。
- Development App 的 App URL、OAuth callback、App Proxy、Webhook 和 Functions 均统一到固定 workers.dev 入口；腾讯云已切换到对应 client ID/secret，环境备份为 `/opt/jersey/backups/20260814-105738-pre-development-app-switch.env.server`。
- 商家页已成功保存商品、变体及附加费映射，并显示“配置成功，结账功能已启用”；两个 Shopify Functions 保持激活。
- Shopify 商品说明中的旧裸 IP 启动链接已改为 workers.dev，店铺可以正常进入 3D 配置器。
- 生产 ZIP 上传失败的根因是 Worker 把约 3.5 MB 的 ZIP 作为单次 TCP 写入发送，腾讯云 Node HTTP 解析器在应用处理前返回空响应 `400`；约 3 KB 的 manifest 不受影响。
- Worker 现在以 64 KiB 为上限逐块、顺序等待写入 TCP，不主动半关闭写端；这同时避免 GET `/api/production-drafts/config` 被 Nginx 记为 `499`。
- 最终 Worker 版本：`0369edd7-a999-48a4-adb5-73936cf0b0c2`；部署后已确认四个生产 Secret 仍存在。
- 腾讯云安全诊断版本备份：`/opt/jersey/backups/20260814-120000-pre-upload-length-diagnostics`；回滚镜像：`jersey-3d-configurator-server:rollback-pre-upload-diagnostics-20260814-120000`；当前容器保持 `healthy`。
- 全量测试：113 个测试文件、1566 项测试通过；前端与 Shopify 构建、Wrangler 4.123.0 dry-run 均通过。
- 真实链路验证成功：`POST /api/production-drafts` 201、manifest 204、3,568,298 字节 bundle 201、`POST /api/cart-quotes` 201；数据库记录 `dsg_6801592c-683b-47f1-b707-957c6542bdd5` 已进入 `cart_draft`。
- 配置器已成功生成 Shopify App Proxy handoff URL；本机 Chrome 隐私/拦截扩展在真正访问 Shopify 前返回 `ERR_BLOCKED_BY_CLIENT`，服务器与 Shopify 未返回该错误。浏览器需对 `testcsj-secure-bundle.myshopify.com` 放行后刷新当前 handoff 页面。

## 多店铺购物车交接签名修复

- `workers/shopify/appProxy.js` 已改为按请求中的店铺解析签名密钥：旧版配置继续使用全局密钥，数据库型多店铺配置使用该店铺独立的加密签名密钥。
- 数据库店铺密钥解密失败时保持失败关闭，返回安全的通用错误，不回显 token、密钥或内部校验细节。
- 新增数据库店铺独立密钥验证及解密失败测试；定向测试 76 项、全量 113 个测试文件共 1568 项、前端构建均通过。
- 首次发布尝试未真正进入运行容器；刷新后通过容器内源码检查发现 `SOURCE_OLD`，因此停止重复刷新并重新完成文件传输与镜像构建。
- 修复文件 SHA-256：`8297d5054d6c8c59fd92b42a6614e9fcf56399b354695ba114e5f15f4e7049ce`；服务器容器内已确认 `SOURCE_NEW`，Compose 容器为 `healthy`，公网 `/healthz` 返回 `{"ok":true}`。
- 发布前源码备份：`/opt/jersey/backups/20260814-121900-pre-multistore-handoff`；回滚镜像：`jersey-3d-configurator-server:rollback-pre-multistore-handoff-20260814-121900`；候选镜像：`jersey-3d-configurator-server:multistore-handoff-20260814-121900`。
- 真实 Shopify App Proxy 链路已通过：handoff 成功跳转至 `https://testcsj-secure-bundle.myshopify.com/cart`，购物车包含 1 件 `$89.00 USD` 定制球衣，并携带生产 ZIP、`design.json`、UV 图集及 SHA-256 信息；未进入结账。

## 测试结账与订单绑定回归

- 使用 Shopify 开发店的 `Test Payment Gateway` 完成批准交易测试，未使用真实银行卡、未产生真实扣款。
- 测试订单为 `#1003`，结账确认号为 `FHATKL84G`，金额 `$89.00 USD`，商品为 1 件定制球衣。
- 腾讯云已收到新的 `orders/paid` Webhook；设计 `dsg_6801592c-683b-47f1-b707-957c6542bdd5` 已绑定至订单 `#1003`，状态为 `paid_pending_production`，`error_code` 为空。
- 生产包 `fn8788-jersey-design-b8e86bab.zip` 已被对象索引识别；磁盘实际大小、数据库记录和对象索引均为 `3,568,298` 字节。
- 实际文件头为 `PK`，磁盘文件、生产设计记录和对象索引的 SHA-256 完全一致；订单到生产文件的端到端链路验证通过。
- Shopify Admin 订单列表已确认 `#1003` 为 `$89.00`、已付款、未发货、1 件商品，支付与履约状态符合测试预期。

## 1.0.0 应用打开页发布

- 已安装店铺从 Shopify 签名 `/auth` 入口建立短期安全会话后跳转 `/app`，不再显示临时授权成功页。
- `/app` 已升级为正式商家控制台，显示 `v1.0.0`、店铺连接、结账启用和订单绑定状态，并保留全部现有商品映射表单。
- 全量 113 个测试文件、1568 项测试及生产构建均通过。
- 腾讯云发布前备份为 `/opt/jersey/backups/20260814-140600-pre-v1-app-home`，回滚镜像为 `jersey-3d-configurator-server:rollback-pre-v1-app-home-20260814-140600`，当前镜像为 `jersey-3d-configurator-server:v1.0.0-20260814-140600`。
- 已从 Shopify Admin 真实打开应用并完成页面验收；Development App 版本 `1.0.0` 已发布，版本 ID `1089238073345`。
