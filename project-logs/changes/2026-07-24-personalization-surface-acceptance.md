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

## 最终整合复核（`ea10e7b..a9592b8`）

### 可打印区域约束

- 旧行为中 `scale: 1.8` 超出球衣可打印区域时会进入完整 flat proxy；该结论现已失效。当前最终静态状态会约束为完整贴合的 decal，不再用悬浮平面掩盖越界。
- Chelsea GLB、默认位置、`rotation: 0` 的真实几何测试中，`scale: 1.8` 被约束为 `1.067578125`；缩放搜索要求文字 alpha 覆盖的 UV 命中率至少为 `0.985`。
- renderer 从 `0.55` 到用户请求值二分搜索当前表面、位置、旋转和文字 alpha 形状下的最大有效缩放，并同步选择平面、控制框和持久化状态。
- 约束后的状态 patch 使用 pending signature 去重；父状态读回前不会逐帧重复写入。
- 拖动到无有效贴合解的位置时恢复该图层上一次有效状态；不支持投射的表面、加载中状态、skinned surface 和手势预览仍保留原有 fallback。
- 最大缩放不是全局固定数值，会随表面、位置、旋转及文字 alpha 轮廓变化；当前通过实时物理约束与状态回写保持画面、控制框和保存数据一致。

### App 与 Shopify 共用控制栏 CSS

- `personalization-controls.css` 作为控制栏唯一源文件，由 App 直接 import，并由 Shopify CSS 导出脚本显式拼接。
- 生成 CSS 自动化覆盖 overlay、frame、dock、五个 44px 控件、rotate/drag/resize、disabled、窄容器布局和 Shopify 变量 fallback。
- App 桌面实测：视口与文档均为 `1908 × 942`，主页面无溢出；stage 为 `1222 × 832`，五个控件均为 `44 × 44`，旋转控件 `cursor: grab`、`touch-action: none`。
- App 移动端 `390 × 844` 实测：文档宽 `375`，stage 宽 `358`，dock 间距由 container query 收紧为 `2px`，五个控件均为 `44 × 44` 且完整位于 stage 内。
- Shopify fixture 桌面/移动实测已渲染真实 Shopify entry；计算样式读取到 `--pc3d-line: #dfd9cf`、`--pc3d-panel: #ffffff`、`--pc3d-accent: #1f6e5e`，stage 为 `container-type: inline-size`。移动端 `390 × 844` 下 section 宽 `359`、布局为单列、文档宽 `375`。

### 旋转手势事务

- 60/65 次连续 pointer move 只更新 renderer 预览；不写 configurator state，不触发 Shopify quote。
- 正常 pointerup 只提交一次最终角度；取消、lost pointer、切换图层、anchor 隐藏、mutation lock 和卸载均恢复原状态且提交次数为 0。
- 键盘方向键仍保持一次按键一次离散提交。
- Configurator 历史现已验证：一次 Undo 恢复旋转前角度，一次 Redo 恢复最终角度；这修正了此前“旋转 Undo 未测试”的记录。
- Shopify 集成现已验证：60 次移动 quote 调用为 0，释放时调用 1 次，表单序列化状态与该次 quote 使用的最终状态一致。

### 最终自动化与构建

| 检查 | 结果 |
| --- | --- |
| 旋转/页面/Shopify focused tests | 5 个文件，`139/139` 通过 |
| 全量测试 | 46 个文件，`448/448` 通过 |
| App build | 通过；CSS `17.80 kB`（gzip `3.99 kB`），JS `1,020.37 kB`（gzip `285.38 kB`） |
| Shopify bundle | 通过；`1,376.48 kB`（gzip `389.83 kB`） |
| Wrangler dry-run | 通过；14 assets，Worker upload `8.98 KiB`（gzip `2.87 KiB`），`LOCAL_PRODUCTION_FILES=true` |
| `git diff --check` | 通过 |

构建仍有既存的大 chunk 提示及 Shopify `inlineDynamicImports` ignored 提示；本轮未引入新的构建错误。

### 本轮边界与风险

- 浏览器中的长距离环形拖动来自前一轮验收，本轮未重复该手工路径；连续移动、跨象限角度、取消恢复和单次提交由 overlay/renderer/page/Shopify 自动化覆盖。
- 本轮仍未采集浏览器 GPU heap 长时曲线。
- 本轮仅完成本地实现、自动化、构建、dry-run 与桌面/移动验收；未执行部署或推送。

## 原子约束、旧设计迁移与 CSS 作用域复核（`caa8a7e..41488aa`）

### 手势约束原子提交

- renderer 的旋转与缩放结束方法现在同步返回完整 `finalItem`，其中同时包含最终 `rotation`、约束后的 `scale` 与合法 `placement`。
- ProductStage 在正常 pointer release 后只持久化一次该完整结果；renderer 的 gesture end 不再另行发送 `onStatePatch`。
- resize 的连续 pointer move 与 rotation 一样只更新 3D preview，持久化、quote 和 history 次数均为 0；release 后仅提交一次。
- placement 拖动结束也先同步求出合法最终项，再发送一次完整 transform patch，移除了 constraint patch 与 placement patch 竞态。
- 键盘旋转仍为一次按键一次提交，同时也经过相同的同步约束入口。
- 取消、lost pointer、图层切换、隐藏、mutation lock、卸载、焦点与删除链路保持原行为。

Chelsea 真实 GLB、同一文字 alpha mask、默认 front placement 的临界值：

- `rotation: 0`：最大合法 scale 为 `1.067578125`。
- 从 0° 旋转到 15°：本机真实结果为 `1.027142333984375`，测试按 `1.0271` 校验；alpha UV coverage 仍不低于 `0.985`。
- 该实测值比复审阶段的约数 `1.0261` 略高，验收以当前真实几何与 alpha 采样结果为准。

自动化证明 60/65 次 move 后 release 恰好形成一次包含 rotation、scale 和 placement 的更新；Configurator 一次 Undo 回到手势前的 rotation/scale，一次 Redo 回到完整最终结果；Shopify 同样只 quote 一次且 form state 与 quoted state 完全一致。resize 60 次 move 后只保存最终合法 scale 一条。

### 非历史 normalization

- 新增 `replaceCurrentDesignState`，只替换当前 history snapshot，不新增 Undo 节点，也不截断现有 redo 分支。
- App normalization 使用 `{ recordHistory: false, quote: false }`；placement 与 scale 不参与定价，因此复用当前 quote。
- Shopify normalization 使用 `quote: false` 即时同步 React state 与原生产品表单，不发起并行 quote。
- renderer 使用独立 `onStateNormalize` 通道；首次打开 legacy design 时，如 placement 无解，会清到默认 front placement 后重新 fit；最终支持表面上的文字保持可见。
- invalid placement JSON 的 load → normalize → save roundtrip 已验证：保存结果包含默认合法 placement 与约束 scale，初始历史仍无 Undo 节点。
- 另有 history 测试证明在已有 Undo/Redo 分支中 normalization 不截断 redo，Undo 也不会反弹到未迁移的非法 snapshot。

### 共享 CSS 作用域

- App 根节点新增 `.configurator-root`。
- `personalization-controls.css` 中所有 `.stage`、overlay、frame、dock 与 control 选择器均限定在 `:is(.configurator-root, .pc3d-section)` 下。
- `@container stage` 仍生效，窄 stage 的 dock gap 仍为 `2px`。
- App 与 Shopify 继续从同一个共享 CSS 源生成。
- fixture 负向测试已验证：配置器区块外同名 `.stage` 与 `.print-control` 不获得 container、absolute position 等关键样式；`.pc3d-section` 内对应控件仍正确命中。

### 本轮验证

| 检查 | 结果 |
| --- | --- |
| focused tests | 10 个文件，`169/169` 通过 |
| 全量测试 | 46 个文件，`457/457` 通过 |
| App build | 通过；CSS `18.44 kB`（gzip `4.02 kB`），JS `1,023.77 kB`（gzip `286.13 kB`） |
| Shopify bundle | 通过；`1,379.66 kB`（gzip `390.41 kB`） |
| Wrangler dry-run | 通过；14 files，Worker upload `8.98 KiB`（gzip `2.87 KiB`），`LOCAL_PRODUCTION_FILES=true` |
| `git diff HEAD~3..HEAD --check` | 通过 |

构建仍只有既存的大 chunk、Shopify `inlineDynamicImports` ignored 与 Wrangler proxy 提示。本轮未执行部署或推送。
