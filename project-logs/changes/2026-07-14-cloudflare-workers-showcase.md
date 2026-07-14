# 2026-07-14 Cloudflare Workers 展示站部署修复

## 目标

修复 `showcase` 分支在 Cloudflare Workers Builds 中可以构建、但无法发布静态展示站的问题。

## 新增

- 新增根目录 `wrangler.jsonc`，以版本化配置声明 Worker 名称、兼容日期和 `dist` 静态资源目录。
- 新增 Cloudflare Workers 展示站部署说明，替换过时的 Pages 流程说明。

## 修复

- 部署日志表明 `npx wrangler deploy --assets ./dist --name jersey-3d-configurator` 缺少 `compatibility_date`。
- 现在 Wrangler 会从 `wrangler.jsonc` 读取 `compatibility_date: 2026-07-14`，不再依赖后台命令行参数来维持关键配置。

## 影响范围

- 仅影响公开展示站的 Cloudflare Workers 部署配置。
- 不修改 3D 定制器业务代码、Shopify 嵌入页、购物车、Checkout、付款或服务器设计保存。

## 自检

- `npm run build:showcase`：通过。
- `npx wrangler deploy --dry-run`：通过，已读取 `dist` 中 6 个静态文件。
- 待 Cloudflare 接收本提交后的在线构建与公开 URL 验收。

## 遗留

- Vite 仍提示主 JavaScript 包超过 500 kB；这是既有性能提示，不阻塞本次静态部署，后续性能阶段再处理。
