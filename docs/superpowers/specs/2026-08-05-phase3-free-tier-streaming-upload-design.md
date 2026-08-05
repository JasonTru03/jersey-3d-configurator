# 阶段 3 免费额度流式上传设计

## 目标

在 Cloudflare Workers Free 的 CPU 限制内，完成“加购前暂存生产文件、付款后关联订单”的阶段 3 主链路。浏览器继续生成并本地校验生产包；Worker 只处理小型元数据和流式转发，不在内存中解析七文件、计算大文件哈希或重建 ZIP。

## 约束

- Worker Free 每次请求 CPU 预算按 10ms 设计。
- R2 Standard 免费额度可作为试运行方案，但启用 R2 仍需完成 Cloudflare 的订阅/付款资料流程，超出免费额度会计费。
- 本阶段只保存 `manifest.json` 和完整生产 ZIP。ZIP 内仍包含既有七个生产文件。
- R2、远程 D1 migration、secret、Shopify webhook 和发布都属于线上操作，必须另行确认。

## 协议

### 1. 创建上传会话

浏览器向 `POST /api/production-drafts` 发送有大小上限的 JSON：

- `shop`、`uploadId`、`turnstileToken`
- 设计身份字段：fingerprint、product/variant/size、model/version、UV export version
- manifest 的字节数和 SHA-256
- ZIP 文件名、字节数和 SHA-256

Worker 校验来源、字段、Turnstile、速率和设计身份，先在 D1 创建 `upload_pending`，再返回服务器生成的 `designId`、短期 `uploadToken` 和两个同源上传地址。

### 2. 上传 manifest

浏览器 `PUT /api/production-drafts/{designId}/manifest`。Worker 用 shop、uploadId、uploadToken 查询 D1，校验 Content-Type/Content-Length 后把 `request.body` 直接流入 R2，并把会话中保存的 SHA-256 交给 R2 校验。

### 3. 上传生产 ZIP

浏览器 `PUT /api/production-drafts/{designId}/bundle`。Worker 先确认 manifest 已存在且元数据一致，再把 ZIP 流式写入 R2。R2 校验 ZIP 的 SHA-256 后，Worker 将同一 D1 记录原子更新为 `cart_draft`，返回既有成功响应。

## 数据和清理

- 新 migration 为草稿保存 `manifest_bytes`、`bundle_sha256`、`bundle_bytes`。
- 新草稿只派生两个私有 R2 key，不再写八个对象。
- 定时清理每次只处理一条过期草稿，并缩小到 manifest/ZIP 两个对象，避免免费套餐定时任务超时。
- 已付款或订单终态文件不由草稿清理删除。

## 安全边界

- 上传 token、shop、uploadId、designId 必须同时匹配，客户端不能指定 R2 key。
- 仅接受同源 API、固定 Content-Type、精确 Content-Length、受限大小和预声明 SHA-256。
- R2 的 `sha256` 条件负责传输完整性；Worker 不读取大文件为 ArrayBuffer。
- Turnstile 只保护创建会话；后续 PUT 使用一次上传会话授权。
- 免费方案不在服务器内重新解析 ZIP，因此不能证明恶意客户端提交的 ZIP 语义正确。后台下载应把 ZIP 当作不可信附件，不自动执行或自动解压；浏览器端现有七文件校验仍会约束正常用户生成的文件。

## 完成标准

- 新协议的客户端、路由、Worker、D1 和清理测试通过。
- 端到端测试覆盖创建会话、两次流式上传、报价/加购、付款 webhook 关联。
- `npm test`、应用构建、Shopify 构建和 `wrangler deploy --dry-run` 通过。
- `wrangler.jsonc` 的 CPU 预算与免费套餐一致；未执行任何线上写入或部署。
