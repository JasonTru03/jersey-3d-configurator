# 2026-08-03 UV 裁片输出变换验证记录

## 状态

**BLOCKED：结构、哈希、测试和构建契约通过，但真实生产包视觉验收失败，当前提交不可交付或发布。**

本轮只新增本验证日志，没有修改生产代码；没有 push、merge、deploy 或 Shopify 发布。

## 日期与版本

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
