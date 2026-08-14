# Shopify 测试店与 App 联调交接

日期：2026-08-10  
当前工作树：`C:\Users\Administrator\Documents\可编辑自定义产品\jersey-3d-configurator\.worktrees\codex\tencent-server-storage`  
当前分支：`codex/admin-order-download`  
当前提交：`fab9f47`

## 结论先行

腾讯云服务器、HTTPS、独立订单后台和本机备份检查点已经完成。Shopify 开发测试店和 App 记录已经创建，但 App 项目版本尚未配置、发布或安装，服务器仍使用 `example.myshopify.com` 占位映射。因此下一对话应从“链接本地 Shopify CLI 项目并准备测试 App 配置”开始，不能直接跳到付款测试。

## 用户目标

顾客在 Shopify 完成球衣定制、加购并测试付款后，服务器接收可信订单 webhook，把 Shopify 订单与 design 生产文件关联；工作人员随后在独立后台按订单查找并下载对应 ZIP。

成功标准：

1. 测试店完成一笔 Shopify 测试支付。
2. `orders/paid` webhook 在服务器通过 HMAC 校验并只处理一次。
3. 后台出现对应订单、design ID 和生产文件状态。
4. 登录后的工作人员能下载完整 ZIP，未登录请求返回 401。
5. 全程不连接 live 店、不使用真实付款、不泄露任何 secret。

## 已完成的腾讯云环境

- 腾讯云轻量应用服务器，Ubuntu 24.04 LTS，公网 IP `139.199.202.173`。
- Docker 与 Docker Compose 已安装并通过 `hello-world` 拉取和运行验证。
- 项目部署目录：`/opt/jersey/app`。
- 数据目录：`/opt/jersey-data`，包含 `jersey.sqlite` 与 `objects/`。
- 当前镜像：`jersey-3d-configurator-server:fab9f47`。
- 当前容器：`app-jersey-server-1`，健康状态为 healthy，只绑定 `127.0.0.1:8080`。
- Nginx 代理 80/443；应用端口 8080 未直接暴露公网。
- 服务器本机经 Nginx HTTPS 访问 `/healthz` 返回 `{"ok":true}`；公网 `/admin/` 已由浏览器打开。
- 独立后台：`https://139.199.202.173/admin/`，登录、空列表和未登录 401 已验收。
- Let's Encrypt IP 证书已生效；Certbot 定时续期和 deploy hook dry-run 已通过。
- 服务器本机回滚备份：`/opt/jersey/backups/20260810-pre-admin-fab9f47/`；数据归档和 SHA-256 校验文件存在且归档可读。

## 已创建的 Shopify 资源

### 开发测试店

- 名称：`Jersey Configurator Test`。
- 域名：`jersey-configurator-test.myshopify.com`。
- Admin：`https://admin.shopify.com/store/jersey-configurator-test`。
- 类型：开发测试店，Basic 计划。
- 创建时已启用 Shopify 测试数据。
- 尚未创建本项目需要的真实球衣与附加价商品映射，尚未测试付款。

### Dev Dashboard App

- 名称：`Secure Jersey Configurator`。
- App 记录 ID：`408595562497`。
- Dev Dashboard：`https://dev.shopify.com/dashboard/174340437/apps/408595562497`。
- 创建版本页曾显示一个初始活跃版本 `secure-jersey-configurator-1`，但它仍是 Shopify 初始配置，不代表项目配置已发布。
- 项目专用版本尚未发布；App 尚未安装到测试店。
- 尚未读取或写入 Client secret；任何 secret 都不得写入聊天、截图、Git 或本文档。

## 代码与服务器配置现状

- Shopify 项目目录：`shopify-app/`。
- 现有模板：`shopify-app/shopify.app.toml`，仍包含 `TARGET_*` 占位值，不能直接 deploy。
- 现有权限模板：`read_orders,read_cart_transforms,write_cart_transforms,read_validations,write_validations,write_app_proxy`。
- Webhook：`orders/paid`、`orders/cancelled`、`refunds/create`，相对 URI `/webhooks/shopify/orders`，API version `2026-07`。
- App Proxy：店面路径 `/apps/jersey-configurator`，服务器目标 `/apps/jersey-configurator`。
- 两个 Functions：`secure-jersey-transform` 与 `secure-jersey-validation`。
- 服务器当前 `ADMIN_SHOP=example.myshopify.com`，`SHOPIFY_STORE_CONFIG_JSON` 也只含 `example.myshopify.com` 与占位产品 ID。
- 服务器没有 `/auth/callback` 实现；独立后台使用自己的密码会话，不是 Shopify OAuth 或嵌入式 Admin App。

## 已确认的决策

- 先在开发测试店跑通，稳定后再评估其他店铺；不连接当前 live Shopify 店。
- 先使用腾讯云单机 SQLite 与私有磁盘，不在本阶段切回 R2。
- 工作人员先使用独立订单后台，暂不开发 Shopify Admin Block。
- 服务器可以暂时使用 HTTPS IP 地址证书；正式接单前仍建议绑定稳定域名。
- Shopify Functions 与 App 配置必须通过 Shopify CLI 管理和发布，不能只在 Dev Dashboard 手工创建 App 后就认为已生效。

## 下一对话执行顺序

### 1. 只读核对

先读取：

- 本交接文档。
- `docs/deployment/tencent-lighthouse-server.md`。
- `shopify-app/README.md`。
- `shopify-app/shopify.app.toml`。
- `shopify-app/scripts/deploy.mjs`。

确认分支仍为 `codex/admin-order-download`、服务器仍运行 `fab9f47` healthy。当前工作树预期只包含本次四个文档改动；如果这些文档已被提交，则工作树应为 clean。不要覆盖用户其他工作树中的改动。

### 2. 链接 Shopify CLI 项目

在 `shopify-app/` 运行官方支持的 `shopify app config link`，选择已经创建的 `Secure Jersey Configurator`，生成测试环境专用配置。不要覆盖模板；配置文件应保持私有并确认已被 Git 忽略。

本地 `shopify-app/package.json` 仍固定 `@shopify/cli 4.5.2`。在执行链接或 deploy 前先核对当前 Shopify CLI 的兼容性；如需升级依赖，必须先说明影响、建立 Git 检查点并取得用户确认。

### 3. 准备但不发布 App 版本

需要解析并复核：

- 测试服务器基址：`https://139.199.202.173`。
- `embedded=false` 是否与当前独立后台方案一致。
- App Home 应使用服务器后台还是 Shopify 的 extension-only 默认页。
- 当前没有 `/auth/callback`，不能保留一个看似可用但实际不存在的回调。
- 权限范围是否全部受当前测试店计划和 protected customer data 要求允许。
- App Proxy 与 webhook URI 是否指向当前服务器真实路径。

先执行项目已有的 check-only/构建/测试命令，展示发布差异；`shopify app deploy` 是外部发布动作，必须再次取得明确确认。

### 4. 发布并安装

经确认后发布测试 App 版本，再从 App Home 安装到 `jersey-configurator-test.myshopify.com`。安装后回读实际 granted scopes、Functions 状态、App Proxy 与 webhook 订阅，不把“页面显示成功”当成完整验收。

### 5. 建立真实测试商品映射

为测试店创建球衣产品的 S/M/L/XL variants 和附加价 variants，记录真实 numeric IDs。先完成可回滚的测试商品配置，再生成私有 `local-config/*-install.json`；不要把 token、secret 或 IDs 误写入公共模板。

### 6. 更新服务器私有配置

更新前再次备份 `.env.server`、SQLite 和对象目录。将服务器的 `ADMIN_SHOP` 与 `SHOPIFY_STORE_CONFIG_JSON` 改为 `jersey-configurator-test.myshopify.com` 的真实映射，并用安全方式写入 Shopify App secret、报价签名 secret 与 Turnstile 配置。修改 `.env.server` 和重启容器都需要用户单独确认。

### 7. 真实测试链路

按“生成生产 ZIP → 上传暂存 → App Proxy 报价 → 加购 → Shopify 测试支付 → webhook 关联 → 后台出现订单 → 下载 ZIP”的顺序验收。每一步记录设计 ID、订单测试标识、HTTP 状态和非敏感摘要；失败时不要重复付款或手工伪造订单状态。

## 禁止与风险

- 不连接 live 店、不启用真实付款、不批量创建真实订单。
- 不在终端输出、聊天、截图或 Git 中展示 Client secret、Admin token、报价签名 secret、Turnstile secret、后台密码或私有 `.env.server`。
- 未经确认不得发布 App、部署服务器、重启容器、改防火墙、改数据库或写入远程 secret。
- `read_orders` 涉及受保护订单/客户数据；需要以 Shopify 实际授权结果为准。
- Basic 测试店用于暴露计划兼容问题；Shopify Functions/权限如果受限，应停止并记录，不得绕过。
- 单机 SQLite 和磁盘仍是单点；正式接单前要增加异机备份与恢复演练。

## 本轮没有做的事

- 没有修改代码。
- 没有发布 Shopify App 版本。
- 没有安装 App。
- 没有创建测试商品或测试订单。
- 没有修改服务器 Shopify 映射或任何 secret。
- 没有执行真实或测试付款。
