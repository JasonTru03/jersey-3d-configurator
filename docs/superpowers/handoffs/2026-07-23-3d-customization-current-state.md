# 3D 球衣定制项目当前交接

## 当前结论

截至 2026-07-23，Cloudflare Worker 上的本地生产文件链路已完成真实验收：用户保存设计、点击原生下载链接取得单个生产 ZIP、重新导入其中的设计 JSON，并把带短文件引用和精确 Atlas SHA-256 的正确 Shopify 变体加入购物车。

Horizon 原生启动器已经进入未发布主题预览。桌面位置正确，线上主题保持原状；移动端和 S/M/L/XL 参数复验完成后，再进行最小范围线上切换。

## 仓库与运行环境

- 工作分支：`codex/continuous-bottom-pattern`
- 主远程：`https://github.com/JasonTru03/jersey-3d-configurator.git`
- 备份远程：`https://github.com/SuJianben/Custom-made-jerseys.git`
- Worker：`https://jersey-3d-configurator.jason1064969838.workers.dev/`
- 当前验收版本：`5f29e35d-3db8-47cf-a1f4-a495b02d7370`
- Shopify 商店：`testcsj.myshopify.com`
- 线上主题：`152029888663`
- 线上主题备份：`152031887511`
- Horizon 原生启动器预览主题：`152059117719`

根工作树包含用户自己的 `package-lock.json`、`.superpowers/` 和交接文件改动。后续继续使用隔离工作树，不覆盖、不暂存、不提交这些内容。

## 已完成链路

### Shopify 到 Worker

- 线上启动器桌面端只出现一次，位置在尺码选择和购买控件之间。
- S/M/L/XL 分别映射到：
  - S：`48039101890711`
  - M：`48039101923479`
  - L：`48039101956247`
  - XL：`48039101989015`
- Worker 仍是独立应用；Shopify 商品页不加载 React、Three.js 或 Shopify configurator bundle。

### 生产文件

- 启用底部图案时，未生成当前生产文件会阻止加购。
- 保存后的任何设计变化会使旧凭据失效并阻止加购。
- 保存设计先准备包含 JSON 和 UV Atlas PNG 的 ZIP，再显示浏览器原生下载链接。
- 只有用户点击下载链接后才记录本次会话凭据。
- 购物车只携带文件名与 SHA-256，不携带 Blob、Data URL、完整设计 JSON、上传地址或密钥。

真实文件：

- `C:\Users\Administrator\Downloads\fn8788-jersey-production.zip`
- ZIP 大小：91,801 字节
- JSON 大小：2,839 字节
- PNG 大小：88,686 字节
- Atlas SHA-256：`cfe512b6b2d769474e00338ce2e30c821c449600a092f7b7f4ee2edecf7be878`

重新导入 JSON 已恢复 XL、底部图案 `chelsea-stripe` 和 `$93` 配置报价。

### Shopify 购物车

- 变体：`48039101989015`（XL）
- 合计：`$49.99 USD`
- `Production Files: Local ZIP download`
- `Bundle File: fn8788-jersey-production.zip`
- `Design File: fn8788-jersey-design.json`
- UV Atlas SHA-256 与提取文件一致
- 验收停在购物车，没有进入结账和下单。

## Horizon 原生启动器

新实现：

- `shopify/blocks/product-3d-configurator-launch.liquid`
- `scripts/migrate-horizon-native-launcher.mjs`
- 对应源契约和迁移测试

迁移后的 `product-details.block_order`：

```text
group_icgrde
-> divider_VJhene
-> variant_picker_R3rGDr
-> product_3d_configurator_launch
-> buy_buttons_eYQEYi
-> text_aEtTtq
```

迁移后的顶层顺序：

```text
main -> product_recommendations_qggXJq
```

预览主题读回：

- Block SHA-256：`4375302408bb72ba7eb295fed5de821eebd61be58b79b25a5db4996dbd8a60dc`
- Template SHA-256：`f1852723f530b0c7a692c3470b8c3d621e6bf94a9debc73dc153375619f82148`
- 预览地址：`https://testcsj.myshopify.com/products/custom-3d-football-jersey?preview_theme_id=152059117719`

桌面预览已确认启动器在尺码和购买控件之间，且不依赖 DOM 搬移。Theme Check 的六个 error 和四个 warning 均来自预存 Horizon 核心文件，新 block/template 没有命中。

## 下一步顺序

1. 在稳定移动端会话检查未发布主题的位置与宽度。
2. 在未发布主题逐一复验 S/M/L/XL 的 Worker `variantId` 和 `variantMap`。
3. 写入前再次读回线上 block/template 哈希。
4. 只上传原生 block 和迁移后的专用商品模板。
5. 读回线上两个文件，核对哈希、嵌套顺序和真实桌面/移动页面。
6. 旧 standalone section 先保留为未引用资产，待下一次清理。

## 验证与已知项

- Horizon 聚焦测试：2 个文件、5 个测试通过。
- 上一轮全量验证：34 个文件、214 个测试通过。
- 两个生产构建均通过。
- Vite 大 chunk 与 Shopify `inlineDynamicImports` 警告仍是已知非阻断项。
- 最终提交前重新执行 `npm test`、`npm run build` 和 `git diff --check`。
