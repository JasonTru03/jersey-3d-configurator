# Shopify 购物车交接设计

## 目标

让测试店 `Custom 3D Football Jersey` 的商品页进入独立 3D 配置器；消费者完成配置后，带着正确尺码变体和简短定制摘要回到 Shopify 购物车。

## 已确认范围

- Shopify 测试商品：`custom-3d-football-jersey`，尺码变体为 `S`、`M`、`L`、`XL`，每个变体价格为 `$49.99`。
- 本期购物车价格固定为所选变体的 `$49.99`，配置器的报价仅作为配置预估，不参与 Shopify 计价。
- 3D 配置器继续作为独立 Cloudflare Worker 页面运行，不嵌入 Shopify 商品详情页。
- 主题工作只在未发布的 `3D Configurator Cart Handoff - 2026-07-21` 中进行；不发布主题，不修改 live theme，不创建订单。

## 方案比较

### 方案 A：独立页面 + Cart permalink（采用）

商品页把商品、变体映射和返回店铺地址传给独立配置器。配置器基于当前尺码组装 Shopify cart permalink，携带行项目属性并跳转到 `/cart`。

优点：不需要在浏览器中使用 Admin API，不需要后端或 Storefront token，符合已确认的独立配置器边界。

### 方案 B：嵌入 Shopify 产品表单

复用现有 `ShopifyConfiguratorSection`，把隐藏属性同步进当前主题的产品表单。

缺点：与独立配置器的既定用户路径冲突，并受主题 DOM 和 AJAX 购物车实现约束。

### 方案 C：Storefront API Cart

通过 Storefront API 创建 Cart 并取得 checkout URL。

缺点：需要额外的公开访问令牌与更复杂的服务配置；固定价格测试阶段没有收益。

## 架构与数据流

1. 未发布主题商品页渲染一个“开始 3D 定制”入口。
2. 入口从当前商品的变体选择控件读取变体 ID，并把以下非敏感参数传给 Worker：`shop`、`productHandle`、`variantId`、`variantMap`、`returnPath`。
3. 配置器解析参数并验证 `shop` 是 Shopify 主机名、`variantMap` 包含当前选择的尺码、`returnPath` 是站内相对路径。
4. 配置器新增“加入购物车”动作：依据当前配置尺码从 `variantMap` 选取变体 ID，创建 `https://{shop}/cart/{variantId}:1?properties=...&storefront=true`。
5. Shopify 接收一条固定价格的变体行项目；不同的定制摘要会自然形成独立购物车行。

## 购物车属性

本期只传递订单制作必需的短文本，属性总数不超过 25：

- `Size`
- `Template`
- `Body Color`
- `Sleeves Color`
- `Shoulder and Side Color`
- `Collar Color`
- `Pattern Color`
- `Number Color`
- `Print Name`
- `Print Number`
- `Print Type`
- `Extras`
- `Artwork`
- `_3D Configuration Version`（值为 `1`，对买家隐藏）

不传递完整设计 JSON、Data URL、上传文件内容、Admin token、访问令牌或客户数据。后续接入设计存储后，隐藏属性替换为 `designId`，并增加公开预览 URL。

## UI 与错误处理

- Review design 对话框中提供“加入 Shopify 购物车”按钮，展示 `$49.99` 的 Shopify 固定价格说明。
- 缺少或无效的 Shopify 参数时，按钮禁用，并提示配置器不是从已连接商品页进入。
- 变体映射缺少当前尺码时，阻止跳转并展示可读错误。
- 不改变保存/打开本地设计文件的既有行为。

## 验收与回滚

- 在主题预览商品页选择 `S`、`M`、`L`、`XL` 中任一尺码后进入配置器。
- 更改模板、分区颜色、姓名或号码，点击加入购物车。
- 购物车显示相同尺码变体、固定 `$49.99` 价格和完整短摘要。
- 主题仍为 unpublished；不进入 checkout，不创建订单。
- 回滚方式：停止使用该主题预览副本或删除本次新增主题副本；原主题和 live theme 未被覆盖。
