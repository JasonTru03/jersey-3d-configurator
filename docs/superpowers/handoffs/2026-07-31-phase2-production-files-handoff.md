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
| `chelsea-jersey@1` | `chelsea-jersey.glb` | 2 / `front`, `back` | 10,142 / 1,592 | 12,320 / 910 | front/back 均 `rotation: 0`, `mirrorX: false` |
| `fn8788-jersey@1` | `fn8788-jersey.glb` | 2 / `front`, `back` | 6,282 / 2,849 | 7,316 / 1,533 | front/back 均 `rotation: 0`, `mirrorX: false` |

稳定证据包括：每个 piece 非空且 `coveragePixels > 0`；正面设计色只出现在 `front`，背面设计色只出现在 `back`；player set、custom text、preset artwork、transparent upload 使用不同 raster 形状；front player set 另带三个非对称、有序的红/绿/蓝方形锚点。测试不再复用生产 `transformPiecePoint`，而是依据当前布局明确声明的 `rotation: 0` / `mirrorX: false` 使用独立 identity 坐标公式。三个锚点在 raw Atlas 与 piece 中的中心 RGB 全部精确一致，三色归一化 coverage 最大偏差小于 0.025；按 mirrorX 或 180° rotation 反事实坐标采样时均为 0/3 匹配，因此能识别方向错误。两个完全重叠的可见 draw group 不会让 `mappedTriangles` 翻倍；raw Atlas 与裁片图中的上传图案中心 alpha 均为 0，裁片之间的间隔 alpha 也为 0。

TDD 记录：首次真实链路 RED 为 1 passed / 2 failed，不是缺文件或语法错误；两份 GLB 均已完成加载和裁片提取，但 1024 测试 Atlas 中过小的透明上传孔在 raw/output 中分别出现非零 alpha（Chelsea 198/42，FN8788 21/26），没有满足透明内容证据。根因是代表性上传 fixture 的孔径落入 Canvas 抗锯齿边缘，不是生产 UV 代码缺陷；将测试 Atlas 提高到 2048 并把采样点放到透明孔内部及环带中段后，raw/output 中心 alpha 均为 0，环带 alpha 为 246–255，进入 GREEN。

规格审查修复也按 TDD 执行：review RED 为 1 passed / 2 failed，明确报错“缺少可识别旋转/镜像错误的非对称像素证据”，不是加载或语法错误。GREEN 后加入独立坐标公式、不同 artwork raster、三色方向锚点、归一化 coverage 与 mirror/rotation 反事实断言；未修改生产实现。

本轮自动化命令：

```powershell
npx vitest run src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js `
  src/features/configurator/scene/productionAtlasBakerGarmentModels.test.js

npx vitest run src/features/configurator/scene src/features/configurator/designs
npx vitest run --exclude scripts/verify-production-package.test.js
npm run build
git diff --check
```

本机结果：focused 2 files / 9 tests 通过；scene/designs 31 files / 551 tests 通过；排除 package verifier 的全量 75 files / 1,187 tests 通过；app 与 Shopify 构建通过；`git diff --check` 无输出。全量测试仍打印两条既有 jsdom `Not implemented: navigation to another Document` 提示；构建仍打印既有大 chunk 与 `inlineDynamicImports` 警告，均未造成失败。

平台限制：像素级集成测试会优先使用本机已安装的 Chrome/Edge，并在 Windows 上明确要求能找到浏览器；非 Windows 环境若没有可识别浏览器路径则跳过 native Canvas 用例。本轮没有为 CI 新增浏览器或 Canvas 依赖。

视觉验收仍待主代理在真实页面执行，不能标记为已通过：分别切换 `chelsea-jersey@1` 与 `fn8788-jersey@1`，生成生产 ZIP，对照 `uv-atlas.png` 与 `uv-pattern-pieces.png` 检查正背面文字/号码只落入对应裁片、裁片轮廓符合接缝、文字无镜像、透明间隔存在，并保存可追溯的导出或截图路径。

已知接缝边界：当前布局只声明每个模型的主身 `front` / `back` mesh，不覆盖袖片、领片、侧片等未声明裁片；输出不是工厂 CAD 纸样，仍不包含缝份、放码、对位标记或裁片编号。自动化 fixture 的 `coveragePixels` 是代表性设计内容的非透明像素数，不是整块 UV 岛面积。

状态：Task 6 仅完成本地测试与交接记录，未 push、未发布、未部署。任务前回滚点为 `ebf6b6b2efe79639bb6d65e901dcead1509757af`；如需撤销本轮，可回到该提交并移除本节及真实模型测试辅助文件。

## 生产边界与回滚

PDF 与 Atlas 是 UV 生产参考和数据交换文件，不是工厂 1:1 裁片文件；不包含纸样裁片、放码、缝份或裁片编号。

本阶段没有加入 R2、订单关联、Shopify 订单文件卡片或后台模型管理。  
阶段一 Worker 回滚目标：`810543ff-bdd0-4d3d-a42f-d454161cf7b5`。
