# 腾讯云服务器存储实施计划

## 目标

在不改写现有生产草稿、Shopify 报价和订单 webhook 业务规则的前提下，让同一套 Worker 路由能够运行在腾讯云轻量应用服务器的 Docker 容器中：生产 ZIP 保存到服务器磁盘，设计、订单和幂等记录保存到 SQLite。

完成标准：本地能够启动服务器运行时，重启后数据仍存在，现有生产草稿与订单链路测试继续通过，Docker 镜像可以构建并通过健康检查。远程部署、域名、HTTPS、Shopify 配置和真实订单测试不属于本批次。

## 阶段

### A. 本地服务器运行时（本批次）

- 新增 Node HTTP 入口，将请求转换为现有 Fetch `Request`，继续调用 `workers/router.js`。
- 新增 SQLite D1 兼容层，复用现有 migration 和 `productionRepository`。
- 新增服务器磁盘对象存储层，兼容现有 `PRODUCTION_ASSETS` 的 `put/get/head/delete`。
- 新增 SQLite KV 和固定窗口限流层，替代 Cloudflare KV 与 Rate Limit binding。
- 新增静态文件服务、健康检查、Dockerfile、Compose 和环境变量示例。
- 不新增后台页面，不开放 ZIP 下载地址，不改 Shopify live 配置。

验证：适配层单元测试、持久化重启测试、服务器请求桥接测试、现有全量测试、前端构建、Docker 构建与容器健康检查。

### B. 后台订单与安全下载（后续）

- 增加仅商家可访问的定制订单列表。
- 按订单号、状态和日期查找设计。
- 通过鉴权接口下载对应 ZIP，不直接暴露磁盘路径。
- 增加下载审计与缺失文件提示。

### C. 腾讯云测试部署（后续，需单独确认）

- 记录空服务器状态并建立回滚目录。
- 部署 Docker 镜像和持久化目录。
- 配置域名、Caddy/Nginx 与 HTTPS，只向公网开放 80/443。
- 使用健康检查和脱敏测试数据验收；失败时停止新容器并恢复上一版本。

### D. Shopify 测试店联调（后续，需单独确认）

- 配置 Turnstile、Shopify App URL、App Proxy 和 webhook。
- 只在非 live 测试店使用测试支付验证上传、加购、支付关联与后台下载。
- 验收通过后再单独讨论正式店发布。

## 数据与安全边界

- ZIP 最大尺寸继续沿用现有 32 MiB 边界；流式写盘并校验 SHA-256，不整包常驻内存。
- 对象键不直接作为磁盘路径，避免目录穿越；文件和数据库目录不通过静态站点暴露。
- Shopify secret、Turnstile secret 和签名 secret 只从环境变量读取，不写入 Git、日志或截图。
- SQLite 使用 WAL、外键和 busy timeout；migration 有本地记录且只前进不破坏历史数据。
- 容器默认仅绑定服务器本机端口，公网入口留给后续 HTTPS 反向代理。

## 回退点

- 本地代码以 `origin/showcase` 的 `01a42fc` 为基线，独立分支 `codex/tencent-server-storage`。
- 本批次不修改远端服务；撤销时只需放弃该独立分支。
- 后续服务器部署使用独立数据目录和版本目录，回滚应用不删除 SQLite 或 ZIP。
