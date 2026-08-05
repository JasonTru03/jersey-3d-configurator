# 腾讯云轻量应用服务器部署说明

## 当前状态

服务器运行时代码和 Docker 配置已经加入 `codex/tencent-server-storage`，但尚未推送、部署或连接 Shopify。当前腾讯云实例只完成了 Ubuntu、Docker、Compose 和腾讯云镜像加速安装。

本运行时复用现有生产草稿、报价、App Proxy 和 Shopify webhook 业务规则：

- `/api/production-drafts` 接收生产文件声明和流式上传。
- 生产 ZIP 与 manifest 写入服务器私有磁盘。
- SQLite 保存上传状态、设计报价、订单关联、webhook 幂等记录和限流计数。
- `/healthz` 供 Docker 和反向代理检查服务状态。

后台订单列表和安全下载接口仍属于下一阶段，当前不会把 ZIP 目录暴露给公网。

## 服务器数据位置

建议固定使用：

```text
/opt/jersey-data/jersey.sqlite
/opt/jersey-data/objects/
```

`jersey.sqlite` 保存设计和订单索引。`objects/` 内的文件名使用对象键的 SHA-256，避免目录穿越并隐藏内部路径，因此工作人员不应依靠服务器文件名寻找订单 ZIP；下一阶段应通过订单后台查询并下载。

这两个位置必须一起备份。回滚应用版本时不得删除或覆盖该目录。

## 上线前仍需准备

1. 一个用于定制器的域名，例如 `customizer.example.com`，并把 DNS 解析到服务器公网 IP。
2. 非 live Shopify 测试店和 App 配置。
3. Turnstile site key 与 secret key，且只允许实际定制器域名。
4. Shopify App secret、随机生成的报价签名 secret。
5. 腾讯云防火墙放行 443；80 仅用于 HTTPS 证书签发和跳转。应用端口 8080 不对公网开放。

## 后续部署顺序

以下操作必须在代码推送和远程部署分别获得确认后执行：

1. 在服务器记录当前 Docker 状态，创建 `/opt/jersey` 版本目录和 `/opt/jersey-data` 持久化目录。
2. 上传已验证提交；复制 `.env.server.example` 为服务器私有 `.env.server` 并填入真实值。
3. 执行 `docker compose --env-file .env.server -f compose.server.yaml build`。
4. 先启动仅绑定 `127.0.0.1:8080` 的应用容器，检查 `/healthz`、日志、SQLite migration 和数据目录权限。
5. 配置 Caddy 或 Nginx HTTPS 后再从公网验证；不得开放 8080。
6. 完成后台安全下载功能后，再连接 Shopify 测试店和测试支付。

## 回滚原则

- 应用回滚：切回上一已验证镜像并重启应用容器，保留 `/opt/jersey-data`。
- 配置回滚：恢复备份的 `.env.server`，不把 secret 打印到终端历史或日志。
- 数据库 migration 只前进；出现失败时停止新版本，不执行 `DROP TABLE` 或删除 ZIP。
- 如果 HTTPS 或 Shopify 联调失败，保持旧公开站点不变，不把未验收服务切到 live 流量。

## 已知风险

- 服务器版使用 Node 24 内置 `node:sqlite`，Docker 镜像固定为 `node:24.18.0-bookworm-slim`。该 API 在 Node 24.15 后处于 release-candidate 稳定级别，部署前仍需完成容器重启、并发上传和备份恢复验证。
- 单台轻量服务器是单点；磁盘损坏或误删会影响 SQLite 与 ZIP，因此正式接单前必须建立异机或对象存储备份。
- 本阶段没有后台鉴权与下载界面，不能把 `/opt/jersey-data` 直接挂到静态网站代替后台下载。
