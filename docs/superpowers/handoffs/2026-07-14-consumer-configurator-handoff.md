# 3D 球衣定制器执行交接说明

## 交接目的

本文件是新计划任务的入口。目标不是重新讨论产品方向，而是在已确认的消费者路径下，执行第一期“本地设计恢复与确认步骤”。

## 工作位置与版本状态

- 项目工作目录：`C:\Users\Administrator\Documents\可编辑自定义产品\jersey-3d-configurator\.worktrees\codex\interactive-jersey-editor`
- 当前分支：`codex/interactive-jersey-editor`
- 已完成的 3D 素材第一版：预设图案/徽章、上传图片、拖动、缩放、旋转、四个放置区域，以及素材实际渲染修复。
- 当前计划基线提交：`2e852ad docs: plan local design recovery`。
- 本次交接时工作区应保持干净；新任务开始前先运行 `git status --short`，若出现非本任务改动，不要覆盖、暂存或提交它们。

## 必读顺序

1. 本文件：确认当前任务范围和禁止事项。
2. [消费者定制闭环与设计文件设计说明](../specs/2026-07-14-local-design-files-design.md)：理解完整产品路径与第二、三期边界。
3. [本地设计恢复与确认步骤实施计划](../plans/2026-07-14-local-design-recovery.md)：第一期唯一可执行计划，按任务顺序和 TDD 步骤推进。
4. `project-logs/chat/2026-07-13-interactive-jersey-editor.md`：了解已实现的 3D 图层、状态字段与历史渲染问题。
5. `project-logs/changes/2026-07-13-interactive-jersey-editor.md` 及 `project-logs/bugs/2026-07-13-artwork-not-visible.md`：了解交付记录和已修复缺陷。

若本文件与实施计划冲突，以实施计划为准；若实施计划与消费者闭环说明冲突，以消费者闭环说明为准，并在开始编码前向用户说明冲突。

## 已确认的消费者路径

1. 消费者从 Shopify 产品页点击“开始定制”，进入独立 3D 定制页面。
2. 消费者选择款式、颜色、文字号码、图案/徽章或上传图片，并在 3D 模型上调整素材。
3. 消费者查看设计确认信息。
4. 未来可选择加入 Shopify 购物车或直接跳转 Shopify Checkout。

定制器页面是独立 Web 应用，因此不受 Shopify 主题页面结构约束；但商品、可信价格、购物车、库存、支付和订单仍应由 Shopify 负责。

## 当前执行范围：第一期

本期只实现下列功能：

- 撤销、重做，最多 50 个设计快照。
- 下载和打开版本化 `.json` 设计文件。
- 设计文件完整保留上传图片的 Data URL，以及颜色、文字、号码、预设素材、区域、位置、大小和旋转。
- 导入时校验文件格式、版本和产品标识；错误文件不得改变当前设计。
- 增加消费者设计确认步骤，展示当前商品、选项、素材数量和报价，并提供保存设计入口。

本期不实现：服务器、图片上传 API、`designId`、Shopify Cart、Checkout、支付、分享设计、账户、登录、网格投影贴花、AI Logo、批量姓名号码或复杂图层管理。

## 模块命名与职责

| 模块 | 责任 | 公开命名 |
| --- | --- | --- |
| `src/features/configurator/designs/designDocument.js` | 创建与校验版本化 JSON | `createDesignDocument`、`parseDesignDocument`、`DesignDocumentError` |
| `src/features/configurator/designs/designHistory.js` | 不可变编辑快照和游标移动 | `createDesignHistory`、`recordDesignState`、`moveDesignHistory`、`getCurrentDesignState` |
| `src/features/configurator/designs/designFileBrowser.js` | `Blob` 下载对象与文件文本读取 | `createDesignDownload`、`readDesignFile` |
| `src/features/configurator/hooks/useConfigurator.js` | 连接产品、报价、历史与用户动作 | `updateState`、`undo`、`redo`、`saveDesignFile`、`loadDesignFile` |
| `src/features/configurator/ui/DesignReviewDialog.jsx` | 消费者确认步骤 | `DesignReviewDialog` |

规则：业务规则和文件校验必须在纯模块中，不要塞入 `ConfiguratorPage.jsx`；Hook 不直接操作 DOM；页面层仅负责显示和调用动作；不要创建尚未使用的服务器接口或“通用”抽象层。

## 关键数据约定

```json
{
  "format": "jersey-design",
  "version": 1,
  "productId": "fn8788-jersey",
  "variantId": null,
  "savedAt": "ISO-8601 时间",
  "state": {
    "layout": "m",
    "colorway": "home",
    "material": "stadium",
    "lighting": "none",
    "extras": {},
    "overrides": {
      "printName": "PLAYER",
      "printNumber": "16",
      "printPlacement": {},
      "decorations": []
    }
  }
}
```

- 预设素材以已有预设标识保存。
- 第一期用户上传图片以 Data URL 保存，确保离线导入后能够恢复；第二期服务端接入后以素材 ID 替换。
- 不保存当前展开面板、主题、提示文字和鼠标选中状态等临时 UI 状态。
- 现有产品 ID 是 `fn8788-jersey`，不得写成其他相似名称。

## 代码与验证纪律

1. 先读 `C:\Users\Administrator\.codex\AGENTS.md` 及当前任务命中的全局规则。
2. 在每个功能模块先写失败测试，确认失败原因正确，再写最小实现；不要先写生产代码。
3. 使用 `apply_patch` 修改文件；不改无关代码，不新增依赖。
4. 每个计划任务结束后运行对应的 Vitest 测试；完成后运行 `npm test`、`npm run build` 和浏览器真实交互验收。
5. 更新中文变更日志与英文交接日志；提交前检查 `git status --short` 只包含本任务文件。
6. 不合并到 `main`，不修改线上 Shopify 主题、商品、库存、订单或结账设置。

## 已知风险与历史修复

- 首版 3D 素材使用相机朝向的编辑图层，不是贴合衣服网格的真实贴花；不要在第一期顺手改为投影贴花。
- `Roundel Badge` 曾出现“右侧显示已添加、模型上不可见”。已改为 `MeshBasicMaterial` 平面配合 `CanvasTexture`，浏览器已验证可见。不要回退到 `Sprite` 图片路径。
- 本地文件内嵌上传图片会使 JSON 体积增大；这是第一期的明确取舍，第二期应改为服务器素材 ID。
- 构建会出现既有 JavaScript 包体积警告；如构建退出码为 0，记录警告但不要把它当作本期失败。

## 第二、三期衔接，不在本期实现

- 第二期：`POST /api/designs` 保存设计和上传图片，返回 `designId` 与预览信息。
- 第三期：服务器验证 `designId` 后创建 Shopify Cart；“加入购物车”跳转购物车，“立即付款”跳转 Cart API 返回的 `checkoutUrl`。
- 购物车行项目仅保存 `designId`、简短摘要和预览地址；不写入完整 JSON 或 Data URL。

## 新任务的首个动作

从实施计划的 **Task 1** 开始：先创建 `designDocument.test.js`，运行指定测试确认模块缺失导致失败，再实现 `designDocument.js`。在该任务完成并通过测试前，不要开始撤销/重做或 UI 改动。
