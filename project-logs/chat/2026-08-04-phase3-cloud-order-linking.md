# 2026-08-04 Phase 3 云端订单关联对话摘要

## 用户目标

用户希望顾客完成 3D 设计、加购并付款后，商家能根据 Shopify 订单找到并下载对应生产文件 ZIP。双方确认按既定分阶段路线继续：Phase 3 先解决云端暂存和订单关联，订单详情文件卡片与 App 下载列表留到 Phase 4。

## 本阶段关键决策

- 七文件生产包必须在加入购物车前上传；上传失败不能生成可用的购物车交接。
- Shopify 报价、KV 记录、App Proxy line properties 和订单 webhook 都以服务端 `designId` 为关联主键，买家可编辑摘要不作为授权依据。
- 只有 `orders/paid` 可以把设计推进到待生产；`orders/create` 不触发生产。
- 缺失或损坏 manifest/ZIP 的订单进入 `file_error`，不能伪装为可生产。
- 取消、退款和清理都保留已付款文件；过期未付款草稿由有租约的定时任务清理。
- R2 保持私有，D1 保存可查询索引；原始对象路径不进入顾客响应或 Shopify line properties。
- 检入配置继续保持 `LOCAL_PRODUCTION_FILES=true`。必须确认 Workers Paid / Standard、30 秒 CPU ceiling、权限和测试店后，才能另行批准开启上传。

## 重要澄清

- `read_orders` 是 Shopify protected customer data。不同 App 类型的审批路径不同，不能一概写成必须公开 App 审核；正确门禁是完成适用审批/声明和商家授权，并实测 granted scopes 包含 `read_orders`。
- `shopify.app.toml` 中相对 webhook URI 是合法配置，但只有实际执行 Shopify App deploy 后订阅才会生效。
- Wrangler dry-run 只能证明 bundle/config 可解析，不能证明线上套餐、CPU、内存、secret、权限或 webhook 已正确。
- Push Git 不代表授权创建资源、执行远程 migration、设置 webhook、部署 Worker/App 或进行支付。

## 被否决路径

- 否决在付款后才首次生成或上传生产包：浏览器可能已经关闭，无法保证文件存在。
- 否决使用 KV 作为订单后台主索引：它不适合按订单分页、筛选和状态更新。
- 否决把 R2 key 放进 Shopify 属性供工作人员复制：会暴露内部路径且缺少权限边界。
- 否决收到 webhook 就无条件标记为可生产：必须重新检查 D1 绑定和 R2 哈希 metadata。
- 否决清理任务先删 R2 再占用 D1：会与支付形成数据丢失竞态。
- 否决在未确认 Workers 套餐和 32 MiB 资源表现时关闭本地模式。
- 否决用分段测试冒充单一端到端证据，或把本地 migration 写成远程已完成。

## 本地实现检查点

- 订单生命周期提交：`4679c8b feat: link shopify order lifecycle to production drafts`。
- 过期草稿清理提交：`a8a575f feat: clean expired production drafts`。
- Task 8 收口时完整测试为 85 files / 1,533 tests passed，应用、Shopify、showcase、Shopify scaffold 和 Wrangler dry-run 均通过。
- 本地 D1 migration 已用 `--local` 成功执行，确认业务表和 `d1_migrations` 存在；没有运行 `--remote`。
- Task 9 单一端到端契约测试已由 `d38d500` 完成：focused 1/1、相邻 227 tests、完整 86 files / 1,534 tests passed；bundle 篡改路径进入 `file_error`。
- 最终验证确认应用、Shopify 与 showcase 构建通过，Wrangler dry-run 识别预期 KV/R2/D1/rate-limit bindings 并保持 `LOCAL_PRODUCTION_FILES=true`。Shopify App 测试的 scaffold 27 个文件、Node 4/4 + 12/12、Rust 23/23 + 13/13 全部通过；Windows 环境使用本机 Rust 1.97.1 和 ASCII 临时 target，验证后已清理临时目录与本地 Wrangler 状态。

## 上线与回滚边界

- 上线必须按 `docs/deployment/phase3-production-storage.md` 的顺序单独批准并执行，只使用被本地 exclude 的 `phase3-test` Wrangler/Shopify 私有配置锁定唯一测试目标。
- 首次只使用非 live app-development store 和 Shopify 测试支付。
- Turnstile 使用显式 allowed hostnames，不使用 `Any Hostname`。
- 出现问题时恢复上一 Worker/App 版本、重新启用本地生产文件模式并禁用新 webhook。
- 回滚保留 R2/D1 数据、migration 和 webhook receipts，不用删除资源来“回到干净状态”。

## 下一阶段

Phase 4 才新增 Shopify 订单详情 Admin Block、App 定制订单列表和安全下载入口。Phase 3 的目标是让订单和文件可靠关联，不包含后台取件 UI，也不改变这一范围边界。
