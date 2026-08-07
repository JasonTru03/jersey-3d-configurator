# 2026-08-07 独立订单后台与安全下载

## 目标

为腾讯云单店服务器增加独立商家后台，使工作人员能在支付回调关联订单后，按订单查找并安全下载对应生产 ZIP。

## 新增

- `/admin/` 中文订单后台，支持订单号/设计编号搜索、状态筛选、日期筛选、分页、刷新和退出。
- scrypt 后台密码哈希、HMAC 签名八小时会话 Cookie、五分钟登录限流和安全响应头。
- 仅展示 `ADMIN_SHOP` 中已绑定 Shopify 订单的设计，未付款草稿不会进入后台列表。
- 通过鉴权接口流式下载 ZIP；下载前核对记录、文件名、字节数和 SHA-256 索引。
- 文件缺失、文件异常和订单不存在的明确提示；异常文件不显示或返回伪下载。
- `admin_download_audit` 下载审计表，记录店铺、设计、时间和 `started/missing/invalid` 结果，不记录顾客隐私。
- `npm run admin:credentials` 随机生成一次性登录密码、scrypt 哈希和会话签名密钥。

## 修改范围

- `server/admin/`：鉴权、订单查询、下载处理、静态后台页面、凭据生成和测试。
- `migrations/0003_admin_download_audit.sql`：只增下载审计表与索引。
- `server/config.js`、`server/runtime.js`：读取后台私有配置并将 `/admin` 接入服务器运行时。
- `.env.server.example`、`package.json`、部署文档：增加安全配置和生成命令。

## 验证

- 后台专项和真实 SQLite/磁盘对象集成测试通过。
- 全量测试：98 files / 1,471 tests passed。
- `npm run build`、`npm run build:showcase` 和 `npx wrangler deploy --dry-run` 通过。
- 实际浏览器检查了桌面订单表、移动端筛选与横向表格、登录页、错误密码提示和空订单状态。
- `node --check` 与 `git diff --check` 通过。

## 风险与遗留

- 当前是单店独立密码后台，不是 Shopify OAuth 或 Shopify Admin Block。
- 后台 Cookie 强制 HTTPS；域名、证书、真实配置和服务器新镜像仍未部署。
- 下载审计记录表示下载流已经开始，不代表客户端最终完整保存文件。
- 单机 SQLite 与磁盘仍是单点，正式接单前需要建立异机备份与恢复演练。
