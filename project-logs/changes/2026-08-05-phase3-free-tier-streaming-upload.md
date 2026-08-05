# 2026-08-05 Phase 3 免费额度流式上传

## 目标

把原先需要 Workers Paid 30 秒 CPU 的七文件 multipart 处理，改为适配 Workers Free 10ms CPU 预算的轻量协议，同时保留加购前暂存、付款后关联订单的主链路。

## 改动

- 浏览器在本地计算 manifest/ZIP SHA-256，创建小型上传会话，再顺序 PUT 两个 Blob。
- Worker 只校验小 JSON、请求授权、长度和 D1 声明，使用 `R2.put(request.body, { sha256 })` 流式写入。
- D1 migration `0002` 增加 `manifest_bytes`、`bundle_sha256`、`bundle_bytes`。
- ZIP 写入成功后才从 `upload_pending` 转为 `cart_draft`；同一上传 ID 支持严格幂等恢复。
- 草稿清理缩小为两个对象、每小时最多一条；CPU ceiling 改为 10ms。
- 旧的服务端七文件验证器保留为离线/测试能力，但不进入线上上传热路径。

## 验证

- TDD RED：新客户端测试确认旧 multipart 协议失败。
- 聚焦测试：客户端、Worker、仓储共 97 项通过。
- 完整测试：86 files / 1,440 tests passed。
- 单一端到端：上传、报价、购物车、付款关联、损坏 ZIP `file_error` 全链路通过。
- `npm run build`、`npm run build:showcase` 通过。
- Shopify scaffold/deploy/store-config 测试通过；Rust Functions 23/23 与 13/13 通过。
- 本地 D1 成功应用 `0001`、`0002`，三项新增列回读存在。
- `npx wrangler deploy --dry-run` 通过，识别 D1/R2/KV/rate limits，未部署。

## 风险和边界

- 服务器不再解析 ZIP 语义；恶意客户端可能提交自洽但非本应用生成的 ZIP。后台下载必须按不可信附件处理，不自动执行或解压。
- R2 尚未启用；启用可能要求付款资料，超出免费额度会计费。
- 尚未执行远程 migration、secret 写入、Worker/App 发布、webhook 注册或测试支付。
- 当前远程 D1 已知为空；若上线前出现旧记录，必须先审计 `0002` 新字段为空的兼容影响。

## 回滚

保持或恢复 `LOCAL_PRODUCTION_FILES=true` 可停止新上传。远程 migration 不做破坏性回退，既有 R2/D1 数据保留。
