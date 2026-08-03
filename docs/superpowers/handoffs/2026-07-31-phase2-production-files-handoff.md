# 第二阶段交接：生产文件包

日期：2026-07-31
发布收口更新：2026-08-03
当前本地分支：`codex/uv-pattern-pieces-clean`

> 发布证据边界：原分支 `codex/uv-pattern-pieces` 夹带了不属于本 UV 范围的 Shopify form ownership / 结账链路。当前发布候选已在本地从 `0a0bd1c` 重建为纯 UV 分支，并排除全部 Shopify 提交。本文下方列出的既有浏览器 ZIP、解包目录和 preview 均生成于方向与外观覆盖修复之前，只能作为 pre-fix 历史证据，不能继续作为最终视觉通过证据。

## 交付范围

“保存设计”现在始终生成并校验一个生产 ZIP，固定包含：

1. `design.json`
2. `uv-atlas.png`
3. `uv-pattern-pieces.png`
4. `uv-reference.pdf`
5. `preview-front.png`
6. `preview-back.png`
7. `manifest.json`

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
- `c8f5709`：将两模型 front/back 工厂裁片方向改为 `rotation: 180`、`mirrorX: true`
- `543ce0c`：补齐 back 裁片独立方向证据
- `0216c55`：将 `appearanceGroups` 与 `pieceGroups` 分离并覆盖全部外观网格
- `acbe882`：修正袖底、袖口等外观网格的 sleeves 区域归属

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
| Chelsea `chelsea-jersey.glb` | PASS | PASS | PASS | PRE-FIX ONLY；需重新导出 |
| FN8788 `fn8788-jersey.glb` | PASS | PASS | PASS | 未在浏览器页切换产品；最终浏览器证据待补 |

旧 Atlas 视觉检查只能确认预设徽章、上传透明图案、正背面文字和号码进入了对应 UV 区域，以及 PDF/透明度/页码等结构表现；它没有证明工厂裁片方向和全部外观网格覆盖正确。后续复审确认旧裁片文字存在垂直翻转，且下摆/侧面出现黑块，因此该浏览器完整包结论已被 release-fix 取代，不能外推为最终视觉 PASS。

## UV 裁片真实模型自动化验证（2026-08-01）

Task 6 在未修改生产 renderer 或 UV 实现的前提下，使用 `GLTFLoader` 真实读取两份受支持 GLB，并在原生 Chrome Canvas 中调用真实 `createUvPatternPieces`。测试 Atlas 同时包含正面球员组、背面球员组、自定义文字、预设 artwork 和带透明孔的上传 artwork；同一批颜色/透明像素证据会同时在 raw Atlas 与工厂裁片图中核对，不使用截图快照。

| 模型 ID / version | GLB | piece count / ids | front `mappedTriangles` / `coveragePixels` | back `mappedTriangles` / `coveragePixels` | 配置方向 |
| --- | --- | --- | --- | --- | --- |
| `chelsea-jersey@1` | `chelsea-jersey.glb` | 2 / `front`, `back` | 10,142 / 1,887 | 12,320 / 910 | front/back 均 `rotation: 180`, `mirrorX: true` |
| `fn8788-jersey@1` | `fn8788-jersey.glb` | 2 / `front`, `back` | 6,282 / 3,323 | 7,316 / 1,533 | front/back 均 `rotation: 180`, `mirrorX: true` |

稳定证据包括：每个 piece 非空且 `coveragePixels > 0`；正面设计色只出现在 `front`，背面设计色只出现在 `back`；player set、custom text、preset artwork、transparent upload 使用不同 raster 形状。方向修复后的真实 GLB 用例在 Chelsea 与 FN8788 的 front/back 四个裁片上分别放置非对称、有序像素证据，独立按 `rotation: 180`、`mirrorX: true` 计算预期位置；identity、仅 mirror、仅 rotation 三条反事实路径都会被拒绝，不能用正片结果替代背片方向证明。三个锚点对应的 raw/output 中心 RGB 使用数组直接相等断言，不依赖目标色容差；normalized coverage 使用显式绝对差并严格断言 `< 0.025`。两个完全重叠的可见 draw group 不会让 `mappedTriangles` 翻倍；raw Atlas 与裁片图中的上传图案中心 alpha 均为 0，裁片之间的间隔 alpha 也为 0。

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

本机结果：2026-08-03 focused 5 files / 22 tests 通过；scene/designs 33 files / 562 tests 通过；排除 package verifier 的全量 77 files / 1,198 tests 通过；app 与 Shopify 构建通过；`git diff --check` 无空白错误。全量测试打印两条既有 jsdom `Not implemented: navigation to another Document` 提示；构建打印既有大 chunk 与 `inlineDynamicImports` 警告，均未造成失败。这些结果早于 `c8f5709`、`543ce0c`、`0216c55`、`acbe882` 四个 release-fix 提交，不能写成当前 clean 分支的最终全量发布验证；四个修复已有 focused/agent 定向验证证据，最终全量命令仍由主代理重新执行和记录。

平台限制：像素级集成测试要求能找到 Chrome、Chromium 或 Edge；可用 `CHROME_PATH` / `BROWSER_PATH` 显式指定。所有平台缺少可识别浏览器时都会失败，不再跳过 native Canvas 用例。本轮没有为 CI 新增浏览器或 Canvas 依赖。

### 真实 in-app WebGL 浏览器验收（2026-08-03，pre-fix 历史证据）

主代理曾在 `http://127.0.0.1:4178/` 的真实 in-app WebGL 页面完成 Chelsea 导出。页面标题为 Chelsea Match Jersey，实际加载模型为 `chelsea-jersey.glb`；页面 `productId` 仍为 `fn8788-jersey`，因此导出文件名前缀仍是 `fn8788-jersey`，但第二轮 ZIP 的 `manifest.json` 明确记录模型为 `chelsea-jersey@1`。这两轮导出均发生在 release-fix 之前，本节只保留历史复现与文件身份信息，不再给出最终视觉通过结论。

第一轮使用包含正背面徽章、文字和号码的复杂设计，导出文件为：

`C:\Users\Administrator\Downloads\fn8788-jersey-design-001e2b3e.zip`（4,182,480 bytes）

ZIP 中七个文件齐全：`design.json`、`uv-atlas.png`、`uv-pattern-pieces.png`、`uv-reference.pdf`、`preview-front.png`、`preview-back.png`、`manifest.json`。正面 Crest 只出现在正面，背面 Roundel 只出现在背面；Atlas/pieces 均包含 front/back 两块大裁片及透明分隔。由于徽章遮挡了文字和号码，第二轮删除全部徽章后重新导出，以便单独核对文字与 player set 的正背面方向和隔离。

第二次点击 Save design 后，按钮的 `disabled` attribute 立即变为 `''`；约 6,919ms 后恢复为 `null`，并出现 Download production ZIP。第二轮文件为：

`C:\Users\Administrator\Downloads\fn8788-jersey-design-693aeaa8.zip`（3,276,791 bytes）

解包目录：

`C:\Users\ADMINI~1\AppData\Local\Temp\uv-text-export-be3d755751d644c58776dcf0411dd774`

第二轮七文件同样齐全。`preview-front.png` 只显示 `FRONT` 自定义文字；`preview-back.png` 只显示 player set 的姓名 `FRONT` 与号码 `11`。`design.json` 中 front custom text 的 `placement` 为 `null`，由默认规则落在正面；player set 的 `printPlacement.normal.z` 为 `-1`，对应背面；`decorations` 为空。旧 `manifest.json` 当时记录 `chelsea-jersey` version `1`、4096×4096，pieces 为 `front` / `back`，`mappedTriangles` 分别为 `10,142` / `12,320`，两者均为 `rotation: 0`、`mirrorX: false`。该值正是已被 `c8f5709` 更正的 pre-fix 配置，不代表当前 clean 分支；当前两模型 front/back 均为 `rotation: 180`、`mirrorX: true`。

旧 `uv-atlas.png` 与旧 `uv-pattern-pieces.png` 的设计内容来自同一份 Atlas，后者沿 front/back 两块 seam 轮廓重新排布。后续复审已确认旧工厂裁片图中的文字是垂直翻转，而不是可以忽略的 raw UV 视觉现象；旧图同时暴露下摆/侧面黑块。`preview-front.png` / `preview-back.png` 的 3D 方向正确不能证明工厂裁片图方向正确，因此旧 ZIP 和 preview 不得继续作为 release-fix 后的最终视觉证据。

浏览器页面没有切换到 `fn8788-jersey.glb` 的入口，因此 FN8788 尚无同等的 in-app WebGL ZIP 视觉证据；其 Task 6 证据仍是 native Canvas 中真实加载 FN8788 GLB 的集成测试。该限制已明确保留，不能将 Chelsea 页面验收外推为 FN8788 浏览器验收。

已知接缝边界：`pieceGroups` 仍只生成 `front` / `back` 两个 factory pieces；输出不是工厂 CAD 纸样，仍不包含缝份、放码、对位标记或裁片编号。基础外观不再受这两个 factory pieces 限制：独立 `appearanceGroups` 已覆盖 Chelsea 19 个、FN8788 16 个可渲染服装 mesh，并将袖底、袖口归入 `sleeves`。每个被配置 mesh 若没有有效 UV 会 fail closed，不会以黑块或默认填充伪装成功。自动化 fixture 的 `coveragePixels` 是代表性设计内容的非透明像素数，不是整块 UV 岛面积。

发布前状态（历史）：两份真实 GLB 的 native Canvas 方向与覆盖 focused 证据已更新；本节两份 Chelsea ZIP 只保留为 pre-fix 复现材料。FN8788 仍没有同等 in-app WebGL 页面导出，Chelsea 也必须在四个 release-fix 提交后重新导出。当时 clean 分支尚未 push、merge、发布或部署。

### 七文件生产包回归与发布检查点（2026-08-03，结构证据）

Task 7 将离线 CLI verifier 从旧六文件契约升级为严格七文件契约，顺序固定为：`design.json`、`uv-atlas.png`、`uv-pattern-pieces.png`、`uv-reference.pdf`、`preview-front.png`、`preview-back.png`、`manifest.json`。`manifest.json` 必须为六个非 manifest 文件声明精确 byte length 与 SHA-256；`uv-atlas.png` 和 `uv-pattern-pieces.png` 都必须是 4096×4096 PNG。生产 PNG 标准明确限定为 8-bit RGBA（`bitDepth: 8`、`colorType: 6`）、`compression: 0`、`filter: 0`、非交错（`interlace: 0`）；palette、Adam7 及其他编码 fail closed。PNG 检查会遍历完整 chunk 边界，使用 Node `crc32` 校验每个 chunk 的 type+data CRC：首块必须是 length 13 的唯一完整 IHDR、宽高为正数，连续 IDAT 必须非空并能由 `inflateSync` 解压，所有拼接后的 IDAT 压缩字节都必须被同一 zlib stream 消费，合法 zlib stream 后的尾随垃圾也会 fail closed；解压长度必须精确等于 4096 行 RGBA scanline，且每行 filter byte 只能为 0–4；最终必须是 CRC 正确的零长度 IEND，不能截断或在 IEND 后追加伪记录。裁片声明必须包含非空布局指纹、尺寸匹配的非空 pieces，并以不同 id 包含 `front` / `back`；每个裁片的 `label`、`zone`、`order`、`islandRefs`、`sourceMeshes`、`mappedTriangles`、source/output bounds、`rotation`、`mirrorX`、`scale`、`coveragePixels`、`aliases`、`duplicateGroup` 均按生产 manifest 契约校验，source mesh 必须与 island refs 一致，id/order 不得重复。缺失文件、CRC 或 IHDR 编码错误、IDAT 非 zlib/解压长度错误/未消费尾随字节/scanline filter 非法、长度/哈希不匹配、尺寸不匹配及缺失、空、重复或不完整裁片声明都会 fail closed。

最终规格收口继续按 TDD 执行：合法 fixture 使用 `deflateSync` 生成真实 zlib 压缩的 RGBA8 scanline，并为 IHDR、IDAT、IEND 写入真实 CRC32。payload 安全 RED 为 1 file / 40 tests，其中 7 failed / 33 passed；7 项均明确显示结构-only verifier 对 IHDR CRC、IEND CRC、`bitDepth: 0`、`compression: 1`、非 zlib IDAT、解压长度不匹配和非法 scanline filter byte“未抛错”。资源压力收口继续以两次默认 `npm test` 的 native Canvas Chrome `ETIMEDOUT` 为全量 RED，并新增声明校验顺序 focused RED：1 file / 41 tests，其中 2 failed / 39 passed，分别证明旧 verifier 会先解码无效 Atlas、且未在解码前拒绝 pattern/Atlas 声明尺寸不一致。GREEN 后，14 个纯 PNG parser 负向用例改为直接调用已导出的 `readPngSize` 并使用 2×2 真实 zlib fixture；完整 manifest 声明校验移到两张4K PNG inflate 之前，实际 PNG 尺寸仍在解码后核对。focused 最终为 1 file / 41 tests passed，测试体耗时由约 5.4s 降至约 1.1s。尾随压缩数据收口继续新增直接调用 `readPngSize` 的 2×2 真实 zlib 反例：RED 为 1 file / 42 tests，其中 1 failed / 41 passed，新增用例因旧 verifier 错误通过合法 stream 后的 3 个垃圾字节而报“未抛错”；使用 `inflateSync(..., { info: true })` 的 `engine.bytesWritten` 核对完整拼接输入后，focused GREEN 为 42/42。2026-08-03 的完整验证结果：

```powershell
npx vitest run scripts/verify-production-package.test.js
# 1 file / 42 tests passed，exit 0

npm test
# 2026-08-03 11:51:25，默认并行模式，78 files / 1,240 tests passed，Duration 56.01s，exit 0

npm run build
# app 与 Shopify production build 均完成，exit 0

npm run build:showcase
# showcase build 完成，exit 0

npx wrangler deploy --dry-run
# 读取 dist 中 7 个静态资产，并列出既有 DESIGN_QUOTES KV、两项 rate-limit binding 与环境变量，exit 0

node scripts/verify-production-package.mjs C:\Users\Administrator\Downloads\fn8788-jersey-design-001e2b3e.zip
# PASS (001e2b3e, 4096x4096, 2 PDF pages)，精确七文件

node scripts/verify-production-package.mjs C:\Users\Administrator\Downloads\fn8788-jersey-design-693aeaa8.zip
# PASS (693aeaa8, 4096x4096, 2 PDF pages)，精确七文件
```

全量测试仍打印两条既有 jsdom navigation 提示。优化前，纯 parser/package 负向用例与 manifest 负向用例会反复触发 Atlas+pieces 4K RGBA inflate，与 native Canvas Chrome 并发造成资源争抢；两次默认全量分别出现 2 项和 1 项 `ETIMEDOUT`，失败文件隔离重跑为 7/7 通过，串行全量仅作为根因诊断证据。资源压力优化后，尾随压缩数据修复的首次默认全量仍在本轮 Vite PID 28048 及 in-app WebGL 验收标签页保持运行时出现 2 项 Chrome `spawnSync ... ETIMEDOUT`；关闭仅属于本轮任务的 in-app WebGL 标签页和 Vite PID 28048 精确进程树后，用户已有 Chrome/Edge 保持运行，新鲜原始 `npm test` 于 2026-08-03 11:51:25 在默认并行模式完成 1,240/1,240，Duration 56.01s，exit 0。该结果说明最终门槛在清理本轮验收资源后通过，并不表示 verifier 代码本身可以消除所有外部浏览器资源争抢；最终门槛也未使用串行参数。Vite 仍打印大 chunk 与 Shopify `inlineDynamicImports` 警告；Wrangler dry-run 还打印代理环境提示，并由 `npx` 临时取得 Wrangler 4.118.0。两个真实 ZIP 使用 payload verifier 的单包耗时分别约 599ms 与 449ms，未发现不可接受的内存或性能问题。最终要求的命令均为 exit 0，没有新增依赖、secret 或 binding。

上述旧 ZIP 的 verifier PASS 只证明七文件结构、哈希、PNG/PDF payload 和 manifest 契约在当时成立，不证明修复后的工厂裁片方向或全 mesh 外观覆盖。以下为发布前边界记录：七文件格式当时只是本地生产产物契约变更，必须取得用户明确发布批准后才能部署。代码侧回退方式是对 feature merge 执行普通 `git revert`；Cloudflare 则使用 deployment rollback 回到上一已知正常版本。实际发布结果见后文“生产发布结果”。

### UV release-fix 收口（2026-08-03）

发布候选不再使用原 `codex/uv-pattern-pieces` 分支。该分支夹带 Shopify form ownership / 结账链路，已在本地以 `0a0bd1c` 为基线重建 `codex/uv-pattern-pieces-clean`，只保留 UV 裁片范围的提交；此句记录的是生产发布前状态。

本轮 release-fix 包含：

- 方向：`c8f5709` 与 `543ce0c` 将 Chelsea、FN8788 的 front/back 全部固定为 `rotation: 180`、`mirrorX: true`，并让两模型正背片各自使用非对称像素证据；identity、仅 mirror、仅 rotation 都必须失败。
- 外观覆盖：`0216c55` 与 `acbe882` 将用于基础外观烘焙的 `appearanceGroups` 与用于工厂裁片输出的 `pieceGroups` 分离。Chelsea 19 个、FN8788 16 个服装 mesh 均被外观组覆盖，袖底/袖口归入 `sleeves`；任何配置 mesh 缺少有效 UV 都 fail closed。
- 工厂输出边界：`pieceGroups` 仍保持 `front` / `back` 两片，不把外观 mesh 分组误写成新增 CAD 裁片，也不新增缝份、放码、对位标记或裁片编号。
- 验证状态：四个修复已有 focused/agent 定向验证；本文档收口不把此前全量结果或旧浏览器 ZIP 写成当前分支的最终 PASS。最终全量测试、构建、真实浏览器导出与视觉检查仍待主代理执行。

#### 发布前验收清单（已于 2026-08-03 执行）

以下是 release-fix 收口时留下的检查清单；Chelsea 浏览器导出和最终命令已由后续小节完成。FN8788 因页面没有模型切换入口，仍保留 native Canvas 自动化证据边界。

- 在当前 `codex/uv-pattern-pieces-clean` HEAD 上重新执行主代理规定的全量测试、构建和发布前检查，并记录命令、时间、计数与 exit code。
- 用真实浏览器重新导出修复后的 Chelsea ZIP；如果产品入口允许，再补 FN8788 同等 ZIP。不要复用本文列出的两个旧 ZIP。
- 检查新 `manifest.json` 中两模型 front/back 方向均为 `rotation: 180`、`mirrorX: true`。
- 目视检查新 `uv-pattern-pieces.png` 与 PDF 裁片页：文字不再垂直翻转，下摆/侧面不再出现黑块，front/back 内容隔离且透明间隔保持正确。
- 核对基础外观在 Chelsea 19 个、FN8788 16 个服装 mesh 上无遗漏，尤其检查袖底、袖口、肩侧、下摆和领口；缺失有效 UV 时应明确失败。
- 发布、push、merge 或 deploy 前必须再次取得用户明确确认。

#### Release-fix 后真实浏览器验收（2026-08-03）

主代理在 clean 分支 `f4840e3` 之后进行真实 WebGL 验收时，首次发现基础外观画布虽按生产 Atlas 坐标使用 `y = 1 - v` 绘制，运行时 `CanvasTexture` 却仍为 `flipY = false`。结果是模型采样垂直镜像位置，正面下摆与侧片出现大块黑色，分区色只落到偶然重叠区域。控制台没有运行时异常；这是坐标约定不一致，不是 GLB 缺面或 `appearanceGroups` 漏 mesh。

修复只调整 `garmentRenderer.js` 中模型加载和后续外观更新两个运行时入口，将 appearance texture 固定为 `flipY = true`；生产 Atlas 及 factory piece 坐标保持不变。TDD RED 为 1 file / 2 failed，两个失败都明确收到 `false` 而期望 `true`；GREEN 为 1 file / 2 passed。硬刷新后的 Chelsea WebGL 页面中，正面与背面主身完整着色，袖子分区为红色，领口分区为金色，旧版下摆/侧面大片黑块消失。窄黑色袖口/领口背面及侧缝内侧来自双面模型的内侧/背光面，不是透明 Atlas 缺片；生产 Atlas 中对应袖口/袖底为已绘制红色 UV 岛。

由于 in-app Browser 只能通过局域网 IP 访问本地 Vite，页面不处于 secure context，点击 Save design 会明确显示“此浏览器不支持 SHA-256”。随后改用 Chrome 访问 `http://localhost:4182/`，重新设置四区配色、正面 `FRONT` 自定义文字和背面 `FACTORY / 18` player set，成功生成并下载：

`C:\Users\Administrator\Downloads\fn8788-jersey-design-07f60cd8.zip`（3,872,784 bytes）

页面标题仍为 Chelsea Match Jersey，`manifest.json` 的 `model.id` 为 `chelsea-jersey`、version `1`；文件名前缀和 `productId` 仍沿用既有 `fn8788-jersey` 产品 ID。该命名差异未在本阶段改动。

新 ZIP 的真实验收结果：

- 精确七文件：`design.json`、`uv-atlas.png`、`uv-pattern-pieces.png`、`uv-reference.pdf`、`preview-front.png`、`preview-back.png`、`manifest.json`。
- CLI verifier：`PASS (07f60cd8, 4096x4096, 2 PDF pages)`。
- `preview-front.png` 正面完整且只显示 `FRONT`；`preview-back.png` 背面完整且只显示 `FACTORY / 18`，无 release-fix 前的大块黑色缺片。
- `uv-pattern-pieces.png` 放大裁片后，正片 V 领朝上且 `FRONT` 正向可读；背片领窝朝上且 `FACTORY / 18` 正向可读。两片之间保持透明间隔。
- `manifest.json` 中 front/back 均为 `rotation: 180`、`mirrorX: true`，mapped triangles 分别为 `10,142` / `12,320`，coveragePixels 分别为 `4,194,130` / `3,659,805`。
- `uv-reference.pdf` 由 Poppler 实际渲染为两页 A4 横向页面。第 1 页正背预览、产品/颜色/指纹信息清晰；第 2 页裁片方向和文字清晰，无裁切、重叠、乱码或黑块。

当前页面仍没有切换到 `fn8788-jersey.glb` 的入口，因此 FN8788 的发布证据仍限于真实 GLB native Canvas 自动化，不伪造同等浏览器 ZIP 证据。浏览器验收结束后已释放 Chrome 标签页并停止本轮 Vite 服务，再在相同代码 HEAD 上执行发布门槛：package verifier tests 1 file / 42 passed；默认 `npm test` 76 files / 1,096 passed；`npm run build`、`npm run build:showcase`、`npx wrangler deploy --dry-run` 与新 ZIP CLI verifier 均 exit 0。全量仍打印两条既有 jsdom navigation 提示；构建仍打印既有大 chunk 与 Shopify `inlineDynamicImports` 警告；Wrangler 仅打印代理环境提示。当时 push、merge、release、deploy 仍等待用户明确确认。

#### 生产发布结果（2026-08-03）

- 用户明确批准发布后，`codex/uv-pattern-pieces-clean` 已快进合入 `showcase`；发布提交为 `0d4ac9c8b2e22507d007f3c32eee75c034d81f85`。
- `showcase` 已以 fast-forward 推送到 `origin` 与 `backup`，未强推、未改写历史；clean 功能分支与 worktree 已在合并验证后清理。
- Cloudflare Worker `jersey-3d-configurator` 新版本 `211c1c5d-b6f8-4860-b77e-a41c30823678` 已接管 100% 流量。发布前版本/即时回滚点为 `a5a075aa-438a-46d7-8e7d-f6b950836768`。
- `211c1c5d-b6f8-4860-b77e-a41c30823678` 是代码发布版本；后续仅文档的发布记录提交可能触发内容等价的新部署，最终流量版本以 `wrangler deployments status` 为准。
- 公开地址：`https://jersey-3d-configurator.jason1064969838.workers.dev/`。
- 合并后的隔离全量测试为 76 files / 1,096 tests passed；clean release worktree 的 `npm run build:showcase` 与 `npx wrangler deploy --dry-run` 均 exit 0，dry-run 读取 7 个静态资源。
- 公网首页、JS、CSS 与 Chelsea GLB 均返回 HTTP 200；JS、CSS、GLB 的 SHA-256 分别与本次 release worktree 的 `dist` 产物完全一致。
- in-app Browser 真实打开公网地址后，标题为 `3D Product Configurator`，页面显示 `Chelsea Match Jersey`，594×610 WebGL canvas 与 Chelsea 球衣模型正常渲染，浏览器错误/警告日志为空。
- 本次未修改 Shopify live theme、商品、订单、价格、支付、Cloudflare binding、KV 数据或 secret；无计划停机。
- 如需回滚 Worker：`npx wrangler rollback a5a075aa-438a-46d7-8e7d-f6b950836768`，随后用 `npx wrangler deployments status --name jersey-3d-configurator` 确认旧版本恢复 100% 流量。

## 生产边界与回滚

PDF 与 Atlas 是 UV 生产参考和数据交换文件，不是工厂 1:1 裁片文件；不包含纸样裁片、放码、缝份或裁片编号。

本阶段没有加入 R2、订单关联、Shopify 订单文件卡片或后台模型管理。  
阶段一 Worker 回滚目标：`810543ff-bdd0-4d3d-a42f-d454161cf7b5`。
