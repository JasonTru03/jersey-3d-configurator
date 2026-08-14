# Shopify 公开多店铺 App 发布计划

日期：2026-08-13

## 目标与完成标准

把已在开发店跑通的 3D 球衣 App 升级为可供第三方 Shopify 商家安装的公开分发 App。完成标准：

1. 新商家可通过标准 OAuth 独立安装、授权、重装和卸载。
2. 每家店铺的令牌、商品映射、Functions 配置和生产数据严格隔离。
3. 商家无需人工修改服务器环境变量即可完成商品和变体配置。
4. 三个强制隐私 Webhook 均验证原始请求 HMAC，并完成访问或删除动作。
5. 在全新开发店验证安装、配置、主题入口、3D 定制、购物车、测试付款、订单绑定、生产文件和卸载回归。
6. App Store listing、隐私政策、支持信息和 Protected Customer Data 声明一致。
7. 只有用户最终确认后，才选择不可逆的 Public distribution 并提交 Shopify 审核。

## 当前基础

- 开发 App 已在 `testcsj-secure-bundle.myshopify.com` 跑通真实链路。
- Cart Transform 与 Cart/Checkout Validation 已有可工作的 Shopify Functions。
- `3D 定制 → App Proxy → 购物车 → 测试付款 → orders/paid → 生产 ZIP` 已验证。
- 腾讯云使用 SQLite 与私有对象目录保存生产数据；Cloudflare Worker 负责公开配置器与 App Proxy 转发。

## 分阶段执行

### 阶段 1：隐私合规基础

状态：本地实现和自动化验证已完成，尚未部署。

- 订阅 `customers/data_request`、`customers/redact`、`shop/redact`。
- 使用原始 body 验证 HMAC，伪造签名返回 401。
- 数据访问只返回本系统实际持有的最小数据。
- 删除请求按店铺和订单隔离，使用幂等交付记录。

### 阶段 2：标准 OAuth 与安装生命周期

状态：本地实现和自动化验证已完成，尚未部署。

- `/auth` 与 `/auth/callback` 实现 authorization code OAuth。
- state、时间戳、HMAC、店铺域名和 scopes 全部校验。
- 每店离线令牌使用 AES-GCM 加密存储，日志不输出令牌。
- 处理 `app/uninstalled` 与 `app/scopes_update`。

### 阶段 3：商家自助商品配置

状态：本地实现、UI 验收和自动化验证已完成，尚未部署。

- App Home 可选择球衣商品、S/M/L/XL 和附加价变体。
- 服务端校验变体属于当前店铺，四个尺码属于所选球衣商品。
- 配置按店铺写入数据库；旧 JSON 仅作为只读回退。
- 逐店加密 Function 签名密钥，并使用数据库锁避免并发激活覆盖。
- 创建或更新 Cart Transform 与 Validation，精确回读后才标记为 active。
- 新增 Theme App Extension 和官方 Theme Editor 深链。
- 新增签名 App Proxy 启动路由，店面不再硬编码服务器 IP 或附加价映射。
- 内部生产后台自动发现数据库中的新店铺。

验证结果：根项目 1562 项测试、构建、Shopify 脚手架、部署防护、Store Config 及两套 Rust Functions 测试均通过。

### 阶段 4：公开页面与审核材料

状态：进行中；固定公开入口已确定，业务与法律信息仍待确认。

- 固定公开 HTTPS 入口使用 `jersey-3d-configurator.jason1064969838.workers.dev`；无需先购买域名。
- Cloudflare Worker 仅作为反向代理，OAuth、店铺配置、订单与生产文件继续由腾讯云统一处理和保存。
- 确定正式 App 名称和图标；自有品牌域名作为后续稳定性升级，不阻塞候选测试。
- 编写并发布隐私政策、服务条款、支持页和支持邮箱。
- 准备 App Store 名称、简述、完整描述、定价、截图、演示视频和审核步骤。
- 准备 Protected Customer Data Level 1 的用途、保留期、加密、备份、访问控制和删除说明。
- 逐项核对 listing、运行时权限和数据声明。

### 阶段 5：候选发布与回归

状态：待阶段 4 完成。

- 在全新开发店安装候选版本。
- 验证 OAuth、配置、Functions、Theme App Extension、App Proxy、测试结账、Webhook、生产下载和卸载。
- 保存 Shopify 自动检查结果和非敏感证据。

### 阶段 6：正式公开提交

状态：等待用户最终确认。

- 说明 Public distribution 的不可逆影响。
- 用户明确确认后才创建正式 App 版本、选择 Public distribution 并提交审核。

## 风险与回退

- 不在未确认前部署或选择 Public distribution。
- OAuth、支付/结账和隐私删除均 fail closed。
- 旧静态 JSON 保留只读回退，直到两家开发店完成候选版本回归。
- 当前 Functions 仅支持 USD；扩展币种前必须统一调整报价与结账合约。
- SQLite 与单机对象目录是单点，公开提交前需要加密异机备份和恢复演练。
- 当前 App Home 最多展示前 250 个商品、每商品前 100 个变体；大目录后续改为搜索分页。

## 阶段 4 需要的业务信息

- 正式 App 名称与品牌图标。
- 公司或开发者公开名称。
- 支持邮箱与支持网站。
- 隐私政策/服务条款主体和联系地址。
- 免费、一次性、订阅制或按订单收费的定价决定。
- 自有品牌域名（可选，当前使用固定 `workers.dev` 入口）。
