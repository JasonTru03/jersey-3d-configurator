# 球衣交互编辑器实施计划

> **执行要求：** 按任务逐项执行，先写测试并确认失败，再写最小实现；每个任务结束后运行指定测试并提交。

**目标：** 为球衣 3D Demo 增加预设/上传素材的可视化编辑能力，支持区域、选择、移动、缩放、旋转和删除。

**架构：** 使用一个独立的 `decorationEditor` 场景模块维护可编辑的 Three.js 精灵图层及其交互。配置和纯变换逻辑放到 `config/decorations.js`，UI 仅负责发起状态变更与展示上传错误。现有 `GarmentRenderer` 保留模型和相机控制，并在编辑期间临时禁用 OrbitControls。

**技术栈：** React 19、Three.js、Vitest、Testing Library、Vite。

---

## 文件结构

- 新增 `src/features/configurator/config/decorations.js`：素材数据、上传校验、坐标/缩放限制和不可变状态更新。
- 新增 `src/features/configurator/config/decorations.test.js`：纯逻辑测试。
- 新增 `src/features/configurator/scene/decorationEditor.js`：3D 贴花精灵、选中框、拖动/缩放/旋转交互。
- 修改 `src/features/configurator/config/productDefinitions.js`：预设花纹、徽章、四个可编辑区域和默认状态。
- 修改 `src/features/configurator/scene/garmentRenderer.js`：集成编辑器、协调视角控制。
- 修改 `src/features/configurator/ui/ConfiguratorPage.jsx`：素材面板、上传、区域与删除按钮。
- 修改 `src/features/configurator/ui/configurator.css`：素材卡片、上传提示、可访问焦点样式和移动端布局。
- 修改 `src/features/configurator/shopify/ShopifyConfiguratorSection.jsx`：复用素材面板并将配置写入 `_3D Config JSON`。
- 修改相应组件测试与中文项目日志。

## 任务 1：定义可序列化素材状态与上传校验

**文件：**

- 新增：`src/features/configurator/config/decorations.js`
- 新增：`src/features/configurator/config/decorations.test.js`
- 修改：`src/features/configurator/config/productDefinitions.js`

- [ ] 1. 先写失败测试，明确允许 `image/png`、`image/jpeg`、`image/webp`、`image/svg+xml`，并拒绝其他格式及大于 `5 * 1024 * 1024` 字节的文件。

```js
expect(validateDecorationFile({ type: 'image/png', size: 1024 })).toEqual({ ok: true });
expect(validateDecorationFile({ type: 'image/gif', size: 1024 })).toMatchObject({ ok: false });
expect(validateDecorationFile({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toMatchObject({ ok: false });
```

- [ ] 2. 运行 `npm test -- decorations.test.js`，确认因为目标模块不存在而失败。

- [ ] 3. 实现 `validateDecorationFile`、`createDecoration`、`patchDecoration`、`removeDecoration`；状态字段统一为 `id`、`kind`、`source`、`label`、`region`、`x`、`y`、`scale`、`rotation`。

```js
export const EDITABLE_REGIONS = ['front', 'back', 'left-sleeve', 'right-sleeve'];
export const MAX_DECORATIONS = 8;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
```

- [ ] 4. 增加位置、缩放（0.35–2.4）与角度（-180–180）限制测试，然后运行 `npm test -- decorations.test.js`，确认通过。

- [ ] 5. 在 `productDefinitions.js` 增加小型预设清单（至少两个花纹、两个徽章）、四个区域和空的 `overrides.decorations`。

- [ ] 6. 提交：`git add src/features/configurator/config src/features/configurator/config/productDefinitions.js && git commit -m "feat: add decoration state helpers"`。

## 任务 2：实现 Three.js 素材编辑层

**文件：**

- 新增：`src/features/configurator/scene/decorationEditor.js`
- 新增：`src/features/configurator/scene/decorationEditor.test.js`
- 修改：`src/features/configurator/scene/garmentRenderer.js`

- [ ] 1. 先写失败测试，验证编辑器将配置变换为受限的精灵变换，并在没有选中项时报告 `isEditing: false`。

```js
expect(toSpriteTransform({ x: 9, y: -9, scale: 9, rotation: 300 })).toEqual({
  x: 1, y: -1, scale: 2.4, rotation: 180,
});
```

- [ ] 2. 运行 `npm test -- decorationEditor.test.js`，确认失败原因是模块未实现。

- [ ] 3. 用 `THREE.Sprite` 加载预设数据 URL 或上传 data URL；每个区域使用固定锚点和安全边界。选中素材时添加边框、四个缩放点和旋转手柄的视觉提示。

- [ ] 4. 实现指针命中、拖动、角点缩放、旋转手柄旋转、空白处取消选择；每次编辑通过 `onDecorationsChange` 写回序列化状态。

- [ ] 5. 在 `GarmentRenderer` 创建/更新/销毁编辑器，将 `controls.enabled` 设为 `!editor.isEditing()`，并保持旧的名字号码交互不变。

- [ ] 6. 运行 `npm test -- decorationEditor.test.js`，确认通过；再运行 `npm test`，确认全量回归通过。

- [ ] 7. 提交：`git add src/features/configurator/scene && git commit -m "feat: add editable decoration layer"`。

## 任务 3：增加本地配置器素材面板

**文件：**

- 修改：`src/features/configurator/ui/ConfiguratorPage.jsx`
- 修改：`src/features/configurator/ui/ConfiguratorPage.test.jsx`
- 修改：`src/features/configurator/ui/configurator.css`

- [ ] 1. 先扩展组件失败测试：打开 `Extras` 后能选择 `徽章与花纹` 面板；点击预设会把相应装饰写入状态；选择大于 5 MB 的 PNG 时显示中文错误。

```jsx
fireEvent.click(screen.getByRole('button', { name: '徽章与花纹' }));
fireEvent.click(screen.getByRole('button', { name: /Golden Stripe/ }));
expect(await screen.findByText('Golden Stripe 已添加')).toBeInTheDocument();
```

- [ ] 2. 运行 `npm test -- ConfiguratorPage.test.jsx`，确认因控件不存在而失败。

- [ ] 3. 实现 `DecorationPanel`，包括：正面/背面/左袖/右袖区域按钮、预设素材按钮、隐藏文件 input 与上传按钮、选中素材名称和删除按钮。

- [ ] 4. 将上传文件转换为 data URL；校验失败显示中文错误，读取失败显示“图片无法读取，请更换文件”。达到 8 个素材时禁用新增操作并显示“最多可添加 8 个素材”。

- [ ] 5. 在 CSS 中提供素材缩略图、按钮 active/focus 状态、错误提示，以及 720px 下不横向溢出的单列布局。

- [ ] 6. 运行 `npm test -- ConfiguratorPage.test.jsx`，确认通过；运行 `npm test` 确认全量测试通过。

- [ ] 7. 提交：`git add src/features/configurator/ui && git commit -m "feat: add decoration controls"`。

## 任务 4：同步 Shopify 配置与测试

**文件：**

- 修改：`src/features/configurator/shopify/ShopifyConfiguratorSection.jsx`
- 修改：`src/features/configurator/shopify/ShopifyConfiguratorSection.test.jsx`
- 修改：`src/features/configurator/shopify/shopify-configurator.css`

- [ ] 1. 先扩展 Shopify 组件失败测试：选中预设素材后，`_3D Config JSON` 包含 `overrides.decorations` 的预设 ID、区域与变换字段。

```js
expect(JSON.parse(document.querySelector('input[name="properties[_3D Config JSON]"]').value).state.overrides.decorations[0])
  .toMatchObject({ kind: 'preset', source: 'golden-stripe', region: 'front' });
```

- [ ] 2. 运行 `npm test -- ShopifyConfiguratorSection.test.jsx`，确认该配置尚不存在而失败。

- [ ] 3. 复用本地 `DecorationPanel` 的纯 UI 逻辑或抽出共享组件，避免复制上传校验和状态更新代码。

- [ ] 4. 让 Shopify CSS 与现有 section 视觉一致，并包含错误与禁用状态。

- [ ] 5. 运行 `npm test -- ShopifyConfiguratorSection.test.jsx`，确认通过；运行 `npm test`，确认全量测试通过。

- [ ] 6. 提交：`git add src/features/configurator/shopify && git commit -m "feat: sync decoration configuration to Shopify"`。

## 任务 5：真实浏览器验证、构建与项目记录

**文件：**

- 修改：`project-logs/changes/2026-07-13-interactive-jersey-editor.md`
- 修改：`project-logs/chat/2026-07-13-interactive-jersey-editor.md`

- [ ] 1. 运行 `npm run build`，确认应用和 Shopify bundle 构建成功。

- [ ] 2. 启动 `npm run dev -- --host 127.0.0.1`，使用浏览器真实验证：选择预设、上传合法 PNG、拖动、缩放、旋转、删除、切换区域；取消选中后拖动球衣视角、滚轮缩放，且移动端 390px 宽度无横向滚动。

- [ ] 3. 在变更日志用中文记录实际修改文件、验证命令和限制；在英文内部记录中写入实现决策与后续升级到网格贴花的入口。

- [ ] 4. 运行 `git diff --check && git status --short && npm test && npm run build`，逐项核对无格式错误、测试通过、构建通过。

- [ ] 5. 提交：`git add project-logs && git commit -m "docs: record editor verification"`。

- [ ] 6. 推送：`git push -u origin codex/interactive-jersey-editor`；若远程认证失败，保留本地提交并报告失败原文。
