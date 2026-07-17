# Artwork selection and orbit handoff

## 分支与边界

- 工作分支：`codex/artwork-selection-orbit`
- 本交接只记录该分支的 Artwork 选择态与球衣 orbit 功能。
- 禁止在本交接步骤中合并、push 或发布；发布仍需用户明确确认。
- 主工作区位于分支 `showcase`，当前保留其原有未提交 `package-lock.json` 与未跟踪 `.superpowers/`。这些内容没有被触碰、暂存或提交。

## 相关提交

按时间顺序，功能相关提交如下：

| SHA | 提交 | 作用 |
| --- | --- | --- |
| `b7db863b7737a3e0ded2bb4e8d6c95bd16ffbaa0` | `docs: define artwork selection and orbit behavior` | 规格：定义 Artwork 选择与 orbit 的目标行为。 |
| `3d17e876ed553657c0e5bf0c115e8f48cf275be6` | `docs: plan artwork selection and orbit behavior` | 实施计划与验证边界。 |
| `6ed931b353687d7507d19298b5729f90b6ea33f8` | `feat: simplify artwork presets and placement` | 功能：精简 Artwork 预设，并完成放置链路调整。 |
| `aaca0324ceff2b495e95a2dfab25a2b2a396c3dc` | `test: cover artwork upload placement` | 测试：覆盖上传 Artwork 的放置。 |
| `1de00f6c6918120e94066ef3e9d70727c0a3396c` | `fix: keep jersey orbit available with artwork selected` | 功能修正：在 Artwork 选中时继续允许球衣 orbit。 |
| `55cf226ddebfa460d6f0cd9bac47391bafa40d36` | `feat: show selection frame for artwork` | 功能：显示 Artwork 橙色选择框。 |
| `b968239ba8ca14eda0156118e606b8ee50f4b4eb` | `fix: keep stage toolbar above artwork frame` | 质量修正：舞台工具栏保持在 Artwork 选择框之上。 |

## 功能与关键文件

- `src/features/configurator/config/productDefinitions.js`：预设由 20 项示例收敛为 Crest Badge 与 Roundel Badge。
- `src/features/configurator/ui/DecorationPanel.jsx`：保留 Upload artwork，管理当前 Artwork 的旋转、缩放、删除操作。
- `src/features/configurator/scene/decorationEditor.js`：Artwork 纹理和拖动编辑。
- `src/features/configurator/scene/garmentRenderer.js`：图案命中时移动 Artwork；图案外拖动继续驱动球衣 orbit；回传选择框锚点。
- `src/features/configurator/scene/ProductStage.jsx`：挂载 Artwork 选择框和已有舞台工具栏。
- `src/features/configurator/scene/ArtworkSelectionOverlay.jsx`：橙色选择框视图。
- `src/features/configurator/ui/configurator.css`：选择框和工具栏 z-index/显示样式。

预期交互：Artwork 面板仅包含 Crest Badge、Roundel Badge 与 Upload artwork；点选后显示橙色框；拖图案移动，拖图案外的球衣 orbit，选择框随图案保持；右侧工具可旋转、缩放、删除；Name set 的原有流程保持。

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `npm test` | 退出码 `0`，19 个测试文件、81 个测试全部通过。 |
| `npm run build:showcase` | 退出码 `0`，生产 showcase 构建成功。 |
| `npm run dev` | 本地页面 `http://127.0.0.1:5173/` 返回 HTTP `200`，标题 `3D Product Configurator`；入口、App 与 ConfiguratorPage 模块均返回 HTTP `200`。 |
| 构建提示 | 存在已知非阻塞 chunk-size warning：`index-B8XwZ_SP.js` 954.23 kB（gzip 264.95 kB），超过 500 kB 默认阈值。 |

未完成的真实浏览器验收：当前环境没有可受控的 WebGL 浏览器或 Playwright/Puppeteer 运行时。因此尚需用户在支持 WebGL 的浏览器实际检查 Artwork 三项入口、橙色框、图案拖动、图案外 orbit、右侧操作、删除隐藏、Name set 回归和窄视图布局。不得将这部分手工交互标记为已通过。

## 发布与回退

- 合并、push 和发布均未执行，仍需用户确认。
- 如需回退功能，使用 `git revert` 针对功能提交创建反向提交；优先按依赖倒序处理 `b968239`、`55cf226`、`1de00f6`、`6ed931b`，如要一并撤销覆盖则再 revert `aaca032` 测试提交。
- 不重写历史，不使用 reset、rebase 或强制 push 作为回退方式。
- 回退后重新执行 `npm test` 与 `npm run build:showcase`，并在 WebGL 浏览器复查交互。
