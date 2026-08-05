# 2026-08-05 腾讯云服务器存储适配

## 目标

为腾讯云轻量应用服务器增加本地 Docker 运行时，使现有生产草稿与 Shopify 订单关联逻辑能够使用服务器磁盘和 SQLite，而不是依赖 Cloudflare R2、D1 与 KV。

## 新增

- Node HTTP 到 Fetch Request/Response 的流式桥接和 `/healthz`。
- SQLite migration runner 与 D1 兼容 binding。
- SQLite KV、固定窗口限流和服务器私有磁盘对象存储。
- 静态构建文件 binding，继续复用现有 Worker router。
- Node 24.18.0 多阶段 Dockerfile、受限 Compose 配置和环境变量示例。
- 腾讯云分期实施计划和部署说明。

## 安全与持久化

- 上传内容边写盘边计算 SHA-256，错误哈希、超限内容和不安全对象键均拒绝。
- 对象键哈希成磁盘文件名，不直接拼接用户输入路径。
- SQLite 启用 WAL、foreign keys、busy timeout 和 migration 记录。
- 容器使用非 root 用户、只读根文件系统、移除 Linux capabilities，并只把 8080 绑定到宿主机回环地址。
- `.env.server` 和本地数据目录已加入忽略规则；真实 secret 未写入仓库。

## 验证

- 服务器专项：8 files / 14 tests passed。
- 相邻生产链路：3 files / 19 tests passed。
- 全量：94 files / 1,454 tests passed。
- `npm run build` 和 `npm run build:showcase` 通过。
- `node --check`、`git diff --check` 通过。
- 本机没有 Docker CLI，镜像构建、容器健康检查和重启持久化必须在腾讯云服务器部署阶段完成。

## 未完成

- 未 push、merge 或部署。
- 未配置域名、HTTPS、Turnstile、Shopify App、webhook 或测试支付。
- 未实现后台订单列表、后台鉴权或 ZIP 下载接口。
- 未建立服务器异机备份。
