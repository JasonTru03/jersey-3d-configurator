# 2026-08-10 腾讯云上线与 Shopify 测试环境

## 日期

2026-08-10

## 本次目标

把已完成的腾讯云服务器、HTTPS、独立订单后台、备份检查点、Shopify 开发测试店和 App 创建状态写入项目文档，为下一对话继续 App 联调提供可追溯入口。

## 修改范围

- 更新 `docs/deployment/tencent-lighthouse-server.md` 的实际部署状态、备份点、Shopify 资源和后续顺序。
- 新增 `docs/superpowers/handoffs/2026-08-10-shopify-test-app-handoff.md`，作为下一对话唯一接续入口。
- 新增本变更日志和对应聊天决策日志。

## 新增内容

- 记录服务器公网入口、容器版本、Nginx/HTTPS、Certbot 自动续期、后台与备份验证结果。
- 记录开发测试店 `jersey-configurator-test.myshopify.com`。
- 记录 Dev Dashboard App `Secure Jersey Configurator` 及未发布、未安装状态。
- 记录服务器仍使用 `example.myshopify.com` 占位映射这一阻塞项。
- 给出链接 CLI、准备 App 版本、发布安装、创建测试商品、更新服务器映射和测试付款的严格顺序。

## 调整内容

- 将旧部署文档中“尚未配置 HTTPS、后台尚未部署”的历史状态更新为实际已验证状态。
- 将后续目标从“部署服务器”切换为“配置并安装 Shopify 测试 App”。

## 修复内容

- 修复旧文档会让接手者误以为服务器仍运行 `a35b919`、后台未部署以及 Shopify 测试环境不存在的问题。

## 影响范围

仅文档。没有修改代码、依赖、服务器、Shopify App、店铺数据、订单、支付或 secret。

## 自检

- `git diff --check` 已通过。
- 已核对新增交接文档中的分支、提交、服务器地址、测试店域名和 App 记录 ID 与当前证据一致。
- 已确认工作树只包含本轮一个部署文档修改和三个新增文档，没有代码、配置或依赖变更。

## 遗留问题

- Shopify App 项目版本尚未链接、配置、发布或安装。
- 服务器仍映射占位店，尚未连接开发测试店。
- 测试商品、真实 variant ID、Turnstile 正式 hostname、webhook 和测试支付尚未验收。
- 单机数据尚无异机备份。
