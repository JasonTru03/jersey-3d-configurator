# 腾讯云与 Shopify 测试环境推进记录

## 用户目标

用户希望顾客在 Shopify 完成定制购买后，工作人员能在后台按订单找到并下载 design 生产 ZIP。用户选择先让当前单店版本稳定上线，再评估迁移到其他店铺。

## 关键决策

- 使用腾讯云轻量应用服务器承载 Node 服务器、SQLite、私有 ZIP 和独立订单后台。
- 先使用 IP 地址 HTTPS 证书继续测试，不因暂时没有域名而停止联调。
- 工作人员先使用独立密码后台，不在当前阶段实现 Shopify Admin Block。
- 创建 Basic 开发测试店以真实暴露 Functions 和权限的计划兼容性。
- 所有 Shopify 联调先在 `jersey-configurator-test.myshopify.com` 完成，不连接 live 店。
- App 通过 Shopify CLI 管理版本、Functions、App Proxy 与 webhook；Dev Dashboard 创建记录本身不等于部署完成。

## 已完成

- Ubuntu、Docker、Compose、腾讯云镜像源和 `hello-world` 验证。
- `fab9f47` 镜像构建、容器健康检查、SQLite/对象持久化和 Nginx 反向代理。
- `https://139.199.202.173` 的短期 IP 证书、Certbot 自动续期和 deploy hook dry-run。
- 独立后台登录、空订单列表、未登录 401 和安全配置回读。
- 服务器本机预部署备份；首次归档失败后改用停止旧容器再归档，最终归档可读且旧容器恢复健康。
- Shopify 开发测试店 `Jersey Configurator Test`。
- Dev Dashboard App `Secure Jersey Configurator`。

## 重要边界

- App 尚未发布或安装。
- 服务器仍配置 `example.myshopify.com`，后台零订单是预期状态。
- 尚未创建本项目需要的测试商品和 variant 映射。
- 尚未写入任何新的 Shopify secret，未执行测试付款。
- 本轮文档不得包含后台密码、哈希、Client secret、Admin token、Turnstile secret 或 `.env.server` 原文。

## 下一步

下一对话首先读取 `docs/superpowers/handoffs/2026-08-10-shopify-test-app-handoff.md`，从 Shopify CLI `app config link` 的只读/本地准备阶段开始。任何 App deploy、安装、服务器配置修改或容器重启都要再次取得用户确认。

