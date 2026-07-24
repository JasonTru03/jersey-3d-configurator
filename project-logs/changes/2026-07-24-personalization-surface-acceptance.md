# 2026-07-24 个性化贴合、旋转与删除验收记录

## 本轮目标

- 验证自定义文字在球衣正面、斜侧、侧面和背面的表面贴合表现。
- 验证拖动旋转跨越 `±180° / ±360°` 时方向连续，工具栏位置和命中区域稳定。
- 验证 Personalize 列表垃圾桶、3D 删除、焦点、报价、Review 与 Shopify cart 数据保持一致。
- 验证桌面 `1908 × 942` 与移动 `390 × 844` 布局，以及保存、打开、撤销、重做和重复增删回归。

验收起始实现范围为 `ef1d0f6..50d811c`。浏览器验收中发现并修复最后一个 Player 删除后付费选项仍保留的问题，修复提交为 `429a5c1`。本轮只在本地 Worker 和测试 Shopify cart 执行验收，尚未部署新的 Cloudflare 生产版本，也未 push。

## 本地环境与版本

- 分支：`codex/continuous-bottom-pattern`
- 最终验收代码：`429a5c1`
- 本地 Worker：`http://127.0.0.1:51031/`
- 启动命令：`npx wrangler dev --port 51031 --local`
- Wrangler：`4.114.0`
- 本地端口与旧 `51030` 分离，构建后重启 Worker 并重新加载页面。

## 自动化与构建

| 验证 | 结果 |
| --- | --- |
| 本轮 focused tests | 12 files / 227 tests，通过 |
| 报价修复 focused tests | 5 files / 77 tests，通过 |
| 最终 `npm test` | 45 files / 444 tests，通过 |
| `npm run build` | app 与 Shopify bundle 均 exit 0 |
| App JS | `index-CwZim2MB.js`，1,017.83 kB，gzip 284.68 kB |
| App CSS | `index-Dne0ljHx.css`，17.65 kB，gzip 3.91 kB |
| Shopify bundle | 1,373.93 kB，gzip 389.14 kB |
| `npx wrangler deploy --dry-run` | 14 assets，8.98 KiB / gzip 2.87 KiB，exit 0 |
| `git diff --check` | exit 0 |

构建仍显示既有大 chunk 与 Shopify `inlineDynamicImports` 提示，两项均未改变 exit code。

## 桌面浏览器验收（1908 × 942）

### 首屏与滚动

- document 与 body 均为 `1908 × 942`，无主页面纵向滚动。
- `.stage-wrap` 为 `(272, 84) 1224 × 834`，整件 3D 球衣居中可见。
- 右侧编辑区域保持独立布局；桌面没有恢复成整页上下滚动。

### 曲面贴合

真实执行 `Personalize → Add text` 后绕模型观察：

- 正面：文字紧贴胸前，没有旧版整块平面悬空。
- 左右斜侧与侧面：文字随胸部曲面收窄，边缘没有脱离衣服形成明显空隙。
- 背面：前胸文字被球衣正确遮挡，没有穿透到背面。
- 常规缩放没有裁半；极大范围和跨衣片覆盖由 `personalizationDecal`、Chelsea seam 与 garment renderer 自动化用例覆盖。

### 拖动旋转与工具栏

- 使用真实鼠标圆形路径完成顺时针 2 整圈、逆时针 2 整圈。
- 四圈均跨越全角度，未出现约 45° 后反向旋转。
- 每次释放后 `is-dragging` 清除，终点角度保持稳定。
- 另用精确 45° 终点路径验证软吸附释放。
- Edit、Rotate、Duplicate、Delete 与 Resize 五个 44px 控件均读取真实 DOM rect，并通过 `elementFromPoint(center).closest('button')` 命中自身。
- 侧面窄 AABB 下五个按钮仍位于 stage 内；旋转过程中 dock 使用冻结坐标，自动化覆盖 pointer capture、item 切换、隐藏和取消场景。

## 列表垃圾桶、3D 删除与报价修复

### 已通过链路

- 删除未选中文字：Player 选择保持，目标 Text 从列表和 3D 消失，总价按 `$8` 回落。
- 删除选中 Player：选择清空，焦点回到 Personalization elements 列表。
- 3D Delete Player：3D toolbar 消失，焦点回到 Orbit view。
- 删除 pending 时写控件禁用、Orbit 保持可用，由 `usePersonalizationDeletion`、PersonalizePanel 与 ProductStage 自动化覆盖。

### 验收中发现并修复的明确问题

复现：

1. Base M `$89`。
2. 添加 Text 后 `$97`。
3. 添加 Player 后 `$115`。
4. 从列表删除最后一个 Player，列表和 3D 均消失，但总价仍停在 `$115`。

根因：删除最后一个 `printItems` 时没有关闭付费 `lighting=name-number`。

TDD 修复：

- 先新增失败测试，要求最后一个 Player 删除 patch 同时写入 `lighting: none`。
- 3D 删除集成测试新增 `$89` 报价回落断言。
- `getPersonalizationRemovalPatch` 只在 `nextItems.length === 0` 时关闭 Player 付费选项；多 Player 删除仍保留当前付费类型。

浏览器复验：

- 列表删除最后一个 Player：`$115 → $97`，只保留 Text。
- 3D 删除最后一个 Player：`$115 → $97`，toolbar 消失，焦点回 Orbit。

## 移动端浏览器验收（390 × 844）

- 页面实际内容宽 375px，无横向溢出。
- 移动端沿用响应式纵向 document flow；stage 为 `343 × 420`。
- Text 的 Edit、Rotate、Duplicate、Delete 与 Resize 五个按钮全部在 stage 和 viewport 内，中心点均真实命中按钮。
- 将文字拖到左上边界后，dock 为 `left 25 / right 213`，仍在 stage `16..359` 内，且不遮挡 stage 顶部工具。
- 右上方向同样保持完整可点。
- Duplicate：1 条 `$97` → 2 条 `$105`。
- Undo：回到 1 条 `$97`；Redo：恢复 2 条 `$105`。
- Resize 手势可开始、更新并正常释放。

## Save / Open / Review

### Save

- 点击 Save design 后生成 `Download design JSON` blob 链接。
- 真实下载文件：`C:\Users\Administrator\Downloads\c4299d53-4ed9-42b3-aed7-d6a97458d849.json`
- 文件大小：2,613 bytes。

### Open

- 保存后将页面清空到 0 条、`$89`，再触发 Open design 原生单文件 chooser。
- 当前 Chrome 扩展的 `fileChooser.setFiles` 返回 `Not allowed`；环境提示需在扩展详情启用 `Allow access to file URLs`。
- 当前会话未形成 UI 回读证据；设计文档解析、v3 roundtrip 和状态恢复由现有自动化覆盖。

### Review

2 个 Text 的 Review 实测结果：

- `Custom text: 2 items: YOUR TEXT, YOUR TEXT`
- `Customization subtotal: $16`
- `Total: $105`
- `Shopify cart total: $105`

## Shopify 实际购物车验收

使用当前已打开生产 configurator 的真实 Shopify launch query，在本地 `51031` 页面建立 1 个 Text：

- Configurator Total：`$97`
- Review customization subtotal：`$8`
- Review Shopify cart total：`$97`
- Add to Shopify cart：enabled，并已真实点击。

Shopify cart 实际结果：

- URL 进入 `https://testcsj.myshopify.com/cart?...`
- 购物车总计：`$97.00 USD`
- Surcharge line：`3D Customization Surcharge`，Amount `8`，`$8.00`
- Jersey line：`Custom 3D Football Jersey`，M，`$89.00`
- properties：
  - `Size: m`
  - `Template: solid`
  - Colors 与当前球衣配置一致
  - `Custom Text: YOUR TEXT`
- 验收后依次移除 surcharge 与 jersey，购物车状态读回 `0`，页面显示购物车为空。

## Console 与重复增删

- 本地 standalone configurator 与本地 Shopify-context configurator 在加购前均无新增 console error/warning。
- Shopify cart 页面出现 3 条 Chrome 扩展 inspector 对 blob XHR `responseText` 的错误，来源为 `chrome-extension://.../inspector.js`，不来自 configurator 或 storefront 业务脚本。
- 在 Shopify-context configurator 中连续执行 10 次 `Add text → Delete text-2`：全部完成。
- 循环前后 canvas 均为 1、列表均为 1、总价均为 `$97`；循环后无 alert、无残留 frame/dock。
- Three.js geometry/material/texture dispose 与 selected-only rebuild 另由 garment renderer 自动化覆盖；本轮未采集浏览器 GPU heap 曲线。

## 未验项与遗留风险

- Open design 的 UI 文件回读仍受当前 Chrome 扩展 file URL 权限限制；启用对应权限后应复验同一 JSON 文件。
- 未做浏览器 GPU heap 长时采样；已有 10 次 DOM/价格/画布稳定性证据和自动化 dispose 证据。
- 移动端本身采用纵向页面流；桌面“首屏无主页面滚动、右侧独立滚动”已通过。
- 本轮尚未部署新的 Cloudflare Worker，生产仍保持上一版本。
