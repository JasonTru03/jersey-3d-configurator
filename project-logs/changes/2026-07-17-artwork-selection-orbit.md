# Artwork selection and jersey orbit verification

## 日期

2026-07-17

## 目标

完成 Artwork 选择态与球衣轨道旋转改动的最终自动化验证，并记录本地可复核的页面连通性、人工验收限制与后续发布边界。

## 改动范围

本次功能涉及的关键源文件：

- `src/features/configurator/config/productDefinitions.js`：Artwork 预设收敛为 Crest Badge 与 Roundel Badge。
- `src/features/configurator/ui/DecorationPanel.jsx`：Artwork 预设添加、上传、当前项操作（旋转、缩放、删除）与状态提示。
- `src/features/configurator/scene/decorationEditor.js`：Artwork 纹理及拖动编辑链路。
- `src/features/configurator/scene/garmentRenderer.js`：Artwork 锚点回传、选中图案拖动与非图案区域球衣 orbit 的区分。
- `src/features/configurator/scene/ProductStage.jsx`：选择框与舞台工具栏的组合和层级。
- `src/features/configurator/scene/ArtworkSelectionOverlay.jsx`：Artwork 选择框。
- `src/features/configurator/ui/configurator.css`：选择框与工具栏的可视层级样式。

对应测试覆盖位于 `DecorationPanel.test.jsx`、`decorationEditor.test.js`、`garmentRenderer.test.js`、`ProductStage.test.jsx`、`ArtworkSelectionOverlay.test.jsx`，并同步回归了 Configurator 页面和 Shopify Section。

`designDocument.test.js` 补充覆盖旧 Artwork 在 `back`、`left-sleeve`、`right-sleeve` 区域及其 mesh placement 经导入、规范化和再次导出后的原样保留。

## 新增、删除与行为变化

- 新增：`ArtworkSelectionOverlay` 及其测试；当前 Artwork 被选中时，舞台层显示橙色选择框。
- 删除：产品定义中的两个示例 Artwork 预设（Golden Stripe、Night Grid）；面板仅保留 Crest Badge、Roundel Badge 及 Upload artwork 入口。
- 行为变化：拖动选中的 Artwork 移动图案；从图案外区域拖动时保留球衣 orbit；Artwork 被选中时，右侧操作可旋转、缩放或删除当前图案；删除后选择框应隐藏。
- 行为保持：Name set 的既有功能未在本次变更中修改，并由完整测试套件回归。

## 自动化验证

| 命令或检查 | 结果 |
| --- | --- |
| `npm test` | 退出码 `0`；`19 passed` 测试文件、`86 passed` 测试。 |
| `npm run build:showcase` | 退出码 `0`；Vite 8.1.3 构建成功。 |
| `npm run dev` + HTTP 检查 | 本地 Vite 页面在 `http://127.0.0.1:5173/` 返回 HTTP `200`；标题为 `3D Product Configurator`；`/src/main.jsx`、`/src/app/App.jsx`、`/src/features/configurator/ui/ConfiguratorPage.jsx` 均返回 HTTP `200`。 |

本次 `npm test` 实际执行的测试文件为：

1. `src/features/configurator/api/productApi.test.js`
2. `src/features/configurator/config/decorations.test.js`
3. `src/features/configurator/config/pricing.test.js`
4. `src/features/configurator/config/printItems.test.js`
5. `src/features/configurator/config/state.test.js`
6. `src/features/configurator/designs/designDocument.test.js`
7. `src/features/configurator/designs/designFileBrowser.test.js`
8. `src/features/configurator/designs/designHistory.test.js`
9. `src/features/configurator/hooks/useConfigurator.test.js`
10. `src/features/configurator/scene/ArtworkSelectionOverlay.test.jsx`
11. `src/features/configurator/scene/decorationEditor.test.js`
12. `src/features/configurator/scene/garmentRenderer.test.js`
13. `src/features/configurator/scene/PrintToolbarOverlay.test.jsx`
14. `src/features/configurator/scene/ProductStage.test.jsx`
15. `src/features/configurator/shopify/ShopifyConfiguratorSection.test.jsx`
16. `src/features/configurator/shopify/shopifyMount.test.js`
17. `src/features/configurator/ui/ConfiguratorPage.test.jsx`
18. `src/features/configurator/ui/DecorationPanel.test.jsx`
19. `src/features/configurator/ui/DesignReviewDialog.test.jsx`

### 已知非阻塞构建警告

`npm run build:showcase` 仍报告一个非阻塞 Vite chunk-size warning：压缩后的 `dist/assets/index-B8XwZ_SP.js` 为 `954.23 kB`（gzip `264.95 kB`），超过默认 `500 kB` 阈值。构建产物已生成；本次没有引入代码拆分或调整阈值。

## 人工验证与限制

当前自动化环境没有可受控的 WebGL 浏览器：`chrome`、`chrome.exe`、`msedge`、`msedge.exe` 不在 PATH，项目也未安装 Playwright、Puppeteer 或相同用途的浏览器测试运行时。因此未把下列真实画布交互标记为已通过：

1. Artwork 面板仅显示 Crest Badge、Roundel Badge 和 Upload artwork。
2. 点击 Artwork 后显示橙色选择框。
3. 拖动图案本体会移动图案。
4. 在图案外的球衣区域拖动会旋转球衣，且选择框持续跟随。
5. 右侧旋转、缩小、放大、删除操作真实生效，删除后选择框隐藏。
6. Name set 交互不回归。
7. 窄视图下工具栏、选择框和侧栏不遮挡关键操作。

页面 HTTP、标题、入口模块和 Configurator 页面测试均已验证，但这些证据不替代上述 WebGL 人工验收。

## 执行边界

- 未触碰 `package-lock.json` 或 `.superpowers/`。
- 未合并、未 push、未发布。
- 主工作区 `showcase` 的未提交 `package-lock.json` 和未跟踪 `.superpowers/` 保持原状，未暂存或纳入本分支提交。

## 遗留风险与下一步

1. 由具备浏览器和 WebGL 的用户按“人工验证与限制”清单完成逐项验收，并在窄视图复查绘制层级。
2. 若真实运行中出现选择框偏移、orbit 被图案拖动阻断或移动端遮挡，记录复现尺寸、浏览器版本和截图后再处理。
3. 发布、合并与部署仍需用户明确确认；在此之前保留当前 worktree 和提交链作为可审查检查点。
