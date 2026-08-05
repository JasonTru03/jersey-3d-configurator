# 阶段 3 免费额度流式上传实施计划

**目标：** 将阶段 3 的大文件上传从 Worker 缓冲处理改为 R2 流式写入，使试运行版本适配 Cloudflare Workers Free。

## 任务 1：冻结协议和数据库契约

- [x] 为客户端三步上传写失败测试。
- [x] 为 Worker 创建会话、manifest PUT、bundle PUT 写失败测试。
- [x] 新增 D1 migration，补充两个文件的大小和哈希字段。
- [x] 为 upload session 查询、幂等创建和最终状态转换写仓储测试。

## 任务 2：实现浏览器端三步上传

- [x] 在浏览器计算 manifest/ZIP SHA-256。
- [x] 发送有上限的小 JSON 创建会话。
- [x] 顺序流式上传 manifest 和 ZIP，保留超时、取消和错误提示。
- [x] 不改变 `ConfiguratorPage` 的公开调用形状和加购顺序。

## 任务 3：实现 Worker 流式协议

- [x] 路由精确匹配两个 PUT 子路径。
- [x] 创建会话只做小数据校验、Turnstile、限流和 D1 预留。
- [x] PUT 按 D1 中预声明的数据校验请求并直接 `R2.put(request.body, { sha256 })`。
- [x] bundle 成功后才把 `upload_pending` 更新成 `cart_draft`。
- [x] 失败时保留可重试状态，不伪装成功。

## 任务 4：收紧免费额度运行参数

- [x] Worker CPU 上限改为 10ms。
- [x] 清理只删除两个对象，每次最多处理一个草稿。
- [x] 更新部署文档，明确 R2 启用、免费额度、超量计费和线上授权边界。

## 任务 5：验证和交付

- [x] 运行聚焦单元测试和真实 SQLite/R2 内存集成测试。
- [x] 运行完整测试、应用构建、Shopify 测试和 Wrangler dry-run。
- [x] 检查 diff、敏感信息、migration 和回滚说明。
- [x] 提交本地分支；push、远程 migration、资源创建和发布均等待用户另行确认。

## 回滚

代码回滚到阶段 3 原协议，并保持 `LOCAL_PRODUCTION_FILES=true`，即可停止新的云端草稿上传。已经写入 R2/D1 的数据不自动删除；远程 migration 不做破坏性回退。
