# 2026-07-24 Navigation, Personalize, and Cart Acceptance

## 本次目标

- 将购物者入口收敛为 `Size / Design / Fabric / Personalize / Artwork / Extras` 六项任务式菜单。
- 将模板、分区颜色和连续底部图案统一放入 Design。
- 将 player set 和可重复的 custom text 统一放入 Personalize。
- 保持桌面首屏内整件 3D 球衣居中，右侧仅编辑内容区域滚动。
- 让旧 Shopify launcher 的 surcharge map 通过确定性组合补足缺失金额。
- 完成自动化、本地 production-shaped Worker、桌面与移动端浏览器验收。

本轮起始检查点为 `89ae7a0`。本轮未执行 Cloudflare 真实部署、Git push 或 Shopify 外部购物车导航。

## 改动职责

### 配置、持久化与定价

- `config/customTextItems.js`：custom text 的标准化、计费筛选、修改、复制和数量上限。
- `config/personalizationItems.js`：player/text 统一选择键与可渲染元素选择器。
- `config/pricing.js`：每个非空 custom text 增加 `$8`。
- `designs/designDocument.js`：v3 设计文档与旧版本迁移。
- `hooks/useConfigurator.js`：保存、打开、undo/redo 和 quote-first 状态更新。

### 3D 与交互

- `scene/customTextTexture.js`：字体、填充、描边、字距和长文字适配。
- `scene/garmentRenderer.js`：player/text 共用选择、拖动和 3D 图层生命周期。
- `scene/ProductStage.jsx`：统一的选择、旋转、缩放、复制和删除编排。
- `scene/PersonalizationToolbarOverlay.jsx`：45 度旋转和直接操作工具栏。

### 页面、Review 与购物车

- `ui/PersonalizePanel.jsx`：elements-first 的 player/text 编辑器。
- `ui/ConfiguratorPage.jsx`、`ui/configurator.css`：六项菜单、固定 panel header/footer、独立滚动区和移动端布局。
- `ui/DesignReviewDialog.jsx`：订单明细、custom text、customization subtotal 和总价。
- `shopify/cartHandoff.js`：精确 surcharge 和 `$50 + $12` 等确定性组合。

## 验收中补充修复

### 关闭 player set 后仍携带遗留 Print 属性

复现：默认 state 保留旧 `PLAYER / 16` 字段，Review 显示 Player set 为 None，但生成的 cart properties 曾出现 `Print: PLAYER #16`。

处理：

- 仅 `name-number` 与 `raised-print` 两个 lighting 值启用 Print；`none` 和未知值均为空。
- Print 以 `getPrintItems(state.overrides)` 返回的第一项为唯一 normalized 真源。
- legacy 字段仅通过 `getPrintItems` 的兼容回退读取；显式 `printItems` 数组优先，包括用于压住 stale legacy 的空数组。

TDD：

- 红：`cartHandoff.test.js` 21 项中 1 项失败，实际值为 `PLAYER #16`。
- 绿：21/21 通过，最终 local URL 解码结果为 `Print: ""`、`Custom Text: "CHELSEA FC"`。
- 质量复审红：23 项中 2 项失败，分别证明 raised-print 仍读取 stale legacy、未知 lighting 仍输出 legacy。
- 质量复审绿：23/23 通过，并覆盖 none + stale legacy、name-number + legacy-only、raised-print + normalized printItems、bogus + legacy、显式空 `printItems` + stale legacy。

### 移动端图标菜单缺少可访问名称

复现：`390 × 844` 下文字标签被 CSS 隐藏后，浏览器可访问树显示六个无名称按钮。

处理：每个侧栏按钮显式加入对应 `aria-label`。

TDD：

- 红：`ConfiguratorPage.test.jsx` 24 项中 1 项失败，六个 `aria-label` 均为 null。
- 绿：24/24 通过；本地移动端浏览器回读为 Size、Design、Fabric、Personalize、Artwork、Extras。

### 缺失静态资源曾触发 Worker 500

复现：本地浏览器请求 `/favicon.ico` 时，未绑定 `env.ASSETS` 的 fallback 直接访问 `.fetch`。

处理：静态资产 binding 缺席时返回普通 404。

TDD：

- 红：`designAssets.test.js` 抛出 `Cannot read properties of undefined (reading 'fetch')`。
- 绿：9/9 通过。
- 本地 Worker HTTP 回读：`/` 为 200，入口为 `/assets/index-BnOtTodz.js`；`/favicon.ico` 为 404，Worker 日志无异常堆栈。

## 自动化与构建证据

最终新鲜验证：

| 验证 | 结果 |
| --- | --- |
| `npm test -- --run` | 41 files，332 tests，全部通过 |
| `npm run build` | app 与 Shopify bundle 均 exit 0 |
| App asset | `index-BfBRt4zi.js` 997.95 kB，gzip 278.76 kB |
| App CSS | `index-DNjnujNy.css` 16.96 kB，gzip 3.79 kB |
| Shopify bundle | 1,355.38 kB，gzip 383.66 kB |
| `npx wrangler deploy --dry-run` | Wrangler 4.114.0，14 assets，8.98 KiB / gzip 2.87 KiB，exit 0 |
| `git diff --check 89ae7a0..HEAD` | exit 0 |

构建仍显示既有的大 chunk 提示与 Shopify `inlineDynamicImports` 提示；两项均未改变 exit code。

## 桌面浏览器证据

本地地址使用 `http://127.0.0.1:8787/` 加 Shopify launch 参数，桌面 viewport 为 `1908 × 942`。

| 项目 | Size | Design | Personalize |
| --- | ---: | ---: | ---: |
| `window.innerHeight` | 942 | 942 | 942 |
| document scroll height | 942 | 942 | 942 |
| `.stage-wrap` | `(272, 84) 1224 × 834` | `(272, 84) 1224 × 834` | `(272, 84) 1224 × 834` |
| `.panel-scroll` client height | 675 | 675 | 675 |
| `.panel-scroll` scroll height | 675 | 917 | 675 |
| `.panel-checkout` | `(1513, 839) 370 × 78` | 同左 | 同左 |

补充测量：

- panel frame：`(1512, 84) 372 × 834`。
- panel header：`(1513, 85) 370 × 79`。
- `.panel-scroll` 的 `overflow-y` 为 `auto`。
- document `scrollY` 为 0。
- Size → Design → Personalize 切换时 stage 的 x、y、width、height 均保持一致，完整球衣持续居中可见。
- Design 实际包含 Jersey templates、Zone colors、Continuous bottom pattern。
- 页面未出现独立的 Colorway、Print 或 Template 菜单项。

## Custom text 真实交互

桌面浏览器执行：

1. Personalize → `+ Text`。
2. 内容设为 `CHELSEA FC`，字体设为 Block，描边保持开启，字距通过键盘设为 6。
3. 在球衣上拖动元素。
4. 点击一次 Rotate，等待 3D 更新后元素和选择框呈 45 度。
5. 从 resize handle 向外拖动，选择框由 `208 × 228` 增至 `322 × 354`。
6. Duplicate 后总价由 `$97` 变为 `$105`。
7. Delete copy 后总价回到 `$97`，焦点回到 `ul[aria-label="Personalization elements"]`。

价格链路：

- 初始 M：`$89`。
- 一个非空 custom text：`$97`。
- 两个非空 custom text：`$105`。
- 删除副本后：`$97`。

Review 桌面证据：

- `Custom text: 1 item: CHELSEA FC`。
- `Customization subtotal: $8`。
- `Total: $97`。
- dialog 为 `520 × 749`，`overflow-y: auto`。
- 初始焦点落在 Close review；Escape 关闭后焦点恢复到 Review design。

## Save / Open roundtrip

### UI 已验

- Save design 真实生成 `Download design JSON`。
- 点击链接后文件写入 `C:\Users\Administrator\Downloads\fn8788-jersey-design (2).json`，大小 2,244 bytes。
- 下载文档为 `jersey-design` v3，保存的 custom text 包含：
  - `text: CHELSEA FC`
  - `fontPreset: block`
  - `outlineEnabled: true`
  - `outlineColor: #F7F5EF`
  - `letterSpacing: 6`
  - `placement: {x: 0.1205, y: 0.2822, z: 0.3826, normal: ...}`
  - `scale: 1.7531400714795242`
  - `rotation: 45`

### 浏览器限制与代码级补证

- Chrome 扩展的 file chooser `setFiles` 连续两次返回 `Not allowed`；排查结果指向扩展未启用 “Allow access to file URLs”。第二次后停止同路径尝试。
- 下载文档经 `parseDesignDocument` → `createDesignDocument` 后 custom text 完整对象 exact equality 为 true，包含 content、font、outline、spacing、placement、scale 与 rotation。
- 原生 `input[type=color]` 弹窗不在当前 Chrome tab 截图/控制层内。一个独立 v3 seed 文档以 `#C84F3D / #F7F5EF / spacing 6 / Block` 完成 parse→resave，exact equality 为 true；颜色输入的最终 UI 手动回读留到生产验收。

## 移动端 Review 证据

viewport：`390 × 844`。

- 六项菜单均保留可访问名称。
- Review dialog：`(0, 0) 375 × 844`。
- dialog client/scroll height：`843 / 870`，`overflow-y: auto`。
- 滚到底后 `scrollTop = 27`。
- 三个操作按钮均完整进入 viewport：
  - Add to Shopify cart：bottom `715.5`
  - Save design file：bottom `767.5`
  - Continue editing：bottom `819.5`

移动端继续使用既有的普通 document flow；桌面 document lock 要求不应用于该 breakpoint。

## Local cart URL 证据

以下证据由浏览器下载的真实 v3 state 交给同一 `parseShopifyLaunch`、`calculateQuote` 和 `createCartUrl` 生成。为避免更改外部 Shopify cart，本轮未在浏览器中导航到这些 URL。

### `$8` exact surcharge

```text
https://testcsj.myshopify.com/cart/48039101923479:1,49000000000008:1
```

- base M：`48039101923479:1`
- `$8` surcharge：`49000000000008:1`
- 解码 properties：
  - `Size: m`
  - `Template: solid`
  - `Print: ""`
  - `Custom Text: CHELSEA FC`
- quote：merchandise `$89`，customization `$8`，total `$97`

### `$62` fallback

```text
https://testcsj.myshopify.com/cart/48039101923479:1,49000000000050:1,49000000000012:1
```

- base M：`48039101923479:1`
- `$50` surcharge：`49000000000050:1`
- `$12` surcharge：`49000000000012:1`
- surcharge 合计：`$62`
- properties 同样保留 `Custom Text: CHELSEA FC` 且 `Print` 为空。

## 影响范围与待生产验收

影响范围为 configurator 的菜单、Personalize、3D custom text、Review、设计文档、Shopify cart URL 与 Worker 静态 fallback。未涉及 Shopify 商品、库存、订单或主题写入。

Task 9 仍需：

- 在已开启 Chrome file URL 权限的会话或人工操作中复验 Open design 和原生颜色选择器；
- 在通过 storefront 密码页且页面稳定的会话中补验 `$97` exact cart 与 `$62 = $50 + $12` composed cart；
- 停在 checkout 之前，不创建订单。

## Task 9 生产部署与读回

### 部署检查点

- 分支：`codex/continuous-bottom-pattern`
- 部署代码提交：`8734e08d7e324524cca57633676814bdadea1114`
- 部署前状态：仅 `.superpowers/` 为未跟踪目录，未暂存、未修改。
- `npm test -- --run`：41 files，332 tests，全部通过。
- `npm run build`：app 与 Shopify bundle 均 exit 0。
- `git diff --check 89ae7a0..HEAD`：exit 0。
- 既有大 chunk 与 `inlineDynamicImports` 提示未改变构建 exit code。

### Cloudflare Worker

- Live URL：`https://jersey-3d-configurator.jason1064969838.workers.dev/`
- 新版本：`110d64b1-9eee-4d7c-b7bc-4a9807c4e09f`
- 部署时间：`2026-07-24T06:18:01.507Z`
- 回滚版本：`8f60a18e-e881-43c0-904d-fdfd77dd106d`
- cache-busting readback：`/?acceptance=20260724-1419`
- index：HTTP 200，`Content-Type: text/html`，`Cache-Control: public, max-age=0, must-revalidate`
- JavaScript：`/assets/index-BfBRt4zi.js`，HTTP 200，997,950 bytes。
- CSS：`/assets/index-DNjnujNy.css`，HTTP 200，16,968 bytes。
- favicon：`/favicon.ico`，HTTP 404，未出现旧的 Worker 500。
- 线上页面浏览器 error/warning 日志：0。

回滚命令：

```powershell
npx wrangler rollback 8f60a18e-e881-43c0-904d-fdfd77dd106d
npx wrangler deployments status --name jersey-3d-configurator
```

### 生产 Worker 浏览器验收

桌面 viewport 为 `1908 × 942`：

| 项目 | 生产读回 |
| --- | --- |
| document client/scroll height | `942 / 942` |
| scrollY | `0` |
| stage | `(272, 84) 1224 × 834` |
| panel | `(1512, 84) 372 × 834` |
| panel header | `(1513, 85) 370 × 79` |
| panel editor | `675px` high，`overflow-y: auto` |
| Design editor scroll height | `917px` |
| checkout footer | `(1513, 839) 370 × 78` |

- Size / Design / Personalize 切换时 stage 几何保持一致。
- 六菜单为 Size、Design、Fabric、Personalize、Artwork、Extras。
- Design 包含模板、Zone colors 和 Continuous bottom pattern。
- 一个 `CHELSEA FC` custom text 将价格从 `$89` 更新为 `$97`。
- Block 字体和 letter spacing 6 读回成功。
- Rotate 点击成功；Duplicate 后 `$105`；Delete 后回到 `$97`，焦点回到 Personalization elements 列表。
- Review 显示 `Custom text: 1 item: CHELSEA FC`、`Customization subtotal: $8`、`Total: $97`，初始焦点为 Close review。
- 线上 Save design file 成功生成 `Download design JSON` 原生链接。

移动 viewport 为 `390 × 844`：

- 六菜单均保留可访问名称。
- Review dialog 为 `(0, 0) 375 × 844`，client/scroll height 为 `843 / 979`，`overflow-y: auto`。
- 滚至 `scrollTop = 136` 后 Add to Shopify cart、Download design JSON、Save design file、Continue editing 均在 viewport 内。
- 移动端继续使用普通 document flow；桌面 document lock 未错误扩展到移动 breakpoint。

### Shopify live theme 与商品读回

- Store：`testcsj.myshopify.com`
- Live theme：`152029888663`，Horizon，`processing: false`
- Launcher：`sections/product-3d-configurator-launch.liquid`
- Launcher SHA-256：`7DD82A7E4A8E360D097F5014EBB9C4623146DC696B68A30F69EAF88C2CB39DBF`
- 远端 launcher 与仓库文件 byte-for-byte 相等。
- Launcher 指向稳定 Worker URL，并通过 `all_products['3d-customization-surcharge']` 动态生成 `surchargeVariantMap`。
- Live product template 仍为 `main -> product_3d_configurator_launch -> product_recommendations_qggXJq`，launcher 已启用。
- 因 live readback 已与仓库和当前 Worker URL一致，本轮未写 Shopify theme。

Admin GraphQL 读回：

- Jersey product：`9676223545495`，active，published。
- M variant：`48039101923479`，`$89`，available。
- Surcharge product：`9678531559575`，active，33 variants。
- `$8`：`48046656028823`
- `$12`：`48046656094359`
- `$50`：`48046656651415`
- `$62`：`48046656848023`

### Cart 证据与外部限制

本轮使用 live Admin 读回的真实 variant ID 生成以下生产 cart path：

- `$97` exact：`/cart/48039101923479:1,48046656028823:1`
  - quote：M `$89` + custom text `$8` = `$97`
  - properties：`Print: ""`，`Custom Text: "CHELSEA FC"`
- `$151` composed：`/cart/48039101923479:1,48046656651415:1,48046656094359:1`
  - quote：M `$89` + Player mesh `$24` + Name set `$18` + Match patch `$12` + Gift box `$8` = `$151`
  - surcharge composition：`$50 + $12 = $62`
  - properties：`Print: "PLAYER #16"`，`Extras: "giftBox, matchPatch"`

真实 storefront/cart 的当前边界：

- 公开 cart permalink 的 HTTP 读回为 302 到 `/password`。
- 新建 Chrome storefront/product 与 cart 标签显示 Shopify 的 `There was a problem loading this website`。
- 一个任务开始前已打开的真实 Shopify cart 可读回：M `$89` + exact `$62` surcharge，2 lines、每行 quantity 1、总计 `$151.00 USD`，且 `Print: PLAYER #16`、`Extras: giftBox, matchPatch`。
- 上述已打开 cart 使用 exact `$62` variant，不是本轮要求的 `$50 + $12` composed cart，也不含 `CHELSEA FC`；它只证明真实 Shopify 的 M `$89` + surcharge `$62` 总计 `$151`。
- 在上述同一真实 cart 标签中，`$97` exact cart URL 只导航一次，落到 `https://testcsj.myshopify.com/password`；DOM 显示 Shopify 法语 storefront 密码页。随后 Back 恢复原 `$151` cart。
- 同一标签中的 `$50 + $12` composed cart URL 也只导航一次，结果同样落到 storefront 密码页；随后 Back 再次恢复原 cart。本轮未继续重复这两个受限路径。
- 因此本轮 `$97` exact cart 与 `$50 + $12` composed cart 已完成真实 variant/theme/URL/properties 读回，但浏览器 line-item 验收仍标记为待补。
- checkout 未进入，未创建订单，未读取客户、支付或地址数据。

### Production Open design 最终补验

- 在生产 Worker 点击 Save design，真实下载
  `C:\Users\Administrator\Downloads\fn8788-jersey-design (3).json`。
- 文件为 1,662 bytes，`jersey-design` v3，layout 为 M。
- 生产 Open design 成功触发单文件 chooser，`isMultiple()` 为 false。
- 唯一一次 `setFiles` 调用返回 `Not allowed`，与此前 Chrome 扩展权限限制一致；本轮停止该路径。
- 后续补验需在 Chrome 扩展 Details 中启用 `Allow access to file URLs`，再选取同一 v3 文件。
