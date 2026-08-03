# 第二阶段交接：生产文件包

日期：2026-07-31  
分支：`codex/phase2-production-files`

## 交付范围

“保存设计”现在始终生成并校验一个生产 ZIP，固定包含：

1. `design.json`
2. `uv-atlas.png`
3. `uv-reference.pdf`
4. `preview-front.png`
5. `preview-back.png`
6. `manifest.json`

Atlas 使用模型声明的 `4096 × 4096` UV 尺寸。生产层会先使用快速射线投影；曲面裁剪边界的漏点只在整层低于 98.5% 覆盖率时使用近表面三角形 UV 回退。回退有严格距离上限，远离服装的坏图层仍然失败，不会静默跳过。重复顶点投影使用缓存，降低多图层导出的同步计算峰值。

保存过程具备以下状态保护：

- 生成中禁用重复保存；
- 设计变化、失败或页面卸载后不发布旧下载；
- 旧生产凭据会保留到加购校验，因此会明确提示“设计已变化”；
- 仅在用户点击下载后，底纹设计才获得可加购的本地生产文件引用。

## 代码提交

- `d3c141e`：阶段二规格
- `f7a2cbf`：阶段二实施计划
- `717315c`：生产指纹
- `445a2e3`：生产清单校验
- `c47d752`：固定六文件 ZIP
- `aab74a9`：完整 UV Atlas
- `ac6df68`：正背面生产预览
- `018cbc5`：中文 UV 参考 PDF
- `883a9c5`：生产包总编排
- `f8f1a48`：保存设计接入生产 ZIP
- `32a4eb4`：真实模型 Atlas 映射回退与投影缓存
- `27ce2fa`：图集烘焙按三角形批次主动让出主线程
- `330e574`：锁定异步图集、预览与生产包生成顺序

## 自动化验证

通过：

```powershell
npm test
# 69 个测试文件，798 项测试全部通过

npm run build:app
npm run build:shopify

npx vitest run src/features/configurator/scene/productionAtlasBaker.test.js `
  src/features/configurator/scene/productionAtlasBakerGarmentModels.test.js
# 15 项真实/合成 Atlas 映射测试通过
```

构建仅保留既有的大 JavaScript chunk 提示；没有 unresolved import 或构建失败。

## 真实浏览器证据

测试产品页：Chelsea Match Jersey（模型 `chelsea-jersey@1`）。

实际完成并导出：

- 正面与背面各一组球员姓名/号码；
- 正面与背面各一条自定义文字；
- 一个预设 Crest Badge；
- 一个透明 SVG 上传图案；
- 保存后出现 `Download production ZIP`；
- 导出的 `design.json` 重新打开后恢复 2 个球员组、2 个文字组，页面总价恢复为 `$123`。

性能优化前，同一复杂设计的单次点击在约 20 秒处超时，期间页面主线程无法及时响应。优化后，Atlas 每处理 96 个三角形主动让出主线程；真实页面测得保存点击在 279ms 内返回，生成中 DOM 响应为 19ms，保存按钮保持禁用，约 12.5 秒内重新启用并发布下载链接。

这次优化解决的是“生成期间页面卡死”，不是后台并行计算：总生成耗时没有证据表明明显缩短，Atlas、PDF 压缩和 ZIP 仍在浏览器内执行。后续如需进一步降低总耗时或承受更复杂模型，再评估 Web Worker。

下载文件：

`C:\Users\Administrator\Downloads\fn8788-jersey-design-950cdaa3 (1).zip`

离线校验：

```text
Production package verification: PASS (950cdaa3, 4096x4096, 2 PDF pages)
```

解压目录：

`C:\Users\Administrator\AppData\Local\Temp\jersey-phase2-evidence-55f5ceb7c6834b83b88fe80d439c4828`

其中：

- `manifest.json` 的五份文件长度与 SHA-256 与实际文件一致；
- `uv-atlas.png` 为 4096×4096 PNG；
- `design.json` 包含两组 print、两组 custom text、两个 artwork；
- `uv-reference-page-1.png`、`uv-reference-page-2.png` 为 PDF 渲染页；
- `uv-reference-page-2-bottom.png` 用于确认第 2 页底部警示语没有被整页预览缩放裁掉。

## 模型矩阵

| 模型 | 正面单图 | 背面单图 | 同侧自动错位双图 | 浏览器完整包 |
| --- | --- | --- | --- | --- |
| Chelsea `chelsea-jersey.glb` | PASS | PASS | PASS | PASS |
| FN8788 `fn8788-jersey.glb` | PASS | PASS | PASS | 未在浏览器页切换产品，已通过真实 GLB Atlas 回归 |

Atlas 视觉检查确认：预设徽章、上传透明图案、正背面文字和号码均出现在对应 UV 区域；透明图案未被填充成不透明背景；PDF 第 1 页中文和正背面预览清晰，第 2 页 Atlas 未裁切，底部警示语和页码可见。

## UV 裁片真实模型自动化验证（2026-08-01）

Task 6 在未修改生产 renderer 或 UV 实现的前提下，使用 `GLTFLoader` 真实读取两份受支持 GLB，并在原生 Chrome Canvas 中调用真实 `createUvPatternPieces`。测试 Atlas 同时包含正面球员组、背面球员组、自定义文字、预设 artwork 和带透明孔的上传 artwork；同一批颜色/透明像素证据会同时在 raw Atlas 与工厂裁片图中核对，不使用截图快照。

| 模型 ID / version | GLB | piece count / ids | front `mappedTriangles` / `coveragePixels` | back `mappedTriangles` / `coveragePixels` | 配置方向 |
| --- | --- | --- | --- | --- | --- |
| `chelsea-jersey@1` | `chelsea-jersey.glb` | 2 / `front`, `back` | 10,142 / 1,887 | 12,320 / 910 | front/back 均 `rotation: 0`, `mirrorX: false` |
| `fn8788-jersey@1` | `fn8788-jersey.glb` | 2 / `front`, `back` | 6,282 / 3,323 | 7,316 / 1,533 | front/back 均 `rotation: 0`, `mirrorX: false` |

稳定证据包括：每个 piece 非空且 `coveragePixels > 0`；正面设计色只出现在 `front`，背面设计色只出现在 `back`；player set、custom text、preset artwork、transparent upload 使用不同 raster 形状；front player set 另带三个非对称、有序的红/绿/蓝方形锚点。测试不再复用生产 `transformPiecePoint`，而是依据当前布局明确声明的 `rotation: 0` / `mirrorX: false` 使用独立 identity 坐标公式。三个锚点对应的 raw/output 中心 RGB 使用数组直接相等断言，不依赖目标色容差；三色 normalized coverage 使用显式绝对差并严格断言 `< 0.025`。方向方块扩大为 9×9，并从中心向顶点方向外移到 65%，避免覆盖小三角形的设计中心；实测最大差分别为 Chelsea `0.012345679012345678`、FN8788 `0.014846565585481863`，本轮全局最大值为 `0.014846565585481863`。按 mirrorX 或 180° rotation 反事实坐标采样时均为 0/3 匹配，因此能识别方向错误。两个完全重叠的可见 draw group 不会让 `mappedTriangles` 翻倍；raw Atlas 与裁片图中的上传图案中心 alpha 均为 0，裁片之间的间隔 alpha 也为 0。

TDD 记录：首次真实链路 RED 为 1 passed / 2 failed，不是缺文件或语法错误；两份 GLB 均已完成加载和裁片提取，但 1024 测试 Atlas 中过小的透明上传孔在 raw/output 中分别出现非零 alpha（Chelsea 198/42，FN8788 21/26），没有满足透明内容证据。根因是代表性上传 fixture 的孔径落入 Canvas 抗锯齿边缘，不是生产 UV 代码缺陷；将测试 Atlas 提高到 2048 并把采样点放到透明孔内部及环带中段后，raw/output 中心 alpha 均为 0，环带 alpha 为 246–255，进入 GREEN。

规格审查修复也按 TDD 执行：review RED 为 1 passed / 2 failed，明确报错“缺少可识别旋转/镜像错误的非对称像素证据”，不是加载或语法错误。GREEN 后加入独立坐标公式、不同 artwork raster、三色方向锚点、归一化 coverage 与 mirror/rotation 反事实断言；未修改生产实现。

二次规格复审继续按 TDD：新增两个负向断言后的 RED 为 3 passed / 2 failed，证明旧 helper 会接受 raw/output 每通道 RGB 漂移 1，也会接受 normalized coverage 漂移 0.03。GREEN 后对应 RGB 改为直接相等，coverage 改为显式绝对差 `< 0.025`；没有使用 `toBeCloseTo`，也没有修改生产代码。

2026-08-03 质量复审加固仍只修改测试与交接文档。Native Canvas 用例已抽到共享浏览器 helper：Windows、macOS、Linux 均会查找 Chrome/Chromium/Edge，Linux 额外覆盖 `/usr/bin/google-chrome-stable` 与 `/usr/bin/chromium-browser`；找不到浏览器时会明确抛出 `Native Canvas` 错误，核心用例不再通过 `it.skip` 静默放行。该项首次 RED 为 2 passed / 1 failed，证明旧查找结果仍返回 `null`；GREEN 后共享 helper 与两条原生 Canvas 链路统一使用 fail-closed runner。

真实模型三角形期望值不再调用生产 `collectRenderableUvTriangles`。新增测试专用独立 iterator，直接读取 position/UV/index、drawRange、可见 material group，独立执行重复顶点集合去重、非有限顶点过滤、UV 越界失败和局部 `1e-12` 退化面积过滤；源码约束同时禁止 fixture 与 oracle 引入生产收集器。固定计数为 Chelsea front `10,142` / back `12,320`、FN8788 front `6,282` / back `7,316`，任一收缩或漂移都会在启动浏览器前失败。独立性 RED 为 1 failed，oracle 行为 RED 为 1 passed / 3 failed；GREEN 后 oracle 4/4 通过。共享 GLB loader 现在返回完整 mesh 列表，Atlas 测试自行调用 `selectDecorationMeshes`，UV 裁片测试自行调用 `selectGarmentPatternMeshes`；职责拆分 RED 为 4 passed / 1 failed，随后进入 GREEN。

本轮自动化命令：

```powershell
npx vitest run src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js `
  src/features/configurator/scene/productionAtlasBakerGarmentModels.test.js `
  src/features/configurator/scene/nativeCanvasBrowserTestHelpers.test.js `
  src/features/configurator/scene/realGarmentPatternTestOracle.test.js `
  src/features/configurator/scene/uvPatternPieces.browser.test.js

npx vitest run src/features/configurator/scene src/features/configurator/designs
npx vitest run --exclude scripts/verify-production-package.test.js
npm run build
git diff --check
```

本机结果：2026-08-03 focused 5 files / 22 tests 通过；scene/designs 33 files / 562 tests 通过；排除 package verifier 的全量 77 files / 1,198 tests 通过；app 与 Shopify 构建通过；`git diff --check` 无空白错误。全量测试打印两条既有 jsdom `Not implemented: navigation to another Document` 提示；构建打印既有大 chunk 与 `inlineDynamicImports` 警告，均未造成失败。

平台限制：像素级集成测试要求能找到 Chrome、Chromium 或 Edge；可用 `CHROME_PATH` / `BROWSER_PATH` 显式指定。所有平台缺少可识别浏览器时都会失败，不再跳过 native Canvas 用例。本轮没有为 CI 新增浏览器或 Canvas 依赖。

### 真实 in-app WebGL 浏览器验收（2026-08-03）

主代理在 `http://127.0.0.1:4178/` 的真实 in-app WebGL 页面完成 Chelsea 验收。页面标题为 Chelsea Match Jersey，实际加载模型为 `chelsea-jersey.glb`；页面 `productId` 仍为 `fn8788-jersey`，因此导出文件名前缀仍是 `fn8788-jersey`，但第二轮 ZIP 的 `manifest.json` 明确记录模型为 `chelsea-jersey@1`。本轮只记录该身份差异，没有修改生产代码。

第一轮使用包含正背面徽章、文字和号码的复杂设计，导出文件为：

`C:\Users\Administrator\Downloads\fn8788-jersey-design-001e2b3e.zip`（4,182,480 bytes）

ZIP 中七个文件齐全：`design.json`、`uv-atlas.png`、`uv-pattern-pieces.png`、`uv-reference.pdf`、`preview-front.png`、`preview-back.png`、`manifest.json`。正面 Crest 只出现在正面，背面 Roundel 只出现在背面；Atlas/pieces 均包含 front/back 两块大裁片及透明分隔。由于徽章遮挡了文字和号码，第二轮删除全部徽章后重新导出，以便单独核对文字与 player set 的正背面方向和隔离。

第二次点击 Save design 后，按钮的 `disabled` attribute 立即变为 `''`；约 6,919ms 后恢复为 `null`，并出现 Download production ZIP。第二轮文件为：

`C:\Users\Administrator\Downloads\fn8788-jersey-design-693aeaa8.zip`（3,276,791 bytes）

解包目录：

`C:\Users\ADMINI~1\AppData\Local\Temp\uv-text-export-be3d755751d644c58776dcf0411dd774`

第二轮七文件同样齐全。`preview-front.png` 只显示 `FRONT` 自定义文字；`preview-back.png` 只显示 player set 的姓名 `FRONT` 与号码 `11`。`design.json` 中 front custom text 的 `placement` 为 `null`，由默认规则落在正面；player set 的 `printPlacement.normal.z` 为 `-1`，对应背面；`decorations` 为空。`manifest.json` 记录 `chelsea-jersey` version `1`、4096×4096，pieces 为 `front` / `back`，`mappedTriangles` 分别为 `10,142` / `12,320`，两者均为 `rotation: 0`、`mirrorX: false`，裁片之间保持透明分隔。

`uv-atlas.png` 与 `uv-pattern-pieces.png` 的设计内容一致，后者沿 front/back 两块 seam 轮廓重新排布。平铺 UV 中的文字看起来倒置或反向，属于模型 UV 岛本身的朝向；缝合到 `preview-front.png` / `preview-back.png` 后方向正确，不能把 raw UV 的视觉方向误记为用户可见的镜像缺陷。

浏览器页面没有切换到 `fn8788-jersey.glb` 的入口，因此 FN8788 尚无同等的 in-app WebGL ZIP 视觉证据；其 Task 6 证据仍是 native Canvas 中真实加载 FN8788 GLB 的集成测试。该限制已明确保留，不能将 Chelsea 页面验收外推为 FN8788 浏览器验收。

已知接缝边界：当前布局只声明每个模型的主身 `front` / `back` mesh，不覆盖袖片、领片、侧片等未声明裁片；输出不是工厂 CAD 纸样，仍不包含缝份、放码、对位标记或裁片编号。自动化 fixture 的 `coveragePixels` 是代表性设计内容的非透明像素数，不是整块 UV 岛面积。

状态：Task 6 已完成两份真实 GLB 的 native Canvas 自动化、Chelsea 真实 in-app WebGL 双轮 ZIP 验收与交接记录；FN8788 的 in-app WebGL 页面验收受产品切换入口限制，仍以真实 GLB 集成测试为证据。真实 ZIP 路径为 `C:\Users\Administrator\Downloads\fn8788-jersey-design-001e2b3e.zip` 与 `C:\Users\Administrator\Downloads\fn8788-jersey-design-693aeaa8.zip`。仍未 push、未 merge、未发布、未部署。Task 6 任务前回滚点为 `ebf6b6b2efe79639bb6d65e901dcead1509757af`；本次浏览器证据记录前检查点为 `5841f50e19f1d280a4a62938571753df980baace`。

## 生产边界与回滚

PDF 与 Atlas 是 UV 生产参考和数据交换文件，不是工厂 1:1 裁片文件；不包含纸样裁片、放码、缝份或裁片编号。

本阶段没有加入 R2、订单关联、Shopify 订单文件卡片或后台模型管理。  
阶段一 Worker 回滚目标：`810543ff-bdd0-4d3d-a42f-d454161cf7b5`。
