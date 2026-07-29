# 个性化元素正背面统一实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为球员姓名号码、自定义文字、预设图片和上传图片提供统一的 `Front / Back` 控件，并在切换面时自动旋转球衣到对应视角。

**Architecture:** 将正背面定义、默认位置和位置判断放入独立配置模块，将按钮渲染放入共用 UI 组件。两个编辑面板只负责修改当前元素并发出视角请求；配置页面把带序号的请求传给 3D 舞台，舞台调用渲染器的正面或背面相机预设。

**Tech Stack:** React 19、Three.js、GSAP、Vitest、Testing Library、Vite、Cloudflare Workers/Wrangler。

---

## 文件职责

- 新建 `src/features/configurator/config/personalizationSides.js`：正背面枚举、默认文字类位置、位置到面的判断。
- 新建 `src/features/configurator/config/personalizationSides.test.js`：正背面纯逻辑回归测试。
- 新建 `src/features/configurator/ui/PersonalizationSideSelector.jsx`：统一的 `Front / Back` 按钮组件。
- 新建 `src/features/configurator/ui/PersonalizationSideSelector.test.jsx`：选择状态、禁用状态和回调测试。
- 修改 `src/features/configurator/ui/PersonalizePanel.jsx`：球员姓名号码和自定义文字共用正背面控件。
- 修改 `src/features/configurator/ui/PersonalizePanel.test.jsx`：验证切面、重复点击和其他元素不变。
- 修改 `src/features/configurator/ui/DecorationPanel.jsx`：预设图片和上传图片增加正背面控件。
- 修改 `src/features/configurator/ui/DecorationPanel.test.jsx`：验证图片区域切换和旧投影清除。
- 修改 `src/features/configurator/ui/ConfiguratorPage.jsx`：协调面板发出的视角请求。
- 修改 `src/features/configurator/ui/ConfiguratorPage.test.jsx`：验证正背面请求传给 3D 舞台。
- 修改 `src/features/configurator/scene/ProductStage.jsx`：收到新的请求时调用渲染器视角方法。
- 修改 `src/features/configurator/scene/ProductStage.test.jsx`：验证重复请求也会执行。
- 修改 `src/features/configurator/scene/garmentRenderer.js`：补充稳定的正面和背面相机预设。
- 修改 `src/features/configurator/scene/garmentRenderer.test.js`：验证背面相机位于球衣负 Z 方向。
- 新建 `project-logs/changes/2026-07-29-unified-personalization-sides.md`：记录交付范围、验证和线上版本。

### Task 1：建立共用正背面规则

**Files:**
- Create: `src/features/configurator/config/personalizationSides.js`
- Create: `src/features/configurator/config/personalizationSides.test.js`

- [ ] **Step 1：先写失败测试**

```js
import { describe, expect, it } from 'vitest';
import {
  getPersonalizationSide,
  getPersonalizationSidePlacement,
  PERSONALIZATION_SIDES,
} from './personalizationSides.js';

describe('personalization sides', () => {
  it('defines front and back in stable display order', () => {
    expect(PERSONALIZATION_SIDES).toEqual([
      { id: 'front', label: 'Front' },
      { id: 'back', label: 'Back' },
    ]);
  });

  it('returns independent default placements for the selected side', () => {
    const first = getPersonalizationSidePlacement('back');
    const second = getPersonalizationSidePlacement('back');

    expect(first).toEqual({
      x: 0,
      y: 0.36,
      z: -0.5,
      normal: { x: 0, y: 0, z: -1 },
    });
    expect(first).not.toBe(second);
    expect(first.normal).not.toBe(second.normal);
  });

  it('derives the side from the normal and falls back to the Z position', () => {
    expect(getPersonalizationSide({ z: 0.5, normal: { z: -1 } })).toBe('back');
    expect(getPersonalizationSide({ z: -0.5 })).toBe('back');
    expect(getPersonalizationSide(null)).toBe('front');
  });
});
```

- [ ] **Step 2：运行测试并确认因模块不存在而失败**

Run:

```powershell
npm test -- --run src/features/configurator/config/personalizationSides.test.js
```

Expected: FAIL，提示无法解析 `./personalizationSides.js`。

- [ ] **Step 3：实现最小正背面模块**

```js
export const PERSONALIZATION_SIDES = Object.freeze([
  Object.freeze({ id: 'front', label: 'Front' }),
  Object.freeze({ id: 'back', label: 'Back' }),
]);

const SIDE_PLACEMENTS = Object.freeze({
  front: Object.freeze({
    x: 0,
    y: 0.36,
    z: 0.5,
    normal: Object.freeze({ x: 0, y: 0, z: 1 }),
  }),
  back: Object.freeze({
    x: 0,
    y: 0.36,
    z: -0.5,
    normal: Object.freeze({ x: 0, y: 0, z: -1 }),
  }),
});

export function getPersonalizationSide(placement) {
  const normalZ = Number(placement?.normal?.z);
  if (Number.isFinite(normalZ) && normalZ < 0) return 'back';
  return Number(placement?.z) < 0 ? 'back' : 'front';
}

export function getPersonalizationSidePlacement(side) {
  const placement = SIDE_PLACEMENTS[side] ?? SIDE_PLACEMENTS.front;
  return {
    ...placement,
    normal: { ...placement.normal },
  };
}
```

- [ ] **Step 4：运行测试并确认通过**

Run:

```powershell
npm test -- --run src/features/configurator/config/personalizationSides.test.js
```

Expected: 3 tests passed。

- [ ] **Step 5：提交共用规则**

```powershell
git add -- src/features/configurator/config/personalizationSides.js src/features/configurator/config/personalizationSides.test.js
git commit -m "feat: add shared personalization side rules"
```

### Task 2：建立统一正背面按钮组件

**Files:**
- Create: `src/features/configurator/ui/PersonalizationSideSelector.jsx`
- Create: `src/features/configurator/ui/PersonalizationSideSelector.test.jsx`

- [ ] **Step 1：先写失败组件测试**

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonalizationSideSelector } from './PersonalizationSideSelector.jsx';

describe('PersonalizationSideSelector', () => {
  it('shows the active side and emits the selected side', () => {
    const onSelect = vi.fn();
    render(<PersonalizationSideSelector onSelect={onSelect} side="front" />);

    expect(screen.getByRole('button', { name: 'Front' }))
      .toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onSelect).toHaveBeenCalledWith('back');
  });

  it('disables both controls while mutations are locked', () => {
    render(<PersonalizationSideSelector disabled onSelect={vi.fn()} side="back" />);
    expect(screen.getByRole('button', { name: 'Front' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });
});
```

- [ ] **Step 2：运行测试并确认失败**

Run:

```powershell
npm test -- --run src/features/configurator/ui/PersonalizationSideSelector.test.jsx
```

Expected: FAIL，提示组件文件不存在。

- [ ] **Step 3：实现共用组件**

```jsx
import { PERSONALIZATION_SIDES } from '../config/personalizationSides.js';

export function PersonalizationSideSelector({
  disabled = false,
  onSelect,
  side,
}) {
  return (
    <fieldset>
      <legend>Side</legend>
      <div className="font-options">
        {PERSONALIZATION_SIDES.map((option) => (
          <button
            aria-pressed={side === option.id}
            disabled={disabled}
            key={option.id}
            onClick={() => onSelect(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4：运行组件测试并确认通过**

Run:

```powershell
npm test -- --run src/features/configurator/ui/PersonalizationSideSelector.test.jsx
```

Expected: 2 tests passed。

- [ ] **Step 5：提交统一组件**

```powershell
git add -- src/features/configurator/ui/PersonalizationSideSelector.jsx src/features/configurator/ui/PersonalizationSideSelector.test.jsx
git commit -m "feat: add personalization side selector"
```

### Task 3：让球员姓名号码和自定义文字共用正背面选择

**Files:**
- Modify: `src/features/configurator/ui/PersonalizePanel.jsx`
- Modify: `src/features/configurator/ui/PersonalizePanel.test.jsx`

- [ ] **Step 1：先补球员姓名号码的失败测试**

先在现有测试工具参数中加入：

```jsx
function PersonalizeHarness({
  initialState = jerseyProduct.defaultState,
  initialSelection = null,
  onSideFocus = vi.fn(),
  onStateChange = vi.fn(),
  onUpdate = vi.fn(),
  updateDeferred = null,
}) {
```

并在现有 `<PersonalizePanel>` 调用中加入：

```jsx
<PersonalizePanel
  deletePending={deletion.deletePending}
  deletePersonalization={deletion.deletePersonalization}
  onSelect={setSelectedKey}
  onSideFocus={onSideFocus}
  selectedKey={selectedKey}
  state={state}
  updateState={updateState}
/>
```

新增球员测试：

```jsx
it('moves a player set to the back and requests the back view', async () => {
  const onSideFocus = vi.fn();
  const onStateChange = vi.fn();
  const initialState = structuredClone(jerseyProduct.defaultState);
  initialState.lighting = 'name-number';
  initialState.overrides.printItems = [{
    id: 'player',
    name: 'PLAYER',
    number: '16',
    placement: {
      x: 0.2,
      y: 0.4,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    },
  }];
  render(
    <PersonalizeHarness
      initialSelection="player:player"
      initialState={initialState}
      onSideFocus={onSideFocus}
      onStateChange={onStateChange}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));

  await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      overrides: expect.objectContaining({
        printItems: [expect.objectContaining({
          placement: {
            x: 0,
            y: 0.36,
            z: -0.5,
            normal: { x: 0, y: 0, z: -1 },
          },
        })],
      }),
    }),
  ));
  expect(onSideFocus).toHaveBeenCalledWith('back');
});
```

- [ ] **Step 2：补“重复点击不重置位置”的失败测试**

```jsx
it('focuses the current side without resetting a dragged placement', async () => {
  const onSideFocus = vi.fn();
  const onStateChange = vi.fn();
  const initialState = structuredClone(jerseyProduct.defaultState);
  initialState.lighting = 'name-number';
  initialState.overrides.printItems = [{
    id: 'player',
    name: 'PLAYER',
    number: '16',
    placement: {
      x: 0.24,
      y: 0.61,
      z: -0.48,
      normal: { x: 0, y: 0, z: -1 },
    },
  }];
  render(
    <PersonalizeHarness
      initialSelection="player:player"
      initialState={initialState}
      onSideFocus={onSideFocus}
      onStateChange={onStateChange}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));

  await waitFor(() => expect(onSideFocus).toHaveBeenCalledWith('back'));
  expect(onStateChange).not.toHaveBeenCalled();
});
```

- [ ] **Step 3：运行测试并确认缺少球员侧面控件或回调而失败**

Run:

```powershell
npm test -- --run src/features/configurator/ui/PersonalizePanel.test.jsx
```

Expected: FAIL，球员编辑器中找不到 `Back`，或 `onSideFocus` 未被调用。

- [ ] **Step 4：接入共用规则和组件**

将面板签名扩展为：

```jsx
export function PersonalizePanel({
  deletePending,
  deletePersonalization,
  onSelect,
  onSideFocus,
  selectedKey,
  state,
  updateState,
}) {
```

为两个编辑器都传入 `onSideFocus`，并将 `PlayerEditor` 的切面逻辑实现为：

```jsx
const activeSide = getPersonalizationSide(item.placement);
const selectSide = async (side) => {
  if (side !== activeSide) {
    const result = await patchPlayer({
      placement: getPersonalizationSidePlacement(side),
    });
    if (result?.ok === false) return;
  }
  onSideFocus?.(side);
};

<PersonalizationSideSelector
  disabled={disabled}
  onSelect={selectSide}
  side={activeSide}
/>
```

让 `patchPlayer` 返回 `updateState(...)` 的结果。`TextEditor` 删除本地常量和本地 `getPersonalizationSide`，使用同一组件与相同的 `selectSide` 流程。

- [ ] **Step 5：运行个人化面板测试并确认通过**

Run:

```powershell
npm test -- --run src/features/configurator/ui/PersonalizePanel.test.jsx
```

Expected: 全部通过；现有自定义文字正背面测试继续通过。

- [ ] **Step 6：提交文字类正背面功能**

```powershell
git add -- src/features/configurator/ui/PersonalizePanel.jsx src/features/configurator/ui/PersonalizePanel.test.jsx
git commit -m "feat: switch player and text personalization sides"
```

### Task 4：为预设图片和上传图片恢复统一正背面选择

**Files:**
- Modify: `src/features/configurator/ui/DecorationPanel.jsx`
- Modify: `src/features/configurator/ui/DecorationPanel.test.jsx`

- [ ] **Step 1：将旧的“无区域控件”测试改为失败行为测试**

```jsx
it('moves only the active artwork to the back and clears its front placement', async () => {
  const first = createDecoration({
    id: 'crest-1',
    kind: 'badge',
    source: 'crest',
    label: 'Crest Badge',
    region: 'front',
  });
  first.placement = {
    region: 'front',
    position: { x: 0.1, y: 0.5, z: 0.7 },
    normal: { x: 0, y: 0, z: 1 },
  };
  const second = createDecoration({
    id: 'roundel-1',
    kind: 'badge',
    source: 'roundel',
    label: 'Roundel Badge',
    region: 'front',
  });
  const updateState = vi.fn().mockResolvedValue({ ok: true });
  const onSideFocus = vi.fn();

  render(
    <DecorationPanel
      onSideFocus={onSideFocus}
      product={{ decorationPresets: [] }}
      state={{
        overrides: {
          activeDecorationId: 'crest-1',
          decorations: [first, second],
        },
      }}
      updateState={updateState}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));

  await waitFor(() => expect(updateState).toHaveBeenCalledWith({
    overrides: {
      activeDecorationId: 'crest-1',
      decorations: [
        expect.objectContaining({
          id: 'crest-1',
          region: 'back',
          placement: null,
        }),
        second,
      ],
    },
  }));
  expect(onSideFocus).toHaveBeenCalledWith('back');
});
```

- [ ] **Step 2：补图片重复点击当前面的测试**

```jsx
it('focuses an artwork side without clearing its placement again', async () => {
  const artwork = createDecoration({
    id: 'crest-1',
    kind: 'badge',
    source: 'crest',
    label: 'Crest Badge',
    region: 'back',
  });
  artwork.placement = {
    region: 'back',
    position: { x: 0.2, y: 0.4, z: -0.7 },
    normal: { x: 0, y: 0, z: -1 },
  };
  const updateState = vi.fn();
  const onSideFocus = vi.fn();

  render(
    <DecorationPanel
      onSideFocus={onSideFocus}
      product={{ decorationPresets: [] }}
      state={{
        overrides: {
          activeDecorationId: 'crest-1',
          decorations: [artwork],
        },
      }}
      updateState={updateState}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));

  await waitFor(() => expect(onSideFocus).toHaveBeenCalledWith('back'));
  expect(updateState).not.toHaveBeenCalled();
});
```

- [ ] **Step 3：运行图片面板测试并确认失败**

Run:

```powershell
npm test -- --run src/features/configurator/ui/DecorationPanel.test.jsx
```

Expected: FAIL，找不到 `Back` 控件。

- [ ] **Step 4：在选中图片的操作区加入共用控件**

扩展组件签名：

```jsx
export function DecorationPanel({
  onArtworkSelect,
  onSideFocus,
  product,
  state,
  updateState,
}) {
```

让 `updateDecorations` 返回更新结果，并加入：

```jsx
async function selectSide(side) {
  if (!active) return;
  if (side !== active.region) {
    const next = decorations.map((item) => (
      item.id === active.id ? patchDecoration(item, { region: side }) : item
    ));
    const result = await updateDecorations(next, active.id);
    if (result?.ok === false) return;
  }
  onSideFocus?.(side);
}
```

在 `active` 操作区内渲染：

```jsx
<PersonalizationSideSelector
  onSelect={selectSide}
  side={active.region === 'back' ? 'back' : 'front'}
/>
```

`patchDecoration` 已在区域变化时清除旧 `placement`，不要在面板中重复实现。

- [ ] **Step 5：运行图片面板测试并确认通过**

Run:

```powershell
npm test -- --run src/features/configurator/ui/DecorationPanel.test.jsx
```

Expected: 全部通过；预设图片和上传图片默认 `front` 的测试继续通过。

- [ ] **Step 6：提交图片正背面功能**

```powershell
git add -- src/features/configurator/ui/DecorationPanel.jsx src/features/configurator/ui/DecorationPanel.test.jsx
git commit -m "feat: switch artwork between jersey sides"
```

### Task 5：把视角请求传到 3D 舞台

**Files:**
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx`
- Modify: `src/features/configurator/scene/ProductStage.jsx`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`

- [ ] **Step 1：先写舞台重复视角请求的失败测试**

在 `ProductStage.test.jsx` 的渲染器测试替身中记录 `setView` 调用：

```js
setView(view) {
  rendererHarness.viewRequests.push(view);
}
```

并在每个测试前清空 `rendererHarness.viewRequests`。新增：

```jsx
it('applies every personalization side focus request, including repeated sides', () => {
  const props = {
    onStatePatch: vi.fn(),
    product,
    selected,
    state: { lighting: 'none', overrides: {} },
  };
  const { rerender } = render(
    <ProductStage
      {...props}
      personalizationSideFocus={{ id: 1, side: 'back' }}
    />,
  );

  expect(rendererHarness.viewRequests).toContain('back');

  rerender(
    <ProductStage
      {...props}
      personalizationSideFocus={{ id: 2, side: 'back' }}
    />,
  );

  expect(rendererHarness.viewRequests.filter((view) => view === 'back')).toHaveLength(2);
});
```

- [ ] **Step 2：先写配置页面传递请求的失败测试**

在 `ConfiguratorPage.test.jsx` 的 `rendererHarness` 中加入 `viewRequests: []`，在 `beforeEach` 中清空，并把渲染器替身的空方法替换为：

```js
setView(view) {
  rendererHarness.viewRequests.push(view);
}
```

新增完整页面测试：

```jsx
it('requests the back camera every time the current player side is selected', async () => {
  render(<ConfiguratorPage />);
  await screen.findByText('Chelsea Match Jersey');

  fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
  await screen.findByLabelText('Name');

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(
    rendererHarness.viewRequests.filter((view) => view === 'back'),
  ).toHaveLength(1));

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(
    rendererHarness.viewRequests.filter((view) => view === 'back'),
  ).toHaveLength(2));
});
```

- [ ] **Step 3：运行两个测试文件并确认失败**

Run:

```powershell
npm test -- --run src/features/configurator/scene/ProductStage.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx
```

Expected: FAIL，缺少 `personalizationSideFocus` 数据流和重复请求处理。

- [ ] **Step 4：在配置页面建立带序号的请求**

在 `ConfiguratorPage` 中加入：

```jsx
const [personalizationSideFocus, setPersonalizationSideFocus] = useState(null);
const requestPersonalizationSideFocus = useCallback((side) => {
  setPersonalizationSideFocus((current) => ({
    id: (current?.id ?? 0) + 1,
    side,
  }));
}, []);
```

将 `personalizationSideFocus` 传给 `ProductStage`，将 `requestPersonalizationSideFocus` 传给 `ConfigPanel`，再以 `onSideFocus` 传给 `PersonalizePanel` 和 `DecorationPanel`。

- [ ] **Step 5：在舞台中处理每一条请求**

扩展 `ProductStage` 参数：

```jsx
personalizationSideFocus,
```

加入独立 effect：

```jsx
useEffect(() => {
  const side = personalizationSideFocus?.side;
  if (side !== 'front' && side !== 'back') return;
  rendererRef.current?.setView(side);
}, [personalizationSideFocus]);
```

保留现有工具栏 `view` 状态；正背面自动转向与 `focusDecoration` 一样属于临时相机聚焦，不改变工具栏模式。

- [ ] **Step 6：运行两个测试文件并确认通过**

Run:

```powershell
npm test -- --run src/features/configurator/scene/ProductStage.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx
```

Expected: 全部通过；连续两个 `back` 请求产生两次渲染器调用。

- [ ] **Step 7：提交视角请求数据流**

```powershell
git add -- src/features/configurator/ui/ConfiguratorPage.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/scene/ProductStage.jsx src/features/configurator/scene/ProductStage.test.jsx
git commit -m "feat: focus selected personalization side"
```

### Task 6：增加正面和背面相机预设

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`

- [ ] **Step 1：先写失败渲染器测试**

利用现有 GSAP mock，新增：

```js
it('moves the camera to the negative Z side for the back view', () => {
  gsap.to.mockClear();
  const renderer = Object.create(GarmentRenderer.prototype);
  renderer.camera = {
    position: {},
    lookAt: vi.fn(),
  };
  renderer.controls = {
    target: { x: 0, y: 0, z: 0 },
  };

  renderer.setView('back');

  expect(gsap.to).toHaveBeenCalledWith(
    renderer.camera.position,
    expect.objectContaining({
      x: 0,
      y: 1.8,
      z: expect.any(Number),
    }),
  );
  const cameraTween = gsap.to.mock.calls.find(
    ([target]) => target === renderer.camera.position,
  )[1];
  expect(cameraTween.z).toBeLessThan(0);
});
```

增加对称的 `front` 断言，确保其 Z 值大于零。

- [ ] **Step 2：运行目标测试并确认失败**

Run:

```powershell
npm test -- --run src/features/configurator/scene/garmentRenderer.test.js -t "camera.*view|back view|front view"
```

Expected: FAIL，`back` 回退到现有 `orbit` 正 Z 位置。

- [ ] **Step 3：补充相机预设**

在 `setView` 的 `targets` 中加入：

```js
front: {
  position: { x: 0, y: 1.8, z: 5.4 },
  target: { x: 0, y: 0.7, z: 0 },
},
back: {
  position: { x: 0, y: 1.8, z: -5.4 },
  target: { x: 0, y: 0.7, z: 0 },
},
```

保留 `orbit`、`top` 和 `detail` 现有值不变。

- [ ] **Step 4：运行渲染器测试并确认通过**

Run:

```powershell
npm test -- --run src/features/configurator/scene/garmentRenderer.test.js
```

Expected: 全部通过。

- [ ] **Step 5：提交相机预设**

```powershell
git add -- src/features/configurator/scene/garmentRenderer.js src/features/configurator/scene/garmentRenderer.test.js
git commit -m "feat: add front and back camera presets"
```

### Task 7：完整验证、变更记录和生产部署

**Files:**
- Create: `project-logs/changes/2026-07-29-unified-personalization-sides.md`

- [ ] **Step 1：运行相关测试文件**

Run:

```powershell
npm test -- --run src/features/configurator/config/personalizationSides.test.js src/features/configurator/ui/PersonalizationSideSelector.test.jsx src/features/configurator/ui/PersonalizePanel.test.jsx src/features/configurator/ui/DecorationPanel.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx src/features/configurator/scene/ProductStage.test.jsx src/features/configurator/scene/garmentRenderer.test.js
```

Expected: 所有目标测试通过，无失败项。

同时运行已有设计文件往返测试，确认正背面位置仍由现有结构保存：

```powershell
npm test -- --run src/features/configurator/designs/designDocument.test.js
```

Expected: 包含 `region: 'back'`、负 Z 坐标和负 Z 法线的往返测试继续通过。

- [ ] **Step 2：运行完整测试**

Run:

```powershell
npm test -- --run --reporter=dot
```

Expected: 现有 632 项加新增测试全部通过；jsdom 可能继续输出项目已有的 navigation 提示，但退出码必须为 0。

- [ ] **Step 3：运行生产构建和差异检查**

Run:

```powershell
npm run build
```

Expected: standalone app 和 Shopify bundle 均构建成功。

Run:

```powershell
git diff --check
```

Expected: 退出码 0；允许出现项目既有的 LF/CRLF 提示，不允许空白错误。

- [ ] **Step 4：浏览器真实验收**

按照设计文档的六项浏览器验收执行，至少覆盖：

- 球员姓名号码切换背面并自动转向；
- 自定义文字切换正背面；
- 预设图片和上传图片切换背面；
- 背面拖动、旋转、缩放；
- 重复点击当前面不重置位置；
- 切换一个元素不影响其他元素。

Expected: 桌面端和移动端均无控件遮挡，元素紧贴正确球衣表面。

- [ ] **Step 5：记录当前线上版本和回滚点**

Run:

```powershell
npx wrangler deployments status
```

Expected: 记录当前 100% 部署版本 ID。回滚命令为：

```powershell
npx wrangler rollback <部署前版本ID>
```

本次不修改数据库、不重启服务，回滚只切换 Worker 版本。

- [ ] **Step 6：部署前校验并发布**

Run:

```powershell
npx wrangler deploy --dry-run
```

Expected: 成功读取 `dist` 资源并列出既有绑定。

Run:

```powershell
npx wrangler deploy
```

Expected: 输出新的 Worker Version ID 和生产地址。

- [ ] **Step 7：线上回查**

Run:

```powershell
npx wrangler deployments status
```

Expected: 新版本占 100% 流量。

使用带缓存破坏参数的请求检查入口、应用 bundle 和 Shopify bundle 均返回 HTTP 200。

- [ ] **Step 8：写中文变更记录**

创建 `project-logs/changes/2026-07-29-unified-personalization-sides.md`，至少写明：

```markdown
# 2026-07-29 个性化元素正背面统一

## 目标

统一球员姓名号码、自定义文字、预设图片和上传图片的正背面选择，并在切换时自动旋转球衣。

## 修改范围

- 共用正背面规则和按钮组件
- Personalize 与 Artwork 面板
- 配置页面到 3D 舞台的视角请求
- 正面和背面相机预设

## 验证

- 目标测试：记录目标测试命令输出的文件数和测试数
- 完整测试：记录完整测试命令输出的文件数和测试数
- 生产构建：记录 standalone app 和 Shopify bundle 的构建结果
- 浏览器验收：逐项记录六条验收场景是否通过
- 线上 Worker 版本：记录 `wrangler deployments status` 返回的版本 ID

## 遗留问题

无；如浏览器验收发现模型特定投影问题，在此记录触发模型和复现步骤。
```

- [ ] **Step 9：提交验证记录**

```powershell
git add -- project-logs/changes/2026-07-29-unified-personalization-sides.md
git commit -m "docs: record unified personalization sides"
```

## 执行注意事项

- 当前工作区已有此前任务的未提交修改。每次只暂存本任务明确列出的文件，提交前必须检查 `git diff --cached --name-only`，不得混入 Shopify 启动器、备份目录或其他历史改动。
- 本功能不修改设计文件结构，不需要迁移旧数据。
- `patchDecoration` 已负责在 `region` 改变时清除旧投影位置，不新增第二套清除逻辑。
- 自动转向使用带递增 ID 的请求，避免 React 因相同字符串值而忽略连续两次 `Back` 请求。
- 若相机转到背面后模型朝向与视觉正背面相反，只调整 `front/back` 两个相机预设的 Z 符号，不修改个性化位置规则。
