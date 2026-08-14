# Shopify 公开多店铺 App：商家自助配置

日期：2026-08-13  
状态：本地实现与自动化验证完成，尚未部署、尚未创建线上 App 版本。

## 本阶段目标

把球衣、尺码变体和附加价变体从静态 `SHOPIFY_STORE_CONFIG_JSON` 迁移到按店铺隔离的数据库配置，并让商家在 App Home 中自行完成配置、启用 Shopify Functions 和添加主题入口。

## 已完成

### 按店铺配置与安全激活

- 新增 `migrations/0006_shopify_store_configs.sql`，保存店铺配置、版本、加密后的 Function 签名密钥、激活状态和注册 ID。
- 保留旧环境 JSON 的只读回退；数据库中一旦存在该店铺记录，就不再回退旧 JSON。
- Function 签名密钥与 OAuth 离线令牌使用不同的 AES-GCM AAD purpose，避免密文跨用途解密。
- 同一店铺的配置启用使用 15 分钟数据库激活锁，避免并发请求交叉覆盖结账配置。
- 只有 Cart Transform 与 Cart/Checkout Validation 的注册、开关和两份配置内容均精确回读一致后，数据库状态才会变为 `active`。
- Cart Quote 与生产草稿链路只接受 `active` 配置；草稿或激活失败状态均 fail closed。

### 商家 App Home

- `/app` 改为正式商家配置页，不再使用 OAuth 模块中的占位首页。
- 校验签名会话、安装状态和 CSRF；离线访问令牌只在服务端解密并用于 Shopify Admin GraphQL。
- 商家可选择球衣商品、S/M/L/XL 四个尺码变体及多条附加金额/变体映射。
- 服务端确认四个尺码变体属于所选球衣商品；附加价变体可来自当前店铺的其他商品。
- 当前 Shopify Functions 合约仅支持 USD，因此非 USD 基础币种会在保存前明确拒绝。
- Admin GraphQL 请求增加 12 秒超时、响应大小限制和净化错误，日志与响应不包含访问令牌或 Shopify 原始错误详情。

### Theme App Extension 与安全启动

- 新增 `secure-jersey-launcher` Theme App Extension，商家无需直接修改主题 Liquid。
- App Home 在配置启用后提供官方 Theme Editor 深链，将应用块添加到产品模板的 Apps section。
- 新增签名 App Proxy 启动路由 `/apps/jersey-configurator/launch`。
- 启动路由验证 Shopify App Proxy HMAC、5 分钟时间戳、店铺状态和所选变体，再使用数据库中的权威映射重定向到 3D 配置器。
- Theme App Extension 不再硬编码腾讯云 IP，也不在店面 URL 中自行提供可篡改的附加价映射。

### 内部生产后台

- 店铺下拉列表会合并旧白名单、数据库中已启用的店铺和已有生产订单店铺。
- 新商家完成配置后无需修改服务器环境变量即可出现在生产订单后台。

### 权限与合规清理

- OAuth/App 模板增加最小商品读取权限 `read_products`。
- `shop/redact` 同时删除该店铺的数据库商品配置。
- Shopify 脚手架敏感信息扫描跳过已由 `.gitignore` 明确隔离的 `local-config/` 与 `secrets/`，不会读取或误报本地私密令牌文件。

## 验证结果

- 根项目全量测试：`113` 个测试文件，`1562` 项测试全部通过。
- 根项目生产构建：`npm run build` 通过。
- Shopify 脚手架验证：31 个必需文件通过，公开模板仅含占位符。
- 部署防护测试：4 项全部通过。
- Store Config 测试：13 项全部通过。
- Cart Transform Rust 测试：23 项全部通过。
- Validation Rust 测试：13 项全部通过。
- 浏览器桌面预览通过：商品选择后 S/M/L/XL 变体正确联动。
- 浏览器 390×844 窄屏预览通过：单列布局正常，`scrollWidth === clientWidth === 390`。

## 未执行

- 未部署 Worker、腾讯云服务或数据库 migration。
- 未运行真实 Shopify OAuth、Admin GraphQL 或 App Proxy 请求。
- 未创建或发布 Shopify App 版本。
- 未修改 Public distribution，也未提交 App Store 审核。

## 已知限制与后续

- 当前结账合约仅支持 USD；若要公开支持其他币种，需要统一调整报价、Cart Transform 和 Validation 的货币合约并重新做结账回归。
- App Home 最多加载前 250 个商品，每个商品展示前 100 个变体；超过 100 个变体时页面会明确提示。后续可改为服务端搜索与按需分页。
- Theme App Extension 的远端 UID 会在首次连接/部署正式 Shopify App 时由 Shopify 分配；本地模板不伪造 UID。
- 下一阶段是公开页面与审核材料：品牌域名、隐私政策、服务条款、支持页面、App Store listing、定价和 Protected Customer Data 说明。

## 参考

- Shopify OAuth authorization code grant：https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
- Shopify Admin GraphQL products：https://shopify.dev/docs/api/admin-graphql/latest/queries/products
- Shopify Theme App Extension 配置与深链：https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
- Shopify Theme App Extension UX：https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux
