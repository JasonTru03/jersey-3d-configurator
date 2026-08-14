# 腾讯云轻量应用服务器部署说明

## 当前状态

腾讯云轻量应用服务器已完成从本机验证到公网测试环境的部署。当前代码分支为 `codex/admin-order-download`，部署提交为 `fab9f47`，Docker 镜像标签为 `jersey-3d-configurator-server:fab9f47`。应用容器只绑定 `127.0.0.1:8080`，由 Nginx 对外反向代理；容器健康检查、SQLite migration、数据库重启持久化和私有磁盘对象重启持久化均已通过。

测试服务器信息：

- 系统：Ubuntu 24.04 LTS。
- 公网地址：`139.199.202.173`。
- 公网入口：`https://139.199.202.173/`。
- Shopify App 固定公开入口：`https://jersey-3d-configurator.jason1064969838.workers.dev/`（Cloudflare Worker 反向代理到腾讯云）。
- 独立订单后台：`https://139.199.202.173/admin/`。
- 持久化目录：`/opt/jersey-data`。
- 应用目录：`/opt/jersey/app`。

Nginx 已接管 80/443，服务器本机经 HTTPS 反向代理访问 `/healthz` 返回 `{"ok":true}`，公网后台入口也已完成浏览器访问。当前使用 Let's Encrypt 签发的短期 IP 地址证书；Certbot 自动续期定时器已启用，`certbot renew --dry-run --run-deploy-hooks` 已通过，续期后会先校验 Nginx 配置再 reload。

独立后台订单列表和安全下载已部署。后台使用 scrypt 密码哈希、八小时签名 Cookie、登录限流和下载审计；浏览器已完成登录、空订单列表和未登录返回 401 验收。后台密码、哈希、会话密钥及 Shopify secret 均只保存在服务器私有配置中，不写入仓库或本文档。

Shopify 测试环境也已建立，但尚未联通：

- 开发测试店：`Jersey Configurator Test`。
- 店铺域名：`jersey-configurator-test.myshopify.com`。
- 测试店套餐：Basic，创建时启用了测试数据。
- Dev Dashboard App：`Secure Jersey Configurator`，App 记录 ID 为 `408595562497`。
- App 已创建，但项目专用版本尚未配置或发布，也尚未安装到测试店。
- 服务器当前 `ADMIN_SHOP` 与 `SHOPIFY_STORE_CONFIG_JSON` 仍使用脱敏占位店 `example.myshopify.com`，不得据此发起测试支付或 webhook 验收。

本运行时复用现有生产草稿、报价、App Proxy 和 Shopify webhook 业务规则：

- `/api/production-drafts` 接收生产文件声明和流式上传。
- 生产 ZIP 与 manifest 写入服务器私有磁盘。
- SQLite 保存上传状态、设计报价、订单关联、webhook 幂等记录和限流计数。
- `/healthz` 供 Docker 和反向代理检查服务状态。
- `/admin/` 供已授权工作人员查询已付款定制订单并下载生产 ZIP。

## 服务器数据位置

建议固定使用：

```text
/opt/jersey-data/jersey.sqlite
/opt/jersey-data/objects/
```

`jersey.sqlite` 保存设计和订单索引。`objects/` 内的文件名使用对象键的 SHA-256，避免目录穿越并隐藏内部路径，因此工作人员不应依靠服务器文件名寻找订单 ZIP；下一阶段应通过订单后台查询并下载。

这两个位置必须一起备份。回滚应用版本时不得删除或覆盖该目录。

## 备份检查点

部署后台前已创建服务器本机备份目录：

```text
/opt/jersey/backups/20260810-pre-admin-fab9f47/
```

备份包含部署提交记录、容器镜像标识、私有 `.env.server` 副本、`/opt/jersey-data` 归档及 SHA-256 校验文件。第一次归档因容器仍占用 SQLite 文件而未生成；随后使用“停止旧容器、归档、启动旧容器”的流程重新执行，归档可被 `tar -tzf` 读取，容器恢复健康。不要删除该备份，也不要把其中的 `.env.server` 下载到不安全位置。

## Shopify 联调下一步

下一阶段从 `docs/superpowers/handoffs/2026-08-10-shopify-test-app-handoff.md` 继续。推荐顺序：

1. 在 `shopify-app/` 使用 Shopify CLI 把本地项目链接到已创建的 `Secure Jersey Configurator`，生成测试环境专用且不提交的配置文件。
2. 以 `https://139.199.202.173` 为测试服务器基址，核对 App URL、App Proxy、Webhook URI、Webhook API `2026-07`、所需权限范围以及 `embedded` 设置；当前服务器没有 `/auth/callback`，不能把占位回调地址当作已实现能力。
3. 经单独确认后发布 App 测试版本，使两个 Shopify Functions、App Proxy 与订单生命周期 webhook 配置生效。
4. 将 App 安装到 `jersey-configurator-test.myshopify.com`，确认实际 granted scopes。
5. 在测试店创建球衣与附加价商品，记录真实产品/variant ID；不要使用现有占位 ID。
6. 备份服务器配置后，将 `ADMIN_SHOP` 和 `SHOPIFY_STORE_CONFIG_JSON` 改为测试店真实映射，并安全写入 App secret 与报价签名 secret；该步骤需要单独批准和容器重启批准。
7. 先验证上传、App Proxy 报价、加购和 Shopify 测试支付，再核对 `orders/paid` 关联、后台订单出现以及生产 ZIP 下载。不得连接 live 店或真实支付。

## 固定 workers.dev 入口发布顺序

公开 App 不再把裸 IP 或临时 `trycloudflare.com` 地址写进 Shopify 配置。发布固定入口时必须按以下顺序，避免 OAuth 回调和 App Proxy 在切换期间指向不同运行时：

1. 备份当前腾讯云镜像、私有 `.env.server`、SQLite 与对象目录，并记录当前 Cloudflare Worker 版本。
2. 将腾讯云私有配置中的 `PUBLIC_ORIGIN` 改为 `https://jersey-3d-configurator.jason1064969838.workers.dev`，部署包含 OAuth、多店配置和隐私 Webhook 的候选镜像。
3. 在服务器本机和裸 IP HTTPS 上验证 `/healthz`；此时不切换 Shopify 流量。
4. 部署根目录 `wrangler.jsonc`，让同名 Worker 全量反向代理到 `https://139.199.202.173`。
5. 依次验证固定入口的 `/healthz`、配置器静态资源、OAuth、App Proxy、生产草稿上传、测试结账和订单后台。
6. 验证失败时先回滚 Cloudflare Worker 到上一版本，再恢复腾讯云上一镜像和 `.env.server`；始终保留 `/opt/jersey-data`。

## 多店订单后台

2026-08-12 起，本地服务器代码支持在同一个独立后台中切换多个 Shopify 店铺：

- `ADMIN_SHOP` 继续作为登录后的默认店铺，兼容现有部署。
- `SHOPIFY_STORE_CONFIG_JSON` 的每个顶层店铺域名都会成为后台允许选择的店铺。
- 订单查询和 ZIP 下载均由服务端校验店铺白名单，并继续用 `shop` 作为数据库条件，禁止跨店读取。
- 后台一次只展示一个店铺，不提供跨店混合列表。
- 每个店铺仍必须安装同一个 App、具有所需订单权限、启用 webhook，并配置各自真实的商品与 variant 映射。

把该版本部署到腾讯云前，必须先备份当前镜像、私有 `.env.server`、SQLite 与对象目录。随后只在私有 `.env.server` 的 `SHOPIFY_STORE_CONFIG_JSON` 中加入新店映射；可以把 `ADMIN_SHOP` 改为希望默认显示的店铺。无需数据库 migration。构建并切换新镜像后重启容器，再验证 `/healthz`、后台登录、店铺切换、`#1001` 查询和 ZIP 下载。

如验证失败，恢复备份的 `.env.server` 和上一镜像后重启容器；不得删除 `/opt/jersey-data`。多店代码不会自动补写在 webhook 未启用期间产生的历史订单。

## 回滚原则

- 应用回滚：切回上一已验证镜像并重启应用容器，保留 `/opt/jersey-data`。
- 配置回滚：恢复备份的 `.env.server`，不把 secret 打印到终端历史或日志。
- 数据库 migration 只前进；出现失败时停止新版本，不执行 `DROP TABLE` 或删除 ZIP。
- 如果 HTTPS 或 Shopify 联调失败，保持旧公开站点不变，不把未验收服务切到 live 流量。

## 已知风险

- 服务器版使用 Node 24 内置 `node:sqlite`，Docker 镜像固定为 `node:24.18.0-bookworm-slim`。该 API 在 Node 24.15 后处于 release-candidate 稳定级别，部署前仍需完成容器重启、并发上传和备份恢复验证。
- 单台轻量服务器是单点；磁盘损坏或误删会影响 SQLite 与 ZIP，因此正式接单前必须建立异机或对象存储备份。
- 当前 HTTPS 依赖短期 IP 地址证书和自动续期；正式接单前仍建议绑定稳定域名，并重新完成证书、Turnstile hostname 与公网回归。
- Shopify App 当前只有 Dev Dashboard 创建记录，项目版本、权限、Functions、App Proxy 和 webhook 尚未发布，也未安装到测试店。
- 服务器仍映射 `example.myshopify.com`。在改为真实测试店映射并验证之前，后台空订单属于预期状态，不代表订单联调已经完成。
- 当前已实现的独立后台使用 scrypt 密码哈希和八小时签名 Cookie，但不是 Shopify OAuth。后续增加 Shopify Admin Block 时仍需单独实施 Shopify 管理员身份授权。
- 后台登录 Cookie 强制 `Secure`，因此正式浏览器验收必须先完成 HTTPS；不能为了临时访问而取消该安全属性。
