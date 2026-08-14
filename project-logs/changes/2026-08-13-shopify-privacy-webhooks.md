# 2026-08-13 Shopify 隐私合规 Webhook

## 本次目标

完成公共多店铺 App 计划的阶段 1：在本地实现 Shopify 强制隐私合规 Webhook，验证请求真实性、记录处理状态，并对本项目保存的订单定制数据执行查询或删除。

## 新增

- `migrations/0004_shopify_privacy_requests.sql`
  - 新增隐私请求状态表，以 Shopify Webhook ID 作为幂等主键。
  - 允许同一客户发起多次彼此独立的合法请求。
- `workers/shopify/privacyRepository.js`
  - 提供请求记录、按店铺/订单查询定制设计、生成最小数据响应、客户删除和店铺删除能力。
- `workers/shopify/privacyWebhooks.js`
  - 支持 `customers/data_request`、`customers/redact`、`shop/redact`。
  - 校验原始请求 HMAC、店铺域名、主题、Webhook ID、Content-Type 和 256 KiB 请求体上限。
  - 删除对象存储文件成功后才提交数据库删除；失败返回 503，保留 pending 状态供 Shopify 重试。
- 两组单元/SQLite 集成测试，覆盖跨店隔离、重复投递、Webhook ID 冲突、重复客户请求、对象存储失败和删除范围。

## 变更

- Worker 路由新增 `POST /webhooks/shopify/privacy`。
- Shopify App 配置声明三个 mandatory compliance topics。
- 公共多店铺 App 计划明确：`app/uninstalled` 与 OAuth 凭据清理在阶段 2 一起实现。

## 安全与影响范围

- 本阶段仅修改本地代码、迁移和配置，没有部署 Worker、腾讯云服务或线上数据库。
- 数据访问结果仅保存业务所需的最小字段，不包含对象存储 key、客户邮箱或原始 Webhook 请求体。
- 店铺删除目前覆盖现有设计、生产文件、下载审计和订单 Webhook 收据；阶段 2 新增 OAuth 凭据后，必须同步扩展店铺删除范围。

## 验证

- 定向与相邻回归：5 个测试文件、72 项测试全部通过。
- 完整生产构建通过。
- Shopify 脚手架配置断言已执行到敏感信息扫描；扫描器因本机已有、被忽略的 `shopify-app/local-config/shopify-admin-token.txt` 主动失败。未读取、输出、移动或删除该文件。
- `git diff --check` 通过。

## 遗留问题

- 尚未部署，因此没有真实 Shopify 隐私 Webhook 端到端回归。
- `customers/data_request` 已生成 `response_ready` 结果，但管理人员导出并在法定期限内交付给商家的操作流程尚未实现，计划在阶段 4 补齐。
- 当前构建仍有既存的大包体积警告，本阶段未扩大范围处理。
