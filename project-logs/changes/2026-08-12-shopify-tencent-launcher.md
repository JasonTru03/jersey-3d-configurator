# 2026-08-12 Shopify 3D 启动入口切换腾讯云

## 结果

- 测试商店：`testcsj-secure-bundle.myshopify.com`。
- live 主题：`Horizon`，theme ID `141064339543`。
- 商品：`Custom 3D Football Jersey`，product ID `7714291155031`。
- 商品页 `Start 3D customization` 已从旧 Cloudflare Worker 切换为 `https://139.199.202.173/`。
- 尺码 variant、附加费 variant map、商店、商品 handle 与 `returnPath=/cart` 参数全部保留。

## 根因与改动

最初发现 live 主题 Section 仍包含旧 Worker 地址，因此同步更新了：

- `shopify/sections/product-3d-configurator-launch.liquid`
- `shopify/sections/product-3d-configurator-launch.test.md`

随后真实页面检查发现当前可见按钮实际来源不是 Section，而是 Shopify 商品描述中的内联 HTML。最终在 Shopify 后台仅替换商品描述中唯一一处旧域名，未修改标题、价格、库存、变体、状态或样式。

## 验证

- Shopify CLI `4.5.2` Theme Check：347 个文件，0 个问题。
- 重新拉取 live 主题后，远程 Section SHA-256 与发布文件一致。
- 商品保存后后台显示无未保存更改，描述中仅存在腾讯云地址。
- 店铺商品页按钮 href 已验证为腾讯云地址。
- 点击按钮后成功打开 `https://139.199.202.173/`，页面标题为 `3D Product Configurator`。
- 未保存设计、未加购、未结账。

## 备份与回滚

- live 主题原始文件备份：`project-logs/backups/2026-08-12-tencent-theme-launch-before/`。
- 商品描述原始 HTML：`project-logs/backups/2026-08-12-product-description-before.html`。
- 主题副本仍保留：`Horizon 的副本`，theme ID `141069877335`。
- 回滚商品入口时，将商品描述恢复为上述 HTML 备份即可。

## 注意事项

使用旧全局 Shopify CLI `3.91.1` 创建未发布主题时，因不兼容新版 Horizon schema 产生了带错误的未发布主题 `Horizon Tencent 20260812`（theme ID `141335527511`）。该主题未发布、未设为 live，不影响店铺；后续可经用户确认后删除。
