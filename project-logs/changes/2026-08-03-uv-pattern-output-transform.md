# 2026-08-03 UV 裁片输出变换验证记录

## 状态

**本地验证通过、未发布：修正版真实生产包的结构、Manifest、哈希、测试、构建和固定视觉验收均通过。**

首轮真实包的 BLOCKED 失败记录继续保留在下文作为历史证据。本轮最终验证只更新并提交本验证日志，没有修改生产代码；没有 push、merge、deploy 或 Shopify 发布。

## 首轮 BLOCKED 历史：日期与版本

- 日期：2026-08-03
- 验证分支：`codex/uv-pattern-output-transform`
- 验证起点 HEAD：`65699d48b0fbf1f733ce2499578e3898e9125496`
- 生产包 Schema：`manifest.schemaVersion = 2`
- UV 导出版本：`manifest.uvExportVersion = "2"`
- 裁片布局指纹：`uv-pieces-v2-e5f46651`
- 设计指纹：`6ac2cd02`

## 本次目标

- 验证 UV 裁片输出变换的完整测试、构建和 Wrangler dry-run。
- 在 localhost secure context 中通过真实浏览器制作不对称设计并下载真实七文件生产 ZIP。
- 校验 ZIP 结构、PNG 尺寸、PDF 页数、Manifest、SHA-256，并实际查看生产图和 PDF 第 2 页。
- 不改生产代码；如真实视觉发现缺陷，保留证据并阻止发布。

## 实际根因

当前两个模型的 `pieceGroups.front` / `pieceGroups.back` 已经各自配置：

```json
{ "rotation": 180, "mirrorX": true }
```

这组每片变换等价于一次垂直翻转，原发布记录中的真实包已证明它能把领口和文字翻到正确方向。本分支又为同一模型新增全局：

```json
{ "patternOutputTransform": { "rotation": 180, "mirrorX": true } }
```

`createUvPatternPieces()` 在完成既有每片方向处理后，再通过 `applyPatternOutputTransform()` 对整张输出应用相同的垂直翻转。两次相同翻转互相抵消，真实 `uv-pattern-pieces.png` 最终回到源 UV 的错误朝向：领口朝下，正背文字上下倒置，前胸徽章也上下颠倒。Manifest 只证明声明和结构一致，现有自动化 oracle 也没有阻止这次真实视觉回归。

## 修改范围

- 新增：`project-logs/changes/2026-08-03-uv-pattern-output-transform.md`
- 未修改生产代码、测试、配置、依赖、构建产物或用户 Downloads 中既有文件。
- 浏览器生成的新 ZIP 和唯一临时解包目录作为验收证据保留，不清理。

## 定向测试

命令：

```text
npx vitest run src/features/configurator/config/modelUvLayouts.test.js src/features/configurator/scene/uvPatternOutputTransform.test.js src/features/configurator/scene/uvPatternPieces.test.js src/features/configurator/scene/uvPatternPieces.browser.test.js src/features/configurator/scene/realGarmentPatternTestOracle.test.js src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js src/features/configurator/designs/productionPackage.test.js src/features/configurator/designs/productionManifest.test.js src/features/configurator/designs/productionFingerprint.test.js scripts/verify-production-package.test.js
```

结果：exit 0，10 个测试文件、261 个测试全部通过。

覆盖的精确文件：

1. `src/features/configurator/config/modelUvLayouts.test.js`
2. `src/features/configurator/scene/uvPatternOutputTransform.test.js`
3. `src/features/configurator/scene/uvPatternPieces.test.js`
4. `src/features/configurator/scene/uvPatternPieces.browser.test.js`
5. `src/features/configurator/scene/realGarmentPatternTestOracle.test.js`
6. `src/features/configurator/scene/uvPatternPiecesGarmentModels.test.js`
7. `src/features/configurator/designs/productionPackage.test.js`
8. `src/features/configurator/designs/productionManifest.test.js`
9. `src/features/configurator/designs/productionFingerprint.test.js`
10. `scripts/verify-production-package.test.js`

## 完整验证

### `git diff showcase...HEAD --check`

- 起始工作区 clean。
- exit 0，无空白错误。

### `npm test`

- 首次完整执行期间，`ShopifyConfiguratorSection.test.jsx` 的 `quotes and syncs the Shopify form once after a many-move rotation gesture` 报告 1 个失败；该次工具等待窗口结束前没有保留最终汇总，因此不把首轮写成通过。
- 同一用例单独重跑：exit 0，1 passed / 17 skipped。
- 新鲜完整重跑：exit 0，77 个测试文件、1,153 个测试全部通过，耗时 52.19 秒。
- 非阻塞既有提示：两条 `Not implemented: navigation to another Document`。

### `npm run build`

- exit 0。
- app：1,753 modules transformed，构建成功。
- Shopify：1,738 modules transformed，构建成功并导出 CSS。
- 警告：主 JS chunk 超过 500 kB；Shopify 构建提示 `inlineDynamicImports option is ignored because codeSplitting: false is set`。

### `npm run build:showcase`

- exit 0，1,753 modules transformed。
- 警告：主 JS chunk 超过 500 kB。

### `npx wrangler deploy --dry-run`

- exit 0，Wrangler 4.118.0。
- 读取 `dist` 中 7 个文件，输出 `--dry-run: exiting now.`，没有部署。
- 警告：检测到代理环境变量并用于 fetch。

## 真实浏览器生产包

- 本地入口：`http://localhost:5173/`（localhost secure context）。
- 真实设计：正面 `FRONT TOP` 文字和 `Crest Badge`；背面 `PLAYER` / `16`。
- 浏览器实际生成并下载：`C:\Users\Administrator\Downloads\fn8788-jersey-design-6ac2cd02.zip`
- ZIP 大小：4,420,515 bytes。
- ZIP SHA-256：`12f53a99417bc86c6225211294339d188d9ec4142bdf491eba3b0d2fecc266d9`
- 设计指纹：`6ac2cd02`
- 浏览器下载事件监听超时，但 Downloads 中出现本次时间戳、指纹一致的新 ZIP；后续 CLI、解包、Manifest 和设计内容均确认它是本次真实设计生产包。

CLI 验证：

```text
node scripts/verify-production-package.mjs C:\Users\Administrator\Downloads\fn8788-jersey-design-6ac2cd02.zip
Production package verification: PASS (6ac2cd02, 4096x4096, 2 PDF pages)
```

该 PASS 只代表当前 verifier 覆盖的结构、尺寸、声明和哈希契约通过，不代表视觉方向通过。

## 解包、Manifest 与哈希证据

- 唯一安全解包目录：`C:\Users\Administrator\AppData\Local\Temp\jersey-uv-verification-20260803-a966dc7ffd514b0fae98fc2f87fbc117`
- PDF 第 2 页渲染：`C:\Users\Administrator\AppData\Local\Temp\jersey-uv-verification-20260803-a966dc7ffd514b0fae98fc2f87fbc117\uv-reference-page-2.png`
- Poppler `pdfinfo`：2 页，A4 横向，PDF 1.4。

ZIP 中精确七文件：

1. `design.json` - 2,827 bytes
2. `uv-atlas.png` - 993,382 bytes
3. `uv-pattern-pieces.png` - 918,942 bytes
4. `uv-reference.pdf` - 231,946 bytes
5. `preview-front.png` - 1,255,745 bytes
6. `preview-back.png` - 1,013,716 bytes
7. `manifest.json` - 3,191 bytes

元数据核对：

- `uv-atlas.png`：4096 x 4096。
- `uv-pattern-pieces.png`：4096 x 4096。
- `manifest.schemaVersion = 2`。
- `manifest.uvExportVersion = "2"`。
- `manifest.patternPieces.outputTransform = { "rotation": 180, "mirrorX": true }`。
- Manifest 声明的 6 个生产文件 byteLength 与实际完全一致。
- Manifest 声明的 6 个生产文件 SHA-256 与实际逐项完全一致。

## 真实视觉验收

### 通过项

- `preview-front.png`：3D 正面预览中 Crest Badge 朝向正确，`FRONT TOP` 字母上下正向；未见新的裁切或异常黑块。
- `preview-back.png`：3D 背面预览中 `PLAYER` 和 `16` 上下正向、从左到右；未见新的裁切或异常黑块。
- `uv-atlas.png` 已实际查看；未见主身、袖片或领片被新实心黑块覆盖，未见主身裁切。透明区域在查看器中显示为黑色。本轮没有像素基线比较，因此不声称 Atlas 或 previews “像素完全未变”。

### 阻塞失败项

- `uv-pattern-pieces.png`：前片和背片的领口均朝下，不符合“领口朝上”。
- `FRONT TOP`、`PLAYER`、`16` 均上下倒置，不符合“从左到右且上下正向”。
- Crest Badge 上下颠倒，不符合徽章方向验收。
- 前片和背片本身未裁切，但当前 `patternPieces.pieces` 只包含 front/back，无法在该图上单独验收袖片/领片；袖片/领片仅在 Atlas 中查看。
- PDF 第 2 页与 `uv-pattern-pieces.png` 一致地复现上述方向失败；PDF 不是另一份正确输出。

## 风险与遗留问题

- 风险等级：阻塞发布。工厂按当前裁片图或 PDF 生产会收到上下颠倒的正背片参考内容。
- 触发条件：任何 Chelsea/FN8788 生产包使用“既有每片 180°+水平镜像”再叠加“全局 180°+水平镜像”的配置。
- 影响范围：`uv-pattern-pieces.png` 与 PDF 第 2 页；本次 3D front/back previews 正常。
- 自动化缺口：10 个定向测试和 1,153 个全量测试均未发现真实输出方向回归，说明 oracle / fixture 对最终像素视觉的断言仍不足。
- 修复建议：下一轮先用真实失败包固化能识别领口与非对称文字方向的失败测试，再只保留一层方向变换（调整每片配置或全局配置二选一），重新生成真实 ZIP 做同一固定视觉验收。本轮按授权不修改生产代码。

## 进程与发布边界

- in-app 浏览器验收 tab 已结束。
- 本地 Vite server 已通过受控 PTY 停止；端口 5173 无监听。
- 证据 ZIP、解包目录和 PDF 渲染图保留。
- 未 push、未 merge、未 deploy、未触发 Cloudflare 或 Shopify 发布。

## 修正版最终验证（2026-08-04）

### 版本与修复提交

- 最终验证分支：`codex/uv-pattern-output-transform`。
- 最终验证 HEAD：`6052750a2d79751d05d711fe5a5e8ead5a428b2f`。
- 正式方向修复：`6f04e31 fix: avoid duplicate UV output orientation transform`。该提交移除 front/back 每片重复方向变换，只保留最终全局输出变换。
- native Canvas 串行化：`6052750 test: serialize native Canvas verification`。默认测试分为 `unit` 与 `native-canvas` 两个项目，native Canvas 项目 `fileParallelism: false`、`maxWorkers: 1`，并在 unit 之后执行。
- 修正版 Manifest 裁片布局指纹：`uv-pieces-v2-14887ff1`；首轮失败包为 `uv-pieces-v2-e5f46651`。
- 设计指纹继续为 `6ac2cd02`。

### 基线与完整命令

开始时 `git status` clean，HEAD 与预期一致；以下命令均从主验证 worktree 新鲜执行：

```text
git diff showcase...HEAD --check
exit 0

npm test
exit 0
Test Files  77 passed (77)
Tests       1153 passed (1153)
Duration    56.81s

npx vitest list --project unit
exit 0，74 files / 1141 tests

npx vitest list --project native-canvas
exit 0，3 files / 12 tests

npm run build
exit 0

npm run build:showcase
exit 0

npx wrangler deploy --dry-run
exit 0，输出 --dry-run: exiting now.
```

默认 `npm test` 只执行一次，总计 77 个测试文件、1,153 个测试全部通过；没有 `ETIMEDOUT`。TTY 最终汇总只保留总计，因此另用不执行测试的 `vitest list` 核实拆分为 unit 74/1,141 与 native-canvas 3/12。测试输出仍有两条既有 jsdom 提示 `Not implemented: navigation to another Document`。

`npm run build` 的 app 与 Shopify 构建均成功；app 转换 1,753 modules，Shopify 转换 1,738 modules。`npm run build:showcase` 转换 1,753 modules 并成功。允许的既有警告为：主 JS chunk 超过 500 kB；Shopify 构建提示 `inlineDynamicImports option is ignored because codeSplitting: false is set`。

Wrangler 4.118.0 dry-run 读取 `dist` 中 7 个文件，Total Upload 104.02 KiB / gzip 24.30 KiB；检测到代理环境变量并用于 fetch。命令明确以 dry-run 退出，没有实际部署。

### 真实 Showcase 导入与新 ZIP

- localhost：主验证 worktree 的 Vite Showcase，实际入口为 `http://localhost:5173/`。
- 导入源：首轮失败包 `C:\Users\Administrator\Downloads\fn8788-jersey-design-6ac2cd02.zip` 中的同一 `design.json`。
- 导入源 `design.json` SHA-256：`19ec39680a794d305d7bec9dcfde1e69071a9a53faecb7528ab3812cde89cf2f`。
- 导入设计明确包含正面 `FRONT TOP`、`Crest Badge`，背面 `PLAYER` / `16`；导入后审核弹窗显示 `1 item: FRONT TOP`、`Name set` 和 `1 artwork item`，总价为 `$115`。
- 现有审核弹窗只直接展开 `FRONT TOP`，把精确的 `PLAYER / 16` 与 `Crest Badge` 聚合显示为 `Name set` 和 `1 artwork item`。精确值由导入源、新 `design.json` 以及实际生产图交叉确认；该既有摘要 UI 边界不影响本次方向修复结论。
- 审核截图：`C:\Users\Administrator\Downloads\uv-output-transform-final-qa-20260804-100405\review-page.png`。
- 新下载 ZIP：`C:\Users\Administrator\Downloads\fn8788-jersey-design-6ac2cd02 (2).zip`。
- ZIP 创建/修改时间：`2026-08-04 10:07:43 +08:00`。
- ZIP 大小：4,420,715 bytes。
- ZIP SHA-256：`a700fb65f248369d2fc124648587915aa32efd729809c40778c82e888ddb12f2`。

浏览器下载事件监听在 30 秒后超时，但点击后出现了未覆盖旧文件的新 `(2).zip`。其新时间戳、`generatedAt = 2026-08-04T02:07:10.594Z`、设计内容、设计指纹、修正版布局指纹和逐项 Manifest 均证明它是本轮由主验证 worktree 生成的包，不是旧候选。

浏览器验收 tab 已关闭，本地 Vite server 已停止。

### Fresh verifier、解包与 PDF 证据

新 ZIP 在下载后 fresh 执行：

```text
node scripts/verify-production-package.mjs "C:\Users\Administrator\Downloads\fn8788-jersey-design-6ac2cd02 (2).zip"
Production package verification: PASS (6ac2cd02, 4096x4096, 2 PDF pages)
exit 0
```

- 唯一证据根目录：`C:\Users\Administrator\Downloads\uv-output-transform-final-qa-20260804-100405`。
- 新包安全解包目录：`C:\Users\Administrator\Downloads\uv-output-transform-final-qa-20260804-100405\final-package-extracted`。
- 失败包历史对比目录：`C:\Users\Administrator\Downloads\uv-output-transform-final-qa-20260804-100405\failed-package-extracted`。
- 使用底层 Poppler `pdfinfo.exe` 确认 PDF 2 页、A4 横向、PDF 1.4、无旋转。
- 使用底层 Poppler `pdftoppm.exe` 渲染并实际查看第 2 页：`C:\Users\Administrator\Downloads\uv-output-transform-final-qa-20260804-100405\final-package-extracted\uv-reference-page-2.png`。

新 ZIP 精确包含七个顶层文件：

1. `design.json` - 2,827 bytes
2. `manifest.json` - 3,189 bytes
3. `preview-back.png` - 1,013,716 bytes
4. `preview-front.png` - 1,255,855 bytes
5. `uv-atlas.png` - 993,382 bytes
6. `uv-pattern-pieces.png` - 919,274 bytes
7. `uv-reference.pdf` - 231,706 bytes

实际尺寸：`uv-atlas.png` 与 `uv-pattern-pieces.png` 均为 4096 x 4096 RGBA；front/back previews 均为 1600 x 1600 RGBA。PDF 为 2 页。

### 修正版 Manifest

- `schemaVersion = 2`。
- `uvExportVersion = "2"`。
- `designFingerprint = "6ac2cd02"`。
- `patternPieces.layoutFingerprint = "uv-pieces-v2-14887ff1"`。
- `patternPieces.outputTransform = { "rotation": 180, "mirrorX": true }`。
- front：`rotation = 0`、`mirrorX = false`、`outputBounds = { x: 192, y: 745, width: 1792, height: 2605 }`。
- back：`rotation = 0`、`mirrorX = false`、`outputBounds = { x: 2228, y: 745, width: 1560, height: 2605 }`。

Manifest 声明的六个生产文件长度与实际逐项一致，SHA-256 也与实际逐项一致：

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| `design.json` | 2,827 | `a890a59e7877a6bccef58d1a0e006688b885e6e95ebb464ad1aba5885772a3db` |
| `uv-atlas.png` | 993,382 | `e24658da8c20983dbcc726c7ba516825ed56889eea735307a718a2e322a51693` |
| `uv-pattern-pieces.png` | 919,274 | `c165a6907f7606628177f1c6c1ed19f9a0a001e5a2fb34bbd687d8e1344be881` |
| `uv-reference.pdf` | 231,706 | `c03756bc36578038a0e00e1daf3c22a6f57b6288c971e1c9ab6fde69b427f687` |
| `preview-front.png` | 1,255,855 | `2d91263d5cdf8b9e2b58e70afd0cfaca30ff9aa5d630a52020d1f941a8f39df2` |
| `preview-back.png` | 1,013,716 | `b8a3f6517126742b7aabfe2fd64d1db62384b1222e60841ac89df4090cde5de9` |

### 修正版真实视觉 PASS

已实际打开并查看新 `uv-pattern-pieces.png`、`preview-front.png`、`preview-back.png`、`uv-atlas.png`，并实际查看 Poppler 渲染的 PDF 第 2 页：

- front/back 裁片的领口均朝上。
- `FRONT TOP` 上下正立；中段被 Crest 部分遮挡，但两侧可见字母方向明确正立。
- `PLAYER` 与 `16` 上下正立，阅读方向为从左到右。
- Crest 盾尖向下，星尖向上。
- 正片和背片完整落在各自 bounds 内，未裁切；裁片内容内部无异常实心黑块。查看器中的外围黑色是透明背景的显示效果。
- PDF 第 2 页与 `uv-pattern-pieces.png` 的方向、内容和排版一致。
- `preview-front.png` 中 Crest 与可见 `FRONT TOP` 保持正向；`preview-back.png` 中 `PLAYER / 16` 保持正向。
- `uv-atlas.png` 已实际查看，主身、袖片与领片未见新增裁切或异常实心黑块；Atlas 保持源 UV 朝向，不作为工厂正向裁片图。

固定视觉验收条件全部通过。

### 与首轮失败包的实际比较

- 新旧 `uv-atlas.png` SHA-256 完全相同：`e24658da8c20983dbcc726c7ba516825ed56889eea735307a718a2e322a51693`。
- 新旧 `preview-back.png` SHA-256 完全相同。
- `uv-pattern-pieces.png`、PDF 和 front preview 哈希不同；设计 JSON 因新的 `savedAt` 而不同。
- 对失败包与新包的 4096 x 4096 RGBA 裁片像素做了实际 bounds 比较。新图视觉内容相对于失败包各自完成一次垂直方向修正，但不是 PNG 解码后的逐像素完美 vertical flip：front bounds 共 4,668,160 像素，其中 9,166 像素不同于旧 crop 的逐行反转；back bounds 共 4,063,800 像素，其中 4,486 像素不同。两个 bounds 之外 8,045,256 像素的差异数为 0。差异集中在重新光栅化边缘，因此不声称两张裁片 PNG 是位级精确的单次翻转；视觉方向和 Manifest 变换层数则符合只保留一次最终输出修正。

### 警告、边界与发布状态

- 非阻塞既有警告：两条 jsdom navigation 提示、Vite 主 chunk 超过 500 kB、Shopify inlineDynamicImports/codeSplitting 提示、Wrangler 代理环境变量提示。
- 浏览器 download 事件监听超时，但新文件存在并由新时间戳、内容、指纹、Manifest、verifier 与视觉检查组成完整证据链。
- 审核弹窗现有摘要 UI 不直显精确 `PLAYER / 16` 与 `Crest Badge` 文案；本轮未获授权修改该既有 UI，只在本记录中显式保留边界。
- 本轮只修改本日志，没有新增公共模块、依赖、生产代码或项目内证据文件。
- 方向修正版已经完成本地完整验证，但仍未 push、未 merge、未 deploy、未发布到 Cloudflare 或 Shopify。

## 最终发布审查关闭（2026-08-04）

### 审查提交与发布门禁

- 最终审查 HEAD：`ff224026c23a7fd7ee6ee03af7c6b05b4b158509`。
- 提交：`ff224026 fix: enforce UV export version contract`。
- 该提交没有改变已经验收通过的方向图像输出；它关闭最终代码审查发现的 `uvExportVersion` 发布门禁缺口。
- 唯一允许的生产 UV 导出版本为精确字符串 `"2"`；缺失、旧字符串 `"1"` 和数值 `2` 均不是有效值。

门禁覆盖四个独立入口：

1. Manifest 创建：`createProductionManifest()` 在读取文件或计算哈希前要求 `uvExportVersion === "2"`。
2. 浏览器内产物复核：`verifyProductionArtifacts()` 在逐文件验证前要求 Manifest 的 `uvExportVersion === "2"`。
3. Package preflight：`createProductionPackage()` 的请求预检在调用 artifact provider、PDF 或 ZIP 生成前要求模型 `uvExportVersion === "2"`。
4. CLI：`verifyProductionPackageBytes()` 在 Manifest Schema 检查之后立即要求 `manifest.uvExportVersion === "2"`。

版本常量统一为 `PRODUCTION_UV_EXPORT_VERSION = "2"`；浏览器端创建、复核与 Package preflight 共享该常量，CLI 使用对应的固定预期值。门禁失败均显式报错，不会以默认值或类型转换伪装成功。

### 门禁回归测试

新增或扩展的测试覆盖：

- Manifest 创建拒绝 missing、`"1"`、number `2`。
- 浏览器内 Manifest/产物复核拒绝 missing、`"1"`、number `2`。
- Package preflight 在生产工作开始前拒绝非版本 `"2"` 的模型，并断言 artifact provider、PDF 与 ZIP 生成器均未调用。
- CLI 拒绝 missing、`"1"`、number `2`，且错误发生在后续故意损坏的 Atlas hash 校验之前，证明版本门禁具有优先级。

正式定向命令与结果：

```text
npx vitest run src/features/configurator/designs/productionManifest.test.js src/features/configurator/designs/productionPackage.test.js src/features/configurator/designs/productionFingerprint.test.js scripts/verify-production-package.test.js

Test Files  4 passed (4)
Tests       116 passed (116)
exit 0
```

### 最终默认全量与构建

```text
npm test

Test Files  77 passed (77)
Tests       1163 passed (1163)
Duration    71.15s
exit 0

npm run build
exit 0
```

默认测试无失败、无 `ETIMEDOUT`；仍只有两条既有 jsdom `Not implemented: navigation to another Document` 提示。

完整 build 的 app 与 Shopify 包均成功：app 转换 1,753 modules，Shopify 转换 1,738 modules。允许的既有警告仍为主 JS chunk 超过 500 kB，以及 Shopify `inlineDynamicImports option is ignored because codeSplitting: false is set`。

### 最终真实 ZIP 与新 CLI

使用 `ff224026` 中的新 CLI 对此前已完成真实浏览器下载与视觉验收的最终 ZIP fresh 执行：

```text
node scripts/verify-production-package.mjs "C:\Users\Administrator\Downloads\fn8788-jersey-design-6ac2cd02 (2).zip"
Production package verification: PASS (6ac2cd02, 4096x4096, 2 PDF pages)
exit 0
```

- 最终 ZIP SHA-256 仍为 `a700fb65f248369d2fc124648587915aa32efd729809c40778c82e888ddb12f2`。
- 包内 `manifest.uvExportVersion` 为精确字符串 `"2"`，因此新门禁与此前结构、哈希及真实视觉证据一致。
- 本次不重新生成 ZIP；方向图像的真实浏览器、解包、Poppler 与逐图证据继续使用上文已保留的同一最终包。

### 最终代码审查结论

| 级别 | 未关闭发现 |
| --- | --- |
| Critical | None |
| Important | None |
| Minor | None |

Release review：**Ready = Yes**。这里的 Ready 仅表示本地代码、测试、构建、CLI 与真实生产包证据达到发布审查条件；项目仍未 push、未 merge、未 deploy、未发布。
