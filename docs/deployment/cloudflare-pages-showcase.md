# Cloudflare Pages 展示站部署

## 目标

将独立 3D 定制器作为纯静态展示站发布。消费者可编辑球衣、下载本地 JSON 设计文件并重新打开它；展示站不保存设计、不调用 Shopify Cart，也不处理支付。

## 分支职责

- `codex/interactive-jersey-editor`：开发与阶段性验证分支，不直接作为公开展示站。
- `showcase`：已验收的公开展示分支。只有准备发布的提交才更新此分支。
- `main`：保持不变；本流程不合并到 `main`。

## Cloudflare Pages 配置

在 Cloudflare Dashboard 中选择 **Workers & Pages → Create application → Pages → Import an existing Git repository**，连接 GitHub 仓库 `JasonTru03/jersey-3d-configurator`，并设置：

| 设置 | 值 |
| --- | --- |
| Production branch | `showcase` |
| Build command | `npm run build:showcase` |
| Build output directory | `dist` |
| Root directory | 留空 |
| Node version | 使用平台默认版本；如构建出现兼容问题，再显式设为项目验证过的版本 |

首次部署成功后，Cloudflare 会提供 `*.pages.dev` 地址。需要自定义域名时，先在 Pages 项目中绑定域名，再修改 DNS；不要把域名直接指向某个服务器 IP。

## 发布流程

1. 在 `codex/interactive-jersey-editor` 完成代码、`npm test` 与 `npm run build:showcase` 验证。
2. 将已验证提交快进到 `showcase` 分支并推送。
3. 在 Cloudflare Pages 的 Deployments 页面确认构建成功，打开公开 URL 做浏览器验收。
4. 若发布有问题，在 Deployments 中回滚到上一份成功部署；不要强推或改写 `showcase` 历史。

## 后续边界

第二期需要服务器保存设计时，再新增受保护的 API 与图片存储；本展示站不把 Data URL、Shopify 密钥或支付信息放入环境变量或客户端代码。

## 验收

- Cloudflare 构建命令成功并发布 `dist`。
- 公开链接可加载 3D 模型，用户可修改选项、保存 JSON、重新打开 JSON。
- 确认弹层仍明确加购与付款尚未开放。
