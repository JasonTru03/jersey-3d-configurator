# 本地设计恢复与确认步骤实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为独立 3D 定制器实现可撤销编辑、可下载/导入的本地设计文件，以及消费者在下单前使用的设计确认步骤。

**Architecture:** 将设计文件格式、导入校验与编辑历史放在 `designs/` 功能模块中；`useConfigurator` 只编排产品数据、当前设计状态和动作接口；页面组件只负责触发动作和展示结果。第一期不调用服务器、不创建 Shopify Cart，现有 Shopify 嵌入版不修改。

**Tech Stack:** React 19、Vitest、Testing Library、浏览器原生 File API、现有 Three.js 舞台。

---

## 命名与边界

| 位置 | 职责 | 公开接口 |
| --- | --- | --- |
| `designs/designDocument.js` | 设计文件创建与导入校验 | `createDesignDocument`、`parseDesignDocument`、`DesignDocumentError` |
| `designs/designHistory.js` | 不可变快照、撤销与重做 | `createDesignHistory`、`recordDesignState`、`moveDesignHistory`、`getCurrentDesignState` |
| `hooks/useConfigurator.js` | 组装状态与用户操作 | `updateState`、`undo`、`redo`、`saveDesignFile`、`loadDesignFile` |
| `ui/DesignReviewDialog.jsx` | 消费者确认设计的展示与保存入口 | `DesignReviewDialog` |

文件名使用小写 kebab/camel 组合，函数使用动词开头，设计文件字段使用固定小写 camelCase。服务端第二期将使用 `/api/designs` 和 `designId`；本期不提前实现该接口。

### Task 1: 设计文件格式与导入校验

**Files:**

- Create: `src/features/configurator/designs/designDocument.js`
- Create: `src/features/configurator/designs/designDocument.test.js`

- [ ] **Step 1: 写入失败测试，定义可保存格式与产品校验**

```js
import { describe, expect, it } from 'vitest';
import { DesignDocumentError, createDesignDocument, parseDesignDocument } from './designDocument.js';

const defaultState = { productId: 'fn8788-jersey', colorway: 'home', extras: {}, overrides: { decorations: [] } };

describe('design document', () => {
  it('preserves uploaded artwork when a document is exported and imported', () => {
    const document = createDesignDocument({
      productId: 'fn8788-jersey',
      state: { ...defaultState, overrides: { decorations: [{ id: 'upload-1', kind: 'upload', source: 'data:image/png;base64,abc' }] } },
      savedAt: '2026-07-14T00:00:00.000Z',
    });

    expect(parseDesignDocument(JSON.stringify(document), { expectedProductId: 'fn8788-jersey', defaultState }))
      .toMatchObject({ overrides: { decorations: [{ source: 'data:image/png;base64,abc' }] } });
  });

  it('rejects a document for another product without returning a replacement state', () => {
    expect(() => parseDesignDocument(JSON.stringify({ format: 'jersey-design', version: 1, productId: 'other-product', state: {} }), {
      expectedProductId: 'fn8788-jersey', defaultState,
    })).toThrow(DesignDocumentError);
  });
});
```

- [ ] **Step 2: 运行测试，确认因模块不存在而失败**

Run: `npm test -- designDocument.test.js`

Expected: FAIL，提示无法解析 `./designDocument.js`。

- [ ] **Step 3: 实现最小且版本化的设计文件模块**

```js
export const DESIGN_DOCUMENT_FORMAT = 'jersey-design';
export const DESIGN_DOCUMENT_VERSION = 1;

export class DesignDocumentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DesignDocumentError';
    this.code = code;
  }
}

export function createDesignDocument({ productId, variantId = null, state, savedAt = new Date().toISOString() }) {
  return { format: DESIGN_DOCUMENT_FORMAT, version: DESIGN_DOCUMENT_VERSION, productId, variantId, savedAt, state: structuredClone(state) };
}

export function parseDesignDocument(rawText, { expectedProductId, defaultState }) {
  let document;
  try { document = JSON.parse(rawText); } catch { throw new DesignDocumentError('invalid-json', 'This design file is not valid JSON.'); }
  if (document?.format !== DESIGN_DOCUMENT_FORMAT || document.version !== DESIGN_DOCUMENT_VERSION) {
    throw new DesignDocumentError('unsupported-version', 'This design file format is not supported.');
  }
  if (document.productId !== expectedProductId) {
    throw new DesignDocumentError('product-mismatch', 'This design file belongs to a different product.');
  }
  if (!document.state || typeof document.state !== 'object') {
    throw new DesignDocumentError('invalid-state', 'This design file does not contain a design state.');
  }
  return { ...structuredClone(defaultState), ...structuredClone(document.state), extras: { ...defaultState.extras, ...document.state.extras }, overrides: { ...defaultState.overrides, ...document.state.overrides } };
}
```

- [ ] **Step 4: 运行模块测试，确认导入图片、版本校验和产品校验通过**

Run: `npm test -- designDocument.test.js`

Expected: PASS，2 项测试通过。

- [ ] **Step 5: 提交设计文件模块**

```bash
git add src/features/configurator/designs/designDocument.js src/features/configurator/designs/designDocument.test.js
git commit -m "feat: add versioned design document format"
```

### Task 2: 编辑历史模块与 Hook 状态接口

**Files:**

- Create: `src/features/configurator/designs/designHistory.js`
- Create: `src/features/configurator/designs/designHistory.test.js`
- Modify: `src/features/configurator/hooks/useConfigurator.js`

- [ ] **Step 1: 写入失败测试，定义 50 步历史和重做截断行为**

```js
import { describe, expect, it } from 'vitest';
import { createDesignHistory, getCurrentDesignState, moveDesignHistory, recordDesignState } from './designHistory.js';

describe('design history', () => {
  it('drops redo states after recording a new change from an undone state', () => {
    let history = createDesignHistory({ colorway: 'home' });
    history = recordDesignState(history, { colorway: 'away' });
    history = recordDesignState(history, { colorway: 'third' });
    history = moveDesignHistory(history, -1);
    history = recordDesignState(history, { colorway: 'home' });

    expect(history.entries).toHaveLength(3);
    expect(getCurrentDesignState(history)).toEqual({ colorway: 'home' });
    expect(moveDesignHistory(history, 1)).toBe(history);
  });
});
```

- [ ] **Step 2: 运行测试，确认因历史模块不存在而失败**

Run: `npm test -- designHistory.test.js`

Expected: FAIL，提示无法解析 `./designHistory.js`。

- [ ] **Step 3: 实现独立历史模块，并将 Hook 改为只暴露稳定动作名**

```js
export const DESIGN_HISTORY_LIMIT = 50;

export function createDesignHistory(initialState) {
  return { entries: [structuredClone(initialState)], cursor: 0 };
}

export function recordDesignState(history, nextState) {
  if (JSON.stringify(getCurrentDesignState(history)) === JSON.stringify(nextState)) return history;
  const entries = [...history.entries.slice(0, history.cursor + 1), structuredClone(nextState)].slice(-DESIGN_HISTORY_LIMIT);
  return { entries, cursor: entries.length - 1 };
}

export function moveDesignHistory(history, offset) {
  const cursor = Math.min(history.entries.length - 1, Math.max(0, history.cursor + offset));
  return cursor === history.cursor ? history : { ...history, cursor };
}

export function getCurrentDesignState(history) {
  return history ? structuredClone(history.entries[history.cursor]) : null;
}
```

在 `useConfigurator` 中用 `history` 代替单独的 `state`：`updateState` 使用 `mergeConfiguratorState(getCurrentDesignState(history), patch)` 后调用 `recordDesignState`；新增 `undo`、`redo`、`canUndo`、`canRedo`。报价继续由当前状态计算，不能在 UI 组件中复制计价规则。

- [ ] **Step 4: 运行历史与现有状态测试**

Run: `npm test -- designHistory.test.js state.test.js ConfiguratorPage.test.jsx`

Expected: PASS，历史行为与现有选项更新均通过。

- [ ] **Step 5: 提交历史模块与 Hook 接口调整**

```bash
git add src/features/configurator/designs/designHistory.js src/features/configurator/designs/designHistory.test.js src/features/configurator/hooks/useConfigurator.js
git commit -m "feat: add reversible configurator state history"
```

### Task 3: 本地保存与导入的浏览器适配

**Files:**

- Create: `src/features/configurator/designs/designFileBrowser.js`
- Create: `src/features/configurator/designs/designFileBrowser.test.js`
- Modify: `src/features/configurator/hooks/useConfigurator.js`

- [ ] **Step 1: 写入失败测试，定义下载文件名与导入错误边界**

```js
import { describe, expect, it, vi } from 'vitest';
import { createDesignDownload, readDesignFile } from './designFileBrowser.js';

describe('designFileBrowser', () => {
  it('creates a JSON download named with the product id', () => {
    const result = createDesignDownload({ productId: 'fn8788-jersey', savedAt: '2026-07-14T00:00:00.000Z', state: {} });
    expect(result.filename).toBe('fn8788-jersey-design.json');
    expect(result.blob.type).toBe('application/json');
  });

  it('rejects a missing file before parsing', async () => {
    await expect(readDesignFile(null)).rejects.toThrow('Choose a design file first.');
  });
});
```

- [ ] **Step 2: 运行测试，确认因浏览器适配模块不存在而失败**

Run: `npm test -- designFileBrowser.test.js`

Expected: FAIL，提示无法解析 `./designFileBrowser.js`。

- [ ] **Step 3: 实现文件创建和读取，并在 Hook 中接入保存/加载动作**

```js
export function createDesignDownload(document) {
  return {
    filename: `${document.productId}-design.json`,
    blob: new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }),
  };
}

export async function readDesignFile(file) {
  if (!file) throw new Error('Choose a design file first.');
  return file.text();
}
```

`useConfigurator` 新增 `saveDesignFile()`，返回 `{ filename, blob }`；新增 `loadDesignFile(file)`，调用 `readDesignFile` 与 `parseDesignDocument`，成功后用 `createDesignHistory(parsedState)` 重置历史，失败后返回 `{ ok: false, message }` 且保留当前历史。Hook 不直接调用 `URL.createObjectURL` 或操作 DOM。

- [ ] **Step 4: 运行文件模块与 Hook 相关测试**

Run: `npm test -- designFileBrowser.test.js designDocument.test.js ConfiguratorPage.test.jsx`

Expected: PASS，文件命名、读取失败、导入校验与现有页面行为通过。

- [ ] **Step 5: 提交浏览器文件适配与 Hook 动作**

```bash
git add src/features/configurator/designs/designFileBrowser.js src/features/configurator/designs/designFileBrowser.test.js src/features/configurator/hooks/useConfigurator.js
git commit -m "feat: add local design file actions"
```

### Task 4: 顶部编辑工具与消费者确认步骤

**Files:**

- Create: `src/features/configurator/ui/DesignReviewDialog.jsx`
- Create: `src/features/configurator/ui/DesignReviewDialog.test.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css`

- [ ] **Step 1: 写入失败组件测试，描述消费者可见行为**

```jsx
it('lets a shopper undo an option change and open the design review', async () => {
  render(<ConfiguratorPage />);
  await screen.findByText('FN8788 Match Jersey');
  fireEvent.click(screen.getByRole('button', { name: 'Colorway' }));
  fireEvent.click(screen.getByRole('button', { name: /Away Black/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByRole('button', { name: /Home White/i })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
  expect(screen.getByRole('dialog', { name: 'Review your design' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行页面测试，确认工具与确认步骤尚不存在**

Run: `npm test -- ConfiguratorPage.test.jsx`

Expected: FAIL，找不到 `Undo` 或 `Review design` 按钮。

- [ ] **Step 3: 实现小型 UI 组件和页面连接，不修改 Shopify 嵌入版**

`DesignReviewDialog` 接收 `open`、`product`、`selected`、`quote`、`onClose`、`onSave`；使用 `role="dialog"` 和 `aria-modal="true"`，展示商品名、尺寸、颜色、面料、印字、素材数量与总价。仅提供“继续编辑”和“保存设计文件”两个动作，并显示“购物车与付款将在服务端连接后开放”。

在 `ConfiguratorPage` 的 `TopBar` 中增加：

```jsx
<button aria-label="Undo" className="icon-button" disabled={!canUndo} onClick={undo} type="button"><Undo2 size={18} /></button>
<button aria-label="Redo" className="icon-button" disabled={!canRedo} onClick={redo} type="button"><Redo2 size={18} /></button>
<button className="soft-button" onClick={handleSaveDesign} type="button"><Save size={17} />Save design</button>
<button className="primary-button" onClick={() => setReviewOpen(true)} type="button">Review design</button>
<input accept="application/json" hidden onChange={handleLoadDesign} ref={fileInputRef} type="file" />
```

`handleSaveDesign` 只负责把 Hook 返回的 `{ blob, filename }` 通过一次性 `URL.createObjectURL` 下载，并立即释放 URL；`handleLoadDesign` 将 Hook 返回的失败信息显示为用户可读的页面提示。新增 CSS 仅覆盖禁用按钮、确认对话框、错误提示和移动端弹层，不修改现有面板视觉体系。

- [ ] **Step 4: 运行页面测试与浏览器实际链路**

Run: `npm test -- ConfiguratorPage.test.jsx DesignReviewDialog.test.jsx`

Expected: PASS，撤销、重做、保存入口、导入错误与确认步骤通过。

Manual: 启动 `npm run dev`，修改颜色并添加上传图片，保存文件；刷新页面后通过“打开设计”导入；确认颜色、图片、位置、大小、旋转与保存前一致；打开确认步骤检查摘要。

- [ ] **Step 5: 提交消费者工具与确认步骤**

```bash
git add src/features/configurator/ui/DesignReviewDialog.jsx src/features/configurator/ui/DesignReviewDialog.test.jsx src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/ui/configurator.css
git commit -m "feat: add design review and local recovery controls"
```

### Task 5: 完整验证与项目记录

**Files:**

- Create: `project-logs/changes/2026-07-14-local-design-recovery.md`
- Create: `project-logs/chat/2026-07-14-local-design-recovery.md`

- [ ] **Step 1: 写中文变更记录和英文交接摘要**

`project-logs/changes/2026-07-14-local-design-recovery.md` 使用以下结构：

```md
# 2026-07-14 本地设计恢复

## 本次目标

为独立定制器提供撤销、重做、本地保存、导入恢复和设计确认步骤。

## 修改范围

- 设计文件格式、导入校验和编辑历史。
- 独立定制器的顶部工具与确认步骤。
- 不修改 Shopify 嵌入版、服务器或支付流程。

## 验证结果

- 自动化测试：记录 `npm test` 的测试文件数、测试数和退出状态。
- 构建：记录 `npm run build` 的应用版与 Shopify 嵌入版退出状态及既有包体积提示。
- 浏览器：记录保存、刷新、导入恢复和错误文件保护的观察结果。

## 已知边界

- 上传图片仍嵌入本地 JSON；第二期会替换为服务器素材 ID。
- 加购与付款等待设计服务和 Shopify Cart 对接后实现。
```

`project-logs/chat/2026-07-14-local-design-recovery.md` 使用以下结构：

```md
# Local Design Recovery Handoff

## Delivered

- `designDocument` owns versioned export and import validation.
- `designHistory` owns bounded immutable undo/redo snapshots.
- `designFileBrowser` owns Blob creation and File text reading.

## Boundary

- Local upload Data URLs remain only for offline recovery.
- Stage 2 replaces upload sources with server asset IDs before a design can receive a `designId`.
- Shopify Cart and Checkout remain out of this delivery.
```

- [ ] **Step 2: 执行完整自动化验证**

Run: `npm test`

Expected: 所有 Vitest 测试通过。

- [ ] **Step 3: 执行两种生产构建**

Run: `npm run build`

Expected: 应用版与 Shopify 嵌入版均构建成功；若只出现既有包体积警告，记录但不将其标为本期失败。

- [ ] **Step 4: 完成浏览器验收**

Manual: 验证撤销/重做禁用状态、保存/导入完整恢复、导入错误保护、确认步骤摘要和移动端基础布局；记录控制台错误情况。

- [ ] **Step 5: 提交日志并推送当前分支**

```bash
git add project-logs/changes/2026-07-14-local-design-recovery.md project-logs/chat/2026-07-14-local-design-recovery.md
git commit -m "docs: record local design recovery delivery"
git push origin codex/interactive-jersey-editor
```

## 计划自检

- 规格覆盖：Task 1-3 覆盖本地设计文件与导入保护；Task 2 覆盖撤销/重做；Task 4 覆盖消费者确认步骤；Task 5 覆盖自动化、构建、浏览器验证与日志。服务器保存、加购和付款明确不在本计划范围。
- 命名一致性：设计文件统一使用 `DesignDocument`/`designId`；历史统一使用 `DesignHistory`；Hook 用户动作统一使用动词 `undo`、`redo`、`saveDesignFile`、`loadDesignFile`。
- 范围控制：不新增依赖，不修改 Shopify 嵌入版，不创建 `/api/designs`，避免为第三期预先写服务端空壳。
