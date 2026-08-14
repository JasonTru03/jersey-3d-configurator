# 公开发布前需要确认的业务信息

以下字段在本地审核材料中使用占位符，确认前不会发布：

| 字段 | 占位符 | 说明 |
|---|---|---|
| 正式 App 名称 | `{{APP_NAME}}` | 当前建议：Secure Jersey Configurator |
| 开发者/公司公开名称 | `{{LEGAL_ENTITY_NAME}}` | 隐私政策和服务条款主体 |
| 注册地址或联系地址 | `{{CONTACT_ADDRESS}}` | 按适用法律和 Shopify 表单要求填写 |
| 支持邮箱 | `{{SUPPORT_EMAIL}}` | 必须长期有效，不能包含 Shopify 字样 |
| 隐私联系邮箱 | `{{PRIVACY_EMAIL}}` | 可与支持邮箱相同 |
| 紧急技术联系人 | `{{EMERGENCY_CONTACT}}` | Partner Dashboard 中的邮箱和电话 |
| 正式公开入口 | `jersey-3d-configurator.jason1064969838.workers.dev` | 已确定；不再使用裸 IP 或临时 Quick Tunnel。自有品牌域名可后续替换 |
| 定价模式 | `{{PRICING_MODEL}}` | 免费、一次性、订阅或按订单；收费必须使用 Shopify Billing/App Pricing |
| 生产文件保留期 | `{{PAID_DESIGN_RETENTION_DAYS}}` | 建议 180 天；确认后再实现自动删除，避免误删生产文件 |
| 数据控制者/处理者角色 | `{{DATA_ROLE}}` | 建议由法律顾问确认 |
| 适用法律和争议地 | `{{GOVERNING_LAW}}` | 服务条款必需 |

## 已确定的产品限制

- 当前仅支持店铺基础币种和结账币种为 USD。
- 需要 Shopify Online Store 2.0 主题。
- 商家必须添加并保存 Theme App Extension 应用块。
- 仅使用 GraphQL Admin API；不使用 REST Admin API。
- 只申请 Protected Customer Data Level 1，不申请姓名、地址、电话或邮箱字段。
