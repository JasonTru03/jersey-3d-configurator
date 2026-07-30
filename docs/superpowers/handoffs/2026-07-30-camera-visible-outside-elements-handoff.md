# Camera-visible outside elements handoff

## 分支、检查点与状态

- 分支：`codex/camera-visible-outside-elements`
- 实现 HEAD：`5288b93dc4a3818edf9a0dbee9d5cd5f378add4c`（短 SHA：`5288b93`）
- 本交接文档提交后，分支 HEAD 会前移；上述 SHA 仍是功能与测试实现检查点。
- Deployment status：**NOT DEPLOYED**
- 未 push、未修改 Shopify live theme；部署必须等待用户明确确认。
- 工作在隔离 worktree 中完成；用户主工作区原有 dirty 文件没有混入本分支或本次文档提交。

## 已实现行为

- Design 面板隐藏高级 `Continuous bottom pattern` UI，但保留旧字段与旧设计兼容路径。
- 文字、号码、Artwork 与球衣拖动命中统一使用朝外表面判断。
- 元素选择加入球衣遮挡判断，阻止穿透球衣选中对侧隐藏元素。
- Artwork 默认位置、拖动和已保存 placement 的网格恢复均使用朝外命中。
- Artwork 和 personalization 使用同一套朝向 triangle filter。
- 文字、号码和 Artwork 元素材质使用 `THREE.FrontSide`；球衣基础材质仍使用 `THREE.DoubleSide`。
- 负 determinant 镜像模型会修正过滤后几何的 winding。
- 真实 GLB 回归覆盖 Chelsea 与 FN8788 的 badge/upload × front/back 默认投影。

## 完整创建/修改文件清单

以下清单来自 `git diff --name-status a9c7ad7..5288b93`，共 11 个实现与测试文件。

| 状态 | 文件 | 职责 |
| --- | --- | --- |
| M | `src/features/configurator/scene/decorationEditor.js` | Artwork 默认/保存位置恢复、拖动与选择接入朝外命中和遮挡；材质改为 FrontSide；应用共享 triangle filter。 |
| M | `src/features/configurator/scene/decorationEditor.test.js` | 覆盖 Artwork 外侧投影、选择遮挡、拖动及几何过滤回归。 |
| M | `src/features/configurator/scene/decorationEditorGarmentModels.test.js` | 使用 Chelsea 与 FN8788 真实 GLB 验证 badge/upload × front/back 投影与非退化三角形。 |
| M | `src/features/configurator/scene/garmentRenderer.js` | 文字/号码选取和球衣命中接入共享可见性策略；元素材质改为 FrontSide。 |
| M | `src/features/configurator/scene/garmentRenderer.test.js` | 覆盖文字/号码朝外渲染、对侧遮挡选择和拖动行为。 |
| M | `src/features/configurator/scene/personalizationDecal.js` | 导出共享 triangle filter，并修正镜像模型过滤后的 winding。 |
| M | `src/features/configurator/scene/personalizationDecal.test.js` | 覆盖共享过滤器与镜像 winding 回归。 |
| A | `src/features/configurator/scene/surfaceVisibility.js` | 提供世界空间法线、朝外射线命中和元素相对球衣遮挡判断。 |
| A | `src/features/configurator/scene/surfaceVisibility.test.js` | 覆盖阈值、法线变换、朝外命中、遮挡、容差与异常输入。 |
| M | `src/features/configurator/ui/ConfiguratorPage.jsx` | 从 Design 页面隐藏 BottomPatternPanel，保留底层兼容实现。 |
| M | `src/features/configurator/ui/ConfiguratorPage.test.jsx` | 验证高级 pattern UI 不再出现并更新页面回归。 |

## 自动化与构建验证

| 检查 | 结果 |
| --- | --- |
| `npx vitest run --exclude=".worktrees/**"` | exit `0`；61/61 files、736/736 tests passed，58.48 s。两条 jsdom navigation 提示，无失败。 |
| `npm run build` | exit `0`；app、Shopify 与 CSS export 命令链完成。 |
| 构建 warning | app chunk 超过 500 kB；Shopify `inlineDynamicImports` 因 `codeSplitting: false` 被忽略。均为非阻断提示。 |
| 五文件定向回归 | exit `0`；5/5 files、165/165 tests passed，17.29 s。 |
| `decorationEditorGarmentModels.test.js --reporter=verbose` | exit `0`；1/1 file、8/8 tests passed，明确覆盖两模型 × badge/upload × front/back。 |
| `git diff --check` | exit `0`。 |
| 文档创建前 `git status --short` | 无输出，隔离 worktree clean。 |

## 真实浏览器 WebGL 验收

### Chelsea standalone

结果：**front/back/45° 完整人工矩阵 PASS**。

- Design panel 中 Jersey templates 与 Zone colors 正常，高级 pattern region/checkbox 均不存在。
- front PLAYER/16 与 back YOUR TEXT 只在各自外侧可见；对侧隐藏文字无法从球衣另一侧穿透选中。
- PLAYER 拖到左肩曲面后仍贴在外侧，约 45° 斜角下可见且可选。
- front Crest 与 back Roundel 只在各自外侧可见；点击隐藏对侧 Artwork 的投影位置不会切换选择。
- Crest 拖到右胸曲面后仍在外侧；近距离衣领检查未看到图案进入衣服内侧。
- 浏览器 error/warn/warning 日志为 `[]`，无模型或纹理失败。

### FN8788 Shopify section harness

结果：**manual front/back exterior render PASS**；**未声称完整 45° 人工矩阵 PASS**。

- 真实模型加载可见。
- front Name set PLAYER/16 与 front Crest 外侧显示；Crest 切到 back 后背面可见，front Name set 不再显示。
- 浏览器 error/warn 日志为 `[]`。
- 临时 section harness 的长控制面板令 canvas 高达 2090 px，无法可靠完成完整 45° 逐元素人工矩阵。
- FN8788 的真实模型 front/back 默认 Artwork 投影由 8/8 自动化回归覆盖；这不等同于宣称已完成人工 45° 矩阵。
- 临时 `fn8788-preview.html` 已删除，开发服务器已停止，临时 harness 未提交。

## 模型注意事项与非阻断 Minor

- 当前真实模型自动化准入覆盖 Chelsea 与 FN8788。新增或替换 GLB 时，应加入相同的 front/back 外侧投影回归，尤其检查镜像 transform 与三角形 winding。
- `surfaceVisibility` 不支持 `THREE.InstancedMesh`；当前球衣和元素调用链没有使用 InstancedMesh。
- 公共 `filterFacingDecalTriangles` 不支持 indexed geometry；当前调用均传入非索引 `DecalGeometry`。
- 旧 bottom pattern 数据的底层兼容仍保留；建议后续补充真实 `Open design` 页面级测试，验证旧设计可打开、pattern UI 保持隐藏且数据不被意外清除。

## Phase 2 与未包含范围

- Phase 2 的输出边界是 UV reference PDF/JSON/ZIP，仅用于参考与数据交换，**不是 1:1 factory output**。
- 本分支不包含 PDF/CDR 工厂生产文件、R2/D1、Shopify paid order 或 model admin。
- 本分支未执行生产部署、合并、push 或 live theme 修改。

## 下一步

1. 用户审阅本分支的实现、自动化结果与浏览器证据。
2. 如用户明确批准，再决定合并、push 与部署方式。
3. 部署前保持回归门槛：完整测试、构建、目标真实 GLB 测试及生产目标浏览器复查。
