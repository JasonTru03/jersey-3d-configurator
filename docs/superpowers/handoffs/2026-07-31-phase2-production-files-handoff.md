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

## 自动化验证

通过：

```powershell
npm test
# 69 个测试文件，796 项测试全部通过

npm run build:app
npm run build:shopify

npx vitest run src/features/configurator/scene/productionAtlasBaker.test.js `
  src/features/configurator/scene/productionAtlasBakerGarmentModels.test.js
# 14 项真实/合成 Atlas 映射测试通过
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

复杂设计生成属于同步 CPU 工作，浏览器自动化的单次点击等待在约 20 秒处超时，但页面进程继续完成，重新连接后下载链接正常出现；这是需要后续优化为后台/Worker 生成的性能边界，不影响本阶段文件正确性。

下载文件：

`C:\Users\Administrator\Downloads\fn8788-jersey-design-950cdaa3.zip`

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

## 生产边界与回滚

PDF 与 Atlas 是 UV 生产参考和数据交换文件，不是工厂 1:1 裁片文件；不包含纸样裁片、放码、缝份或裁片编号。

本阶段没有加入 R2、订单关联、Shopify 订单文件卡片或后台模型管理。  
阶段一 Worker 回滚目标：`810543ff-bdd0-4d3d-a42f-d454161cf7b5`。
