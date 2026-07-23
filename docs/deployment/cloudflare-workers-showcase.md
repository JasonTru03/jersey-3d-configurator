# Cloudflare Workers 展示站部署

## 目标

将独立 3D 定制器作为静态 Worker 发布。用户可以编辑球衣、下载本地 JSON 设计文件和底部图案 UV Atlas PNG、重新打开 JSON，并在带有有效 Shopify 启动参数时加入购物车；Worker 不保存设计，也不处理付款。

## 分支职责

- `codex/interactive-jersey-editor`：开发与阶段性验证分支，不直接作为公开展示站。
- `showcase`：已经验收的公开展示分支。只有准备发布的提交才更新此分支。
- `main`：保持不变；此流程不合并到 `main`。

## Cloudflare Workers 配置

在 Cloudflare Dashboard 选择 **Workers & Pages → Create application → Import a repository**，连接 GitHub 仓库 `JasonTru03/jersey-3d-configurator`，再设置：

| 设置 | 值 |
| --- | --- |
| Production branch | `showcase` |
| Build command | `npm run build:showcase` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |
| Builds for non-production branches | Disabled |

根目录的 `wrangler.jsonc` 负责声明 Worker 名称、`compatibility_date` 和 `dist` 静态资源目录。当前生产配置显式设置 `LOCAL_PRODUCTION_FILES=true`，且不声明 R2、KV 或 Turnstile 变量，因此 R2 尚未开通时也可直接部署。不要在 Cloudflare 后台重复填写 `--assets` 或 `--name`，以免后台配置与版本化配置分叉。

在该模式中，`/api/design-assets*` 统一返回 `503` 和 `Design asset storage is unavailable in LOCAL_PRODUCTION_FILES mode.`；这避免静态启动、下载和加购链路隐式依赖 R2、KV 或 Turnstile。静态资源请求仍由 `env.ASSETS.fetch()` 服务。

首次部署成功后，Cloudflare 会提供 `*.workers.dev` 地址。需要自定义域名时，在 Worker 的 **Domains** 中绑定域名，再按 Cloudflare 指示配置 DNS；不要把域名直接指向某台服务器 IP。

## 发布流程

1. 在发布分支完成代码，运行 `npm test`、`npm run build:showcase` 和 `npx wrangler deploy --dry-run`。
2. 将已验证提交快进到 `showcase` 并推送。
3. 在 Cloudflare Worker 的 **Deployments** 页面确认构建和部署均成功，再打开公开 URL 验收编辑、下载 JSON/PNG，以及从 Shopify 启动链接加入购物车。
4. 发布有问题时，在 **Deployments** 中回滚到上一份成功版本；不要强推或改写 `showcase` 历史。

## 后续边界

未来启用服务器设计保存时，先按 `design-asset-write-access.md` 创建 R2、KV 和 Turnstile，再将 `LOCAL_PRODUCTION_FILES` 设为 `false` 并添加对应绑定；本展示站不把 Data URL、Shopify 密钥或支付信息放进环境变量或客户端代码。

## 验收

- Cloudflare 构建命令成功，并通过 Wrangler 发布 `dist`。
- 公开链接可加载 3D 模型，用户可修改选项、保存 JSON 和 UV Atlas PNG，并重新打开 JSON。
- 从有效 Shopify 启动链接可将摘要属性加入购物车；设计文件保持本地下载。
- `GET`、`POST` 和 Atlas 读取的设计资产 API 都返回明确的本地文件模式不可用响应。
