# 3D 球衣定制器：新对话续作交接日志

## 先读结论

当前可演示稳定版在 `showcase` 分支，最新合并提交为 `45dda0d merge: stabilize print rotation drag`。公开演示地址为：<https://jersey-3d-configurator.jason1064969838.workers.dev/>。

截至 2026-07-16，第一期的本地设计文件、撤销/重做、打开/保存、设计确认，以及姓名贴花的选中、复制、删除、缩放和稳定旋转已经完成。项目仍是独立 Vite 展示页；未接入服务器设计保存、Shopify 加购、Checkout 或支付。

## 新对话启动方式

1. 先读取本文件、`C:\Users\Administrator\.codex\AGENTS.md`，以及项目中的相关 `docs/superpowers/specs/`、`plans/`、`handoffs/`。
2. 进入项目根目录：

   ```powershell
   cd 'C:\Users\Administrator\Documents\可编辑自定义产品\jersey-3d-configurator'
   git status --short
   git log --oneline -8
   ```

3. 当前根目录有用户未提交内容，必须保留且不得暂存、覆盖或提交：

   ```text
   M package-lock.json
   ?? .superpowers/
   ```

4. 任何代码改动均在新的 `codex/<topic>` 分支和 `.worktrees/codex/<topic>` 隔离工作树中完成。完成一个可验收阶段后：测试、提交、推送 `origin` 和 `backup`；未经用户确认，不合并 `showcase`、不发布。
5. 启动本地展示：`npm run dev`。构建展示版：`npm run build:showcase`。生产公开站点仅在 `showcase` 推送后由 Cloudflare 自动构建。

## 仓库与发布

- 主远程 `origin`：`https://github.com/JasonTru03/jersey-3d-configurator.git`
- 备份远程 `backup`：`https://github.com/SuJianben/Custom-made-jerseys.git`
- 发布分支：`showcase`
- Cloudflare Worker 项目：`jersey-3d-configurator`
- 公开 URL：`https://jersey-3d-configurator.jason1064969838.workers.dev/`
- 最后一次发布验证：HTTP 200，页面引用 `index-Ba1PYqyh.js`。

## 当前产品与架构

- 默认产品：`Chelsea Match Jersey`，基础价 `$89`，模型 `public/models/chelsea-jersey.glb`。
- 产品定义：`src/features/configurator/config/productDefinitions.js`。
- 页面主入口：`src/features/configurator/ui/ConfiguratorPage.jsx`。
- 全局定制状态、撤销/重做、导入/导出：`src/features/configurator/hooks/useConfigurator.js`。
- 设计文件校验与 JSON 模型：`src/features/configurator/` 下设计文件相关模块；优先通过 `rg -n "saveDesignFile|loadDesignFile|jersey-design" src` 定位，不要重复实现。
- 3D 渲染与贴花：`src/features/configurator/scene/garmentRenderer.js`。
- 贴花选中框/五个控制按钮：`src/features/configurator/scene/PrintToolbarOverlay.jsx`。
- 贴花状态更新与控制器接线：`src/features/configurator/scene/ProductStage.jsx`。
- 贴花数据工具：`src/features/configurator/config/printItems.js`。
- 页面样式：`src/features/configurator/ui/configurator.css`。

## 已完成的关键行为

### 设计文件与确认

- 支持下载和读取版本化 `jersey-design` JSON；导入会校验产品匹配，错误文件不会覆盖当前设计。
- 设计数据保留上传图片的 Data URL；撤销/重做采用不可变历史，最多 50 步。
- 顶部提供 Undo、Redo、Open design、Save design、Review design；确认弹层展示商品、选项、素材数量与报价。
- 此阶段仅做本地文件，不含服务端 `designId`、购物车、Checkout、支付。

### 贴花编辑

- 名称/号码贴花点击后才显示控制框；点击球衣空白处仅取消选中，不再把贴花移动到点击位置。
- 控制框围绕文字本体，包含：编辑、旋转、删除、复制、缩放。删除最后一个贴花后可再次从 Print 面板添加名称套装。
- 缩放使用 Pointer Capture，范围限制为 `0.45–2.5`。
- 旋转先后经历两次修复：
  1. `6bec0de` 修正顺/逆时针视觉映射。
  2. `45dda0d` 改为稳定的切线增量控制：固定 `0.5°/px`、中心保护半径 32px、单事件最大 24°，解决靠近中心时反向、不同半径手感不同和快速跳转。
- 旋转仍保存为 `0–359°`，支持连续多圈；鼠标按下但不移动不会改变角度。

## 重要文档（按推荐阅读顺序）

1. `docs/superpowers/handoffs/2026-07-14-consumer-configurator-handoff.md`：第一期整体范围、用户旅程与非目标。
2. `docs/superpowers/handoffs/2026-07-16-inline-print-selection-controls-handoff.md`：贴花选中/取消选中、工具框与缩放交互。
3. `docs/superpowers/handoffs/2026-07-16-circular-print-rotation-handoff.md`：圆形旋转手柄最初实现。
4. `docs/superpowers/handoffs/2026-07-16-print-rotation-direction-handoff.md`：顺逆时针映射修复原因。
5. `docs/superpowers/handoffs/2026-07-16-stable-print-rotation-handoff.md`：当前旋转稳定算法、参数与人工验收清单。
6. 同名 `docs/superpowers/specs/` 与 `docs/superpowers/plans/` 文件：如需改动对应功能，先读设计和实施边界。

## 验证与测试注意事项

- 在项目根目录运行 `npm test` 会递归发现 `.worktrees` 内的测试副本，因此最后一次根目录全量结果为 **116 个测试文件、362 个测试**。
- 在单独的新工作树运行 `npm test`，当前项目本体基线约为 **18 个测试文件、68 个测试**。不要把两种统计混为回归。
- 任何贴花交互改动至少运行：

  ```powershell
  npm test -- --run src/features/configurator/scene/PrintToolbarOverlay.test.jsx src/features/configurator/scene/ProductStage.test.jsx
  npm test
  npm run build:showcase
  ```

- Vite 的 JavaScript chunk 超过 500kB 警告是已知非阻塞警告；构建退出码为 0 才可称构建成功。
- 当前自动化覆盖数值、状态和构建；每次改动旋转手感后仍应在公开/本地页面人工验证：近/远半径顺逆时针、经过文字中心、快速长距离拖动、连续多圈、0/359 回绕、指针释放、点击不移动。

## 明确不要重复的错误路径

- 不要回退到“鼠标相对文字中心的绝对方位角”来计算旋转；该方案在中心附近有 180°不连续点，用户已实测出现慢速反向和快速跳转。
- 不要把用户点击球衣空白处理解为移动贴花；当前正确行为是取消选中。
- 不要把控制工具栏固定在文字旁边；用户要求选中时围绕文字本体显示，未选中必须完全隐藏。
- 不要擅自接入 Shopify 购物车、Checkout、支付或服务端保存；这些属于后续阶段，需用户明确授权。
- 不要强推、重写历史、合并 `main`，也不要触碰根目录既有 `package-lock.json` 和 `.superpowers/` 改动。

## 推荐下一步

先请用户在公开站点对当前稳定旋转手感做一轮真实体验；如果仍需微调，仅调整 `ROTATION_DEGREES_PER_PIXEL` 和 `MAX_ROTATION_DELTA`，并先写失败测试。若贴花编辑稳定，再由用户决定第二期方向：服务器保存设计，或 Shopify 加购与订单链路。
