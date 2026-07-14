# 2026-07-14 Cloudflare Workers 展示站交接

## 结论

Cloudflare 已能从 `showcase` 分支成功执行 `npm run build:showcase`；失败发生在 Wrangler 部署阶段，而不是项目构建阶段。

## 根因与决策

- Cloudflare 日志明确提示缺少 `compatibility_date`。
- 当前账户创建的是 Cloudflare Worker，而不是 Pages 项目，因此部署文档统一为 Workers Static Assets。
- 使用根目录 `wrangler.jsonc` 保存 Worker 名称、兼容日期和静态目录，避免后台命令行配置与 Git 版本脱节。

## 本次范围

- 新增 `wrangler.jsonc`。
- 将部署说明改为 Cloudflare Workers 流程。
- 未改动产品功能、Shopify、付款、购物车、服务器或数据存储。

## 验证与下一步

- 本地展示构建和 Wrangler 离线部署预检均通过。
- 推送至 `showcase` 后，在 Cloudflare **Deployments** 打开最新构建，确认 Build 与 Deploy 都为绿色；随后打开 `workers.dev` 地址做页面验收。
