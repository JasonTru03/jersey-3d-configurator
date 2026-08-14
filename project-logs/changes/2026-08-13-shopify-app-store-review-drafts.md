# Shopify App Store 审核材料草案

日期：2026-08-13  
状态：本地草案完成，包含未确认占位符，不可直接发布或提交。

## 新增材料

- `docs/app-store/business-inputs-needed.md`
- `docs/app-store/listing-draft.md`
- `docs/app-store/legal/privacy-policy-draft.md`
- `docs/app-store/legal/terms-of-service-draft.md`
- `docs/app-store/support-page-draft.md`
- `docs/app-store/protected-customer-data-level-1.md`
- `docs/app-store/submission-checklist.md`

## 草案已明确的审核事实

- App 需要 Shopify Online Store 与 Online Store 2.0 主题。
- 当前版本只支持 USD。
- 公开 App 使用 GraphQL Admin API、标准 OAuth、Theme App Extension 和 mandatory compliance webhooks。
- `read_orders` 只用于订单生命周期与生产设计绑定；不申请姓名、地址、邮箱或电话字段。
- Listing 不包含价格、统计、保证、评论、URL 或 Shopify 商标滥用。
- 截图必须展示真实且不同的 UI 状态，不包含浏览器边框和桌面背景。
- 审核演示视频需要英文讲解或英文字幕。

## 当前业务阻塞项

- 法律主体、联系地址、支持/隐私邮箱。
- 正式品牌域名、App 名称、图标和紧急技术联系人。
- 定价模式；若收费必须使用 Shopify Billing/App Pricing。
- 商家 UI 的最终主语言；未完成整套英文 UI 前不能宣称英语支持。
- 已付款生产文件保留期。草案建议 180 天，但删除具有业务影响，需用户确认后再实现。
- 生产数据库与对象文件的加密异机备份和恢复演练证据。
- 法律适用地、责任限制、数据处理角色和跨境传输条款。

## 官方依据

- App Store requirements：https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- Submit app for review：https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review
- Privacy requirements：https://shopify.dev/docs/apps/launch/privacy-requirements
- Support requirements：https://shopify.dev/docs/apps/launch/distribution/support-your-customers
- Protected customer data：https://shopify.dev/docs/apps/launch/protected-customer-data
- Pass app review：https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review
