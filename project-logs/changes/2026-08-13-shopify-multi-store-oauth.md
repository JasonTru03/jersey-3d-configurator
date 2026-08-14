# 2026-08-13 Shopify 多店 OAuth 与安装生命周期

## 本次目标

完成公共多店铺 App 计划阶段 2 的本地实现：让第三方 Shopify 店铺可以通过 authorization code grant 安装，安全保存每店离线访问令牌，并在权限变化或卸载时更新安装状态。

## 官方规范选择

- 当前 App 配置为 `embedded = false`，继续采用非嵌入式独立 App。
- 显式设置 `use_legacy_install_flow = true`，避免 Shopify 默认 managed installation 与手动 OAuth 回调冲突。
- 授权 URL 请求 TOML 中声明的完整 scopes；收到令牌后只按 Shopify 的写权限隐含读权限规则检查必要 scopes。
- OAuth 完成后使用 302 跳转到 App UI，并带回经过校验的 `shop` 和 `host`。

## 新增

- `migrations/0005_shopify_installations.sql`
  - OAuth state 单次消费记录。
  - 每店安装状态、加密令牌与 granted scopes。
  - 安装、重装、scope 更新和卸载审计。
- `workers/shopify/oauth.js`
  - 处理 `/auth`、`/auth/callback` 和受签名会话保护的 `/app`。
  - 校验安装请求/回调 HMAC、时间戳、shop、host、state 与同源 HttpOnly Cookie。
  - 使用授权码换取非过期离线 token，验证 granted scopes，并以 302 跳转 App UI。
- `workers/shopify/oauthSecurity.js`
  - OAuth query HMAC、shop、时间戳和 state 摘要工具。
- `workers/shopify/tokenVault.js`
  - 以独立 32 字节密钥执行 AES-256-GCM 加密。
  - 将 shop 和密钥版本放入认证附加数据，防止跨店复制密文。
- `workers/shopify/oauthRepository.js`
  - 单次 state、安装状态、scope 状态、卸载清理与审计的 D1/SQLite 仓库。
  - 生命周期 Webhook 使用 pending/processed 审计防止重复卸载清空重装后的新令牌。
- `workers/shopify/appLifecycleWebhooks.js`
  - 处理 `app/uninstalled` 与 `app/scopes_update`。
- `workers/shopify/webhookSecurity.js`
  - 统一隐私与 App 生命周期 Webhook 的原始 body 限制和 HMAC 校验。
- OAuth、加密仓库、令牌保险库和生命周期 Webhook 测试。

## 变更

- Shopify App URL 改为 `/auth`，增加 legacy install flow 与两个 App 生命周期订阅。
- Worker 路由新增 `/auth`、`/auth/callback`、`/app` 和 `/webhooks/shopify/app-lifecycle`。
- 腾讯云 Server 配置新增公开 App client ID 与私有令牌加密密钥。
- `shop/redact` 现在也删除 OAuth 会话、安装令牌和安装审计。

## 安全审查结论

- 明文 access token 不进入数据库、日志、错误响应或测试快照。
- state 最长 10 分钟且只能消费一次；过期记录在新安装时清理。
- App UI Cookie 为 Secure、HttpOnly、SameSite=Lax，并绑定 shop、过期时间和 App secret 签名。
- 伪造 HMAC、跨店密文、篡改 Cookie、重复卸载、旧 scope 倒灌和缺失 scopes 均已覆盖。

## 验证

- 阶段 2 与相邻链路：11 个测试文件、112 项测试通过；随后补充的隐私/OAuth 数据删除回归 9 项通过。
- 完整生产构建通过。
- Shopify TOML 结构断言通过，最终敏感信息扫描仍因本机已有的忽略文件 `shopify-app/local-config/shopify-admin-token.txt` 主动失败；未读取、输出或修改该文件。

## 影响范围与遗留问题

- 本阶段没有部署腾讯云、Cloudflare、Shopify App 版本或线上数据库迁移。
- 当前 App Home 只显示安全连接状态；商品/变体配置与 CSRF 保护的写操作属于阶段 3。
- 正式部署前必须生成新的独立 token encryption key，并纳入服务器密钥备份和轮换流程。
- 真实 Shopify 安装、卸载和重装端到端验证留到候选发布阶段。
