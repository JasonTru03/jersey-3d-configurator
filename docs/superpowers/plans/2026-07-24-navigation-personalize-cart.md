# Configurator Navigation, Personalize, and Cart Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the redundant Colorway/Print navigation with task-based Design and Personalize sections, add billable editable custom-text elements, keep the desktop 3D stage stable, and generate an exact Shopify surcharge combination for older launch maps.

**Architecture:** Keep player sets and custom text as separate normalized state collections, then expose them through one Personalize UI and one renderer interaction layer. Pricing, review, persistence, and cart handoff consume the same billable custom-text selector. The desktop right panel becomes a fixed header, scrolling editor, and fixed checkout footer; Shopify surcharge decomposition remains a pure deterministic function.

**Tech Stack:** React 19, Three.js, Canvas 2D textures, Vite, Vitest, Testing Library, Cloudflare Workers, Shopify cart permalinks.

---

## File structure decisions

- Create `src/features/configurator/config/customTextItems.js` for custom-text normalization, billable filtering, mutation, and duplication.
- Create `src/features/configurator/config/customTextItems.test.js` for the text data contract.
- Create `src/features/configurator/scene/customTextTexture.js` for Canvas 2D text rendering only.
- Create `src/features/configurator/scene/customTextTexture.test.js` for font, outline, and letter-spacing rendering.
- Create `src/features/configurator/ui/PersonalizePanel.jsx` for the unified elements-first editor.
- Create `src/features/configurator/ui/PersonalizePanel.test.jsx` for add/select/edit behavior.
- Rename `src/features/configurator/scene/PrintToolbarOverlay.jsx` to `PersonalizationToolbarOverlay.jsx` because the toolbar will operate on player sets and custom text.
- Modify `ConfiguratorPage.jsx` only for section orchestration, selected-element state, and panel/footer composition; keep detailed personalization controls in `PersonalizePanel.jsx`.
- Extend the existing `garmentRenderer.js` print-layer machinery to render both item kinds, avoiding a second pointer/drag system.
- Extend `designDocument.js`, `pricing.js`, `DesignReviewDialog.jsx`, and `cartHandoff.js` so every downstream path reads the normalized custom-text collection.

### Task 1: Add the normalized custom-text data model

**Files:**
- Create: `src/features/configurator/config/customTextItems.js`
- Create: `src/features/configurator/config/customTextItems.test.js`
- Modify: `src/features/configurator/config/productDefinitions.js`

- [ ] **Step 1: Write failing model tests**

Create `src/features/configurator/config/customTextItems.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_TEXT_FONT_PRESETS,
  createCustomTextItem,
  duplicateCustomTextItem,
  getBillableCustomTextItems,
  getCustomTextItems,
  patchCustomTextItem,
} from './customTextItems.js';

describe('custom text items', () => {
  it('normalizes style and transform fields', () => {
    const item = createCustomTextItem({
      id: 'text-4',
      text: '  CHELSEA FC  ',
      fontPreset: 'missing-font',
      fillColor: '#20242a',
      outlineColor: '#f7f5ef',
      outlineEnabled: true,
      letterSpacing: 99,
      rotation: 405,
      scale: 9,
    });

    expect(item).toEqual(expect.objectContaining({
      id: 'text-4',
      text: '  CHELSEA FC  ',
      fontPreset: CUSTOM_TEXT_FONT_PRESETS[0].id,
      fillColor: '#20242A',
      outlineColor: '#F7F5EF',
      outlineEnabled: true,
      letterSpacing: 20,
      rotation: 45,
      scale: 1.8,
    }));
  });

  it('keeps empty items editable and excludes them from billing', () => {
    const items = getCustomTextItems({
      customTextItems: [
        { id: 'text-1', text: '   ' },
        { id: 'text-2', text: 'Sponsor' },
      ],
    });

    expect(items).toHaveLength(2);
    expect(getBillableCustomTextItems(items).map((item) => item.id)).toEqual(['text-2']);
  });

  it('patches and duplicates a custom text item with a stable new id', () => {
    const items = [createCustomTextItem({ id: 'text-1', text: 'CHELSEA' })];
    const patched = patchCustomTextItem(items, 'text-1', { letterSpacing: 6 });
    const copy = duplicateCustomTextItem(
      patched,
      'text-1',
      { x: 0.3, y: 0.36, z: 0.5 },
    );

    expect(patched[0].letterSpacing).toBe(6);
    expect(copy).toMatchObject({
      id: 'text-2',
      text: 'CHELSEA',
      placement: { x: 0.3, y: 0.36, z: 0.5 },
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```powershell
npm test -- --run src/features/configurator/config/customTextItems.test.js
```

Expected: FAIL because `customTextItems.js` does not exist.

- [ ] **Step 3: Implement the complete text-item helpers**

Create `src/features/configurator/config/customTextItems.js`:

```js
export const CUSTOM_TEXT_PRICE = 8;
export const MAX_CUSTOM_TEXT_ITEMS = 8;
export const CUSTOM_TEXT_FONT_PRESETS = [
  { id: 'athletic', label: 'Athletic', family: 'Arial Black, Arial, sans-serif' },
  { id: 'block', label: 'Block', family: 'Impact, Arial Black, sans-serif' },
  { id: 'modern', label: 'Modern', family: 'Arial, Helvetica, sans-serif' },
  { id: 'classic', label: 'Classic', family: 'Georgia, Times New Roman, serif' },
];

const FONT_IDS = new Set(CUSTOM_TEXT_FONT_PRESETS.map((font) => font.id));
const HEX_COLOR = /^#[0-9A-F]{6}$/;
const MIN_SCALE = 0.55;
const MAX_SCALE = 1.8;

export function createCustomTextItem({
  id = 'text-1',
  text = '',
  fontPreset = 'athletic',
  fillColor = '#20242A',
  outlineEnabled = true,
  outlineColor = '#F7F5EF',
  letterSpacing = 0,
  placement = null,
  scale = 1,
  rotation = 0,
} = {}) {
  return {
    id: String(id),
    text: String(text).slice(0, 24),
    fontPreset: FONT_IDS.has(fontPreset) ? fontPreset : CUSTOM_TEXT_FONT_PRESETS[0].id,
    fillColor: normalizeColor(fillColor, '#20242A'),
    outlineEnabled: Boolean(outlineEnabled),
    outlineColor: normalizeColor(outlineColor, '#F7F5EF'),
    letterSpacing: clamp(letterSpacing, 0, 20),
    placement,
    scale: clamp(scale, MIN_SCALE, MAX_SCALE),
    rotation: ((Number(rotation) % 360) + 360) % 360,
  };
}

export function getCustomTextItems(overrides = {}) {
  if (overrides.customTextItems === undefined) return [];
  if (!Array.isArray(overrides.customTextItems)) {
    throw new TypeError('Custom text items must be an array.');
  }
  return overrides.customTextItems
    .slice(0, MAX_CUSTOM_TEXT_ITEMS)
    .map((item, index) => createCustomTextItem({
      ...item,
      id: item?.id ?? `text-${index + 1}`,
    }));
}

export function getBillableCustomTextItems(items) {
  return items.filter((item) => item.text.trim().length > 0);
}

export function patchCustomTextItem(items, id, patch) {
  return items.map((item) => (
    item.id === id ? createCustomTextItem({ ...item, ...patch }) : item
  ));
}

export function removeCustomTextItem(items, id) {
  return items.filter((item) => item.id !== id);
}

export function duplicateCustomTextItem(items, id, placement) {
  if (items.length >= MAX_CUSTOM_TEXT_ITEMS || !placement) return null;
  const source = items.find((item) => item.id === id);
  if (!source) return null;
  return createCustomTextItem({
    ...source,
    id: nextTextId(items),
    placement,
  });
}

export function nextTextId(items) {
  let number = items.length + 1;
  while (items.some((item) => item.id === `text-${number}`)) number += 1;
  return `text-${number}`;
}

function normalizeColor(value, fallback) {
  const color = String(value).toUpperCase();
  return HEX_COLOR.test(color) ? color : fallback;
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}
```

Add the collection immediately after the existing `printItems` array in `jerseyProduct.defaultState.overrides`:

```js
customTextItems: [],
```

- [ ] **Step 4: Run focused tests and verify green**

Run:

```powershell
npm test -- --run src/features/configurator/config/customTextItems.test.js src/features/configurator/config/pricing.test.js
```

Expected: both test files PASS.

- [ ] **Step 5: Commit the data model**

```powershell
git add src/features/configurator/config/customTextItems.js `
  src/features/configurator/config/customTextItems.test.js `
  src/features/configurator/config/productDefinitions.js
git commit -m "feat: add custom text item model"
```

### Task 2: Persist custom text and calculate its price

**Files:**
- Modify: `src/features/configurator/designs/designDocument.js`
- Modify: `src/features/configurator/designs/designDocument.test.js`
- Modify: `src/features/configurator/config/pricing.js`
- Modify: `src/features/configurator/config/pricing.test.js`

- [ ] **Step 1: Add failing persistence and pricing tests**

Append to `designDocument.test.js`:

```js
it('preserves normalized custom text through a v3 roundtrip', () => {
  const customTextItems = [{
    id: 'text-1',
    text: 'CHELSEA FC',
    fontPreset: 'block',
    fillColor: '#20242A',
    outlineEnabled: true,
    outlineColor: '#F7F5EF',
    letterSpacing: 4,
    placement: { x: 0.2, y: 0.3, z: 0.5 },
    scale: 1.2,
    rotation: 45,
  }];
  const saved = createDesignDocument({
    productId: 'fn8788-jersey',
    state: { ...defaultState, overrides: { customTextItems } },
  });
  const loaded = parseDesignDocument(JSON.stringify(saved), {
    defaultState,
    expectedProductId: 'fn8788-jersey',
  });

  expect(saved.version).toBe(3);
  expect(loaded.overrides.customTextItems).toEqual(customTextItems);
});

it('loads a v2 document with an empty custom text collection', () => {
  const loaded = parseDesignDocument(JSON.stringify({
    format: 'jersey-design',
    productId: 'fn8788-jersey',
    state: defaultState,
    version: 2,
  }), { defaultState, expectedProductId: 'fn8788-jersey' });

  expect(loaded.overrides.customTextItems).toEqual([]);
});
```

Append to `pricing.test.js`:

```js
it('adds eight dollars for every non-empty custom text item', () => {
  const quote = calculateQuote(jerseyProduct, {
    ...jerseyProduct.defaultState,
    overrides: {
      ...jerseyProduct.defaultState.overrides,
      customTextItems: [
        { id: 'text-1', text: 'CHELSEA' },
        { id: 'text-2', text: '   ' },
        { id: 'text-3', text: 'LONDON' },
      ],
    },
  });

  expect(quote.optionAdjustments).toContainEqual({
    label: 'Custom text × 2',
    amount: 16,
  });
  expect(quote.customizationTotal).toBe(16);
  expect(quote.total).toBe(105);
});
```

- [ ] **Step 2: Run focused tests and verify red**

```powershell
npm test -- --run src/features/configurator/designs/designDocument.test.js src/features/configurator/config/pricing.test.js
```

Expected: FAIL because the design version stays at 2, text is not normalized, and quote total omits `$16`.

- [ ] **Step 3: Normalize text during save and import**

Update `designDocument.js`:

```js
import { getCustomTextItems } from '../config/customTextItems.js';

export const DESIGN_DOCUMENT_VERSION = 3;

// In parseDesignDocument:
if (document?.format !== DESIGN_DOCUMENT_FORMAT
  || ![1, 2, DESIGN_DOCUMENT_VERSION].includes(document.version)) {
  throw new DesignDocumentError('unsupported-version', 'This design file format is not supported.');
}

let customTextItems;
try {
  customTextItems = getCustomTextItems(documentOverrides);
} catch (error) {
  throw new DesignDocumentError('invalid-state', error.message);
}

// In the returned overrides:
customTextItems,

// In normalizePrintState, before returning:
const customTextItems = getCustomTextItems(overrides);

// In the returned overrides:
customTextItems,
```

Keep `normalizeDocumentBottomPattern` accepting v1/v2/v3 inputs with the existing safe metadata filter.

- [ ] **Step 4: Add the aggregate pricing adjustment**

Update `pricing.js`:

```js
import {
  CUSTOM_TEXT_PRICE,
  getBillableCustomTextItems,
  getCustomTextItems,
} from './customTextItems.js';
import { selectedOptions } from './selectors.js';

export function calculateQuote(product, state) {
  const selected = selectedOptions(product, state);
  const optionAdjustments = [];
  const layoutAdjustment = selected.layout?.priceDelta ?? 0;

  appendAdjustment(optionAdjustments, selected.layout);
  appendAdjustment(optionAdjustments, selected.material);
  appendAdjustment(optionAdjustments, selected.lighting);
  selected.extras.forEach((extra) => appendAdjustment(optionAdjustments, extra));

  const textCount = getBillableCustomTextItems(
    getCustomTextItems(state.overrides),
  ).length;
  if (textCount > 0) {
    optionAdjustments.push({
      label: `Custom text × ${textCount}`,
      amount: textCount * CUSTOM_TEXT_PRICE,
    });
  }

  const total = optionAdjustments.reduce(
    (sum, adjustment) => sum + adjustment.amount,
    product.basePrice,
  );
  const merchandisePrice = product.basePrice + layoutAdjustment;

  return {
    basePrice: product.basePrice,
    merchandisePrice,
    customizationTotal: total - merchandisePrice,
    optionAdjustments,
    total,
    currency: product.currency,
  };
}
```

Retain the existing `appendAdjustment` helper below this function.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- --run src/features/configurator/designs/designDocument.test.js src/features/configurator/config/pricing.test.js
git add src/features/configurator/designs/designDocument.js `
  src/features/configurator/designs/designDocument.test.js `
  src/features/configurator/config/pricing.js `
  src/features/configurator/config/pricing.test.js
git commit -m "feat: persist and price custom text"
```

Expected: focused tests PASS and the commit succeeds.

### Task 3: Render styled custom text to a Canvas texture

**Files:**
- Create: `src/features/configurator/scene/customTextTexture.js`
- Create: `src/features/configurator/scene/customTextTexture.test.js`

- [ ] **Step 1: Write failing Canvas renderer tests**

Create `customTextTexture.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { drawSpacedText, makeCustomTextCanvas } from './customTextTexture.js';

describe('custom text texture', () => {
  it('draws fill and outline with the selected font and spacing', () => {
    const context = {
      clearRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })),
      strokeText: vi.fn(),
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
    };
    const canvas = { width: 1024, height: 256, getContext: () => context };

    makeCustomTextCanvas({
      text: 'AB',
      fontPreset: 'block',
      fillColor: '#20242A',
      outlineEnabled: true,
      outlineColor: '#F7F5EF',
      letterSpacing: 6,
    }, canvas);

    expect(context.font).toContain('Impact');
    expect(context.fillText).toHaveBeenCalledTimes(2);
    expect(context.strokeText).toHaveBeenCalledTimes(2);
  });

  it('centers a spaced run around the requested x coordinate', () => {
    const context = {
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 10 })),
      strokeText: vi.fn(),
    };

    drawSpacedText(context, 'ABC', 100, 40, 5, false);

    expect(context.fillText.mock.calls.map((call) => call[1])).toEqual([85, 100, 115]);
    expect(context.strokeText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused test and verify red**

```powershell
npm test -- --run src/features/configurator/scene/customTextTexture.test.js
```

Expected: FAIL because the texture module does not exist.

- [ ] **Step 3: Implement font, outline, and letter-spacing drawing**

Create `customTextTexture.js`:

```js
import { CUSTOM_TEXT_FONT_PRESETS } from '../config/customTextItems.js';

export function makeCustomTextCanvas(item, canvas = document.createElement('canvas')) {
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = item.fillColor;
  context.strokeStyle = item.outlineColor;
  context.lineWidth = 12;
  const font = CUSTOM_TEXT_FONT_PRESETS.find(
    (candidate) => candidate.id === item.fontPreset,
  ) ?? CUSTOM_TEXT_FONT_PRESETS[0];
  context.font = `900 112px ${font.family}`;
  drawSpacedText(
    context,
    item.text.trim(),
    canvas.width / 2,
    canvas.height / 2,
    item.letterSpacing,
    item.outlineEnabled,
  );
  return canvas;
}

export function drawSpacedText(context, text, centerX, y, spacing, outlineEnabled) {
  const glyphs = Array.from(text);
  const widths = glyphs.map((glyph) => context.measureText(glyph).width);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
    + Math.max(0, glyphs.length - 1) * spacing;
  let cursor = centerX - totalWidth / 2;

  glyphs.forEach((glyph, index) => {
    const x = cursor + widths[index] / 2;
    if (outlineEnabled) context.strokeText(glyph, x, y);
    context.fillText(glyph, x, y);
    cursor += widths[index] + spacing;
  });
}
```

- [ ] **Step 4: Run the focused test and commit**

```powershell
npm test -- --run src/features/configurator/scene/customTextTexture.test.js
git add src/features/configurator/scene/customTextTexture.js `
  src/features/configurator/scene/customTextTexture.test.js
git commit -m "feat: render styled custom text textures"
```

Expected: focused tests PASS.

### Task 4: Generalize the 3D personalization layer and toolbar

**Files:**
- Modify: `src/features/configurator/scene/garmentRenderer.js`
- Modify: `src/features/configurator/scene/garmentRenderer.test.js`
- Modify: `src/features/configurator/scene/ProductStage.jsx`
- Modify: `src/features/configurator/scene/ProductStage.test.jsx`
- Move: `src/features/configurator/scene/PrintToolbarOverlay.jsx` → `src/features/configurator/scene/PersonalizationToolbarOverlay.jsx`
- Move: `src/features/configurator/scene/PrintToolbarOverlay.test.jsx` → `src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx`

- [ ] **Step 1: Add failing renderer and stage tests**

Add to `garmentRenderer.test.js`:

```js
it('creates a selectable layer for every visible custom text item', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const renderer = new GarmentRenderer(host);
  HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {},
    fillText() {},
    measureText: () => ({ width: 30 }),
    strokeText() {},
  });
  renderer.state = {
    lighting: 'none',
    overrides: {
      customTextItems: [
        { id: 'text-1', text: 'CHELSEA' },
        { id: 'text-2', text: '   ' },
      ],
    },
  };

  renderer.updatePrintLayer();

  expect([...renderer.printLayers.keys()]).toEqual(['text-1']);
  expect(renderer.printLayers.get('text-1').plane.userData.itemKind).toBe('text');
  renderer.dispose();
});
```

Add to `ProductStage.test.jsx`:

```jsx
it('patches a selected custom text transform from the shared toolbar', () => {
  const onStatePatch = vi.fn();
  render(
    <ProductStage
      onStatePatch={onStatePatch}
      product={product}
      selected={selected}
      state={{
        lighting: 'none',
        overrides: { customTextItems: [{ id: 'text-1', text: 'CHELSEA', scale: 1, rotation: 0 }] },
      }}
    />,
  );

  rendererHarness.onPrintSelectionChange('text-1');
  fireEvent.click(screen.getByRole('button', { name: 'Rotate personalization 45 degrees' }));

  expect(onStatePatch).toHaveBeenCalledWith({
    overrides: {
      customTextItems: [expect.objectContaining({ id: 'text-1', rotation: 45 })],
    },
  });
});
```

- [ ] **Step 2: Run focused tests and verify red**

```powershell
npm test -- --run src/features/configurator/scene/garmentRenderer.test.js src/features/configurator/scene/ProductStage.test.jsx
```

Expected: custom text creates no layer and the shared toolbar label is absent.

- [ ] **Step 3: Render player and text items through one layer map**

Update imports and the item collection inside `garmentRenderer.js`:

```js
import {
  getBillableCustomTextItems,
  getCustomTextItems,
  patchCustomTextItem,
} from '../config/customTextItems.js';
import { makeCustomTextCanvas } from './customTextTexture.js';

function getRenderablePersonalizationItems(state) {
  const playerItems = state?.lighting && state.lighting !== 'none'
    ? getPrintItems(state.overrides).map((item) => ({ ...item, itemKind: 'player' }))
    : [];
  const textItems = getBillableCustomTextItems(
    getCustomTextItems(state?.overrides),
  ).map((item) => ({ ...item, itemKind: 'text' }));
  return [...playerItems, ...textItems];
}
```

Use `getRenderablePersonalizationItems(this.state)` in `updatePrintLayer`, assign `plane.userData.itemKind`, and branch the Canvas source:

```js
const canvas = item.itemKind === 'text'
  ? makeCustomTextCanvas(item)
  : makePrintCanvas(this.getPrintOptions(item));
```

Use the same branch both when creating a layer and when refreshing `layer.texture.image`.

Update the texture refresh and editability checks so custom text also works while the player-set option is `none`:

```js
redrawPrintTexture() {
  getRenderablePersonalizationItems(this.state)
    .forEach((item) => this.updatePrintLayerEntry(item));
}

isPrintEditable() {
  return getRenderablePersonalizationItems(this.state).length > 0
    && this.decorationMeshes.length > 0;
}
```

Patch placement by item kind in `emitPrintPlacement`:

```js
const textItems = getCustomTextItems(this.state?.overrides);
if (textItems.some((item) => item.id === activePrintId)) {
  this.onStatePatch({
    overrides: {
      customTextItems: patchCustomTextItem(textItems, activePrintId, { placement }),
    },
  });
  return;
}
```

Then retain the existing player-set patch path.

- [ ] **Step 4: Generalize ProductStage mutation and toolbar language**

Rename the component and exported function to `PersonalizationToolbarOverlay`. Change accessible labels to:

```jsx
aria-label="Selected personalization controls"
aria-label="Edit personalization"
aria-label="Rotate personalization 45 degrees"
aria-label="Delete personalization"
aria-label="Duplicate personalization"
aria-label="Resize personalization"
```

In `ProductStage.jsx`, combine visible player/text items, then branch patch/copy/delete operations by whether the ID exists in `customTextItems`. Keep the shared placement candidates and active anchor:

```js
import {
  duplicateCustomTextItem,
  getBillableCustomTextItems,
  getCustomTextItems,
  patchCustomTextItem,
  removeCustomTextItem,
} from '../config/customTextItems.js';

const customTextItems = getCustomTextItems(state.overrides);
const visibleTextItems = getBillableCustomTextItems(customTextItems);
const playerItems = state?.lighting && state.lighting !== 'none'
  ? getPrintItems(state.overrides)
  : [];
const personalizationItems = [...playerItems, ...visibleTextItems];

const patchPersonalization = (id, patch) => {
  if (customTextItems.some((item) => item.id === id)) {
    onStatePatch({
      overrides: {
        customTextItems: patchCustomTextItem(customTextItems, id, patch),
      },
    });
    return;
  }
  const nextItems = patchPrintItem(playerItems, id, patch);
  onStatePatch({ overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) } });
};

const copyPersonalization = (id) => {
  const placement = getNextPrintPlacement(
    printCopyCandidates,
    personalizationItems.map((item) => item.placement).filter(Boolean),
  );
  if (customTextItems.some((item) => item.id === id)) {
    const copy = duplicateCustomTextItem(customTextItems, id, placement);
    if (!copy) return;
    onStatePatch({ overrides: { customTextItems: [...customTextItems, copy] } });
    setActivePrintId(copy.id);
    setSelectedPrintId(copy.id);
    return;
  }
  const copy = duplicatePrintItem(playerItems, id, placement);
  if (!copy) return;
  const nextItems = [...playerItems, copy];
  onStatePatch({
    overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) },
  });
  setActivePrintId(copy.id);
  setSelectedPrintId(copy.id);
};

const deletePersonalization = (id) => {
  setActivePrintId(null);
  setSelectedPrintId(null);
  setPrintAnchor({ visible: false });
  onPersonalizationSelect?.(null);
  if (customTextItems.some((item) => item.id === id)) {
    onStatePatch({
      overrides: {
        customTextItems: removeCustomTextItem(customTextItems, id),
      },
    });
    return;
  }
  const nextItems = removePrintItem(playerItems, id);
  onStatePatch({
    overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) },
  });
};
```

Add `personalizationFocusId`, `onEditPersonalization`, and `onPersonalizationSelect` props. When `personalizationFocusId` changes, set both active and selected IDs if the item exists. Use this selection callback so a click in 3D updates the panel:

```js
const handlePrintSelectionChange = useCallback((id) => {
  setActivePrintId(id);
  setSelectedPrintId(id);
  onPersonalizationSelect?.(id);
}, [onPersonalizationSelect]);
```

The Edit toolbar callback sends the selected ID to `onEditPersonalization`; deletion sends `null` after clearing the internal anchor.

Pass the helpers to the renamed toolbar:

```jsx
<PersonalizationToolbarOverlay
  anchor={selectedPrintId === activePrintId ? printAnchor : { visible: false }}
  item={personalizationItems.find((item) => item.id === selectedPrintId)}
  onCopy={copyPersonalization}
  onDelete={deletePersonalization}
  onEdit={(id) => onEditPersonalization?.(id)}
  onRotate={(id, rotation) => patchPersonalization(id, { rotation })}
  onScale={(id, scale) => patchPersonalization(id, { scale })}
/>
```

- [ ] **Step 5: Run focused tests and commit**

```powershell
npm test -- --run `
  src/features/configurator/scene/customTextTexture.test.js `
  src/features/configurator/scene/garmentRenderer.test.js `
  src/features/configurator/scene/ProductStage.test.jsx `
  src/features/configurator/scene/PersonalizationToolbarOverlay.test.jsx
git add src/features/configurator/scene
git commit -m "feat: edit custom text on the 3d jersey"
```

Expected: all four focused test files PASS; existing player-set drag, resize, rotate, duplicate, and delete tests stay green.

### Task 5: Build the elements-first Personalize panel

**Files:**
- Create: `src/features/configurator/ui/PersonalizePanel.jsx`
- Create: `src/features/configurator/ui/PersonalizePanel.test.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx`
- Modify: `src/features/configurator/config/productDefinitions.js`

- [ ] **Step 1: Write failing panel tests**

Create `PersonalizePanel.test.jsx`:

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonalizePanel } from './PersonalizePanel.jsx';

const baseState = {
  lighting: 'name-number',
  overrides: {
    printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }],
    customTextItems: [],
  },
};

describe('PersonalizePanel', () => {
  it('adds a default custom text element and selects it', () => {
    const updateState = vi.fn();
    const onSelect = vi.fn();
    render(
      <PersonalizePanel
        onSelect={onSelect}
        selectedId="print-1"
        state={baseState}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));

    expect(updateState).toHaveBeenCalledWith({
      overrides: {
        customTextItems: [expect.objectContaining({
          id: 'text-1',
          text: 'YOUR TEXT',
        })],
      },
    });
    expect(onSelect).toHaveBeenCalledWith('text-1');
  });

  it('edits font, fill, outline, and letter spacing for the selected text', () => {
    const updateState = vi.fn();
    render(
      <PersonalizePanel
        onSelect={vi.fn()}
        selectedId="text-1"
        state={{
          ...baseState,
          overrides: {
            ...baseState.overrides,
            customTextItems: [{ id: 'text-1', text: 'CHELSEA' }],
          },
        }}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    fireEvent.change(screen.getByLabelText('Fill color'), { target: { value: '#c84f3d' } });
    fireEvent.click(screen.getByLabelText('Outline'));
    fireEvent.change(screen.getByLabelText('Letter spacing'), { target: { value: '6' } });

    expect(updateState).toHaveBeenCalled();
    expect(screen.getByDisplayValue('CHELSEA')).toBeInTheDocument();
  });

  it('returns focus to the element list after selection is cleared', () => {
    const props = {
      onSelect: vi.fn(),
      selectedId: 'print-1',
      state: baseState,
      updateState: vi.fn(),
    };
    const { rerender } = render(<PersonalizePanel {...props} />);
    rerender(<PersonalizePanel {...props} selectedId={null} />);

    expect(screen.getByRole('list', { name: 'Personalization elements' })).toHaveFocus();
  });
});
```

Add to `ConfiguratorPage.test.jsx`:

```jsx
it('shows six task-based sections without Colorway or Print navigation', async () => {
  render(<ConfiguratorPage />);
  await screen.findByText('Chelsea Match Jersey');

  expect(screen.getAllByRole('navigation')[0]).toHaveTextContent(
    'SizeDesignFabricPersonalizeArtworkExtras',
  );
  expect(screen.queryByRole('button', { name: 'Colorway' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  expect(screen.getByText('Solid / Stadium knit')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused tests and verify red**

```powershell
npm test -- --run src/features/configurator/ui/PersonalizePanel.test.jsx src/features/configurator/ui/ConfiguratorPage.test.jsx
```

Expected: the new panel module is absent and the sidebar still has seven sections.

- [ ] **Step 3: Implement the panel as a focused component**

Create `PersonalizePanel.jsx` with these public behaviors:

```jsx
import { Plus, Type } from 'lucide-react';
import { useEffect, useRef } from 'react';
import {
  CUSTOM_TEXT_FONT_PRESETS,
  createCustomTextItem,
  getCustomTextItems,
  nextTextId,
  patchCustomTextItem,
} from '../config/customTextItems.js';
import {
  ensurePrintItems,
  getPrintItems,
  legacyFirstItemFields,
  patchPrintItem,
} from '../config/printItems.js';

export function PersonalizePanel({ onSelect, selectedId, state, updateState }) {
  const listRef = useRef(null);
  const previousSelectedId = useRef(selectedId);
  const playerItems = state.lighting === 'none' ? [] : getPrintItems(state.overrides);
  const textItems = getCustomTextItems(state.overrides);
  const activePlayer = playerItems.find((item) => item.id === selectedId);
  const activeText = textItems.find((item) => item.id === selectedId);

  useEffect(() => {
    if (previousSelectedId.current && !selectedId) listRef.current?.focus();
    previousSelectedId.current = selectedId;
  }, [selectedId]);

  const addPlayer = () => {
    const next = ensurePrintItems(getPrintItems(state.overrides));
    updateState({
      lighting: state.lighting === 'none' ? 'name-number' : state.lighting,
      overrides: { printItems: next, ...legacyFirstItemFields(next) },
    });
    onSelect(next[0].id);
  };

  const addText = () => {
    const item = createCustomTextItem({
      id: nextTextId(textItems),
      text: 'YOUR TEXT',
    });
    updateState({ overrides: { customTextItems: [...textItems, item] } });
    onSelect(item.id);
  };

  const patchPlayer = (patch) => {
    const next = patchPrintItem(playerItems, activePlayer.id, patch);
    updateState({ overrides: { printItems: next, ...legacyFirstItemFields(next) } });
  };

  const patchText = (patch) => {
    updateState({
      overrides: {
        customTextItems: patchCustomTextItem(textItems, activeText.id, patch),
      },
    });
  };

  return (
    <div className="personalize-panel">
      <div className="personalize-actions">
        <button onClick={addPlayer} type="button"><Plus size={16} />Player set</button>
        <button aria-label="Add text" onClick={addText} type="button"><Type size={16} />Text</button>
      </div>
      <div aria-label="Personalization elements" className="personalize-elements" ref={listRef} role="list" tabIndex={-1}>
        {playerItems.map((item) => (
          <button aria-pressed={item.id === selectedId} key={item.id} onClick={() => onSelect(item.id)} type="button">
            <span>Player set</span><strong>{item.name} {item.number}</strong>
          </button>
        ))}
        {textItems.map((item) => (
          <button aria-pressed={item.id === selectedId} key={item.id} onClick={() => onSelect(item.id)} type="button">
            <span>Text</span><strong>{item.text.trim() || 'Empty text'}</strong>
          </button>
        ))}
      </div>
      {activePlayer && (
        <div className="personalize-editor print-fields">
          <label><span>Name</span><input maxLength={14} onChange={(event) => patchPlayer({ name: event.target.value })} value={activePlayer.name} /></label>
          <label><span>Number</span><input maxLength={2} onChange={(event) => patchPlayer({ number: event.target.value })} value={activePlayer.number} /></label>
        </div>
      )}
      {activeText && (
        <div className="personalize-editor text-fields">
          <label><span>Text</span><input maxLength={24} onChange={(event) => patchText({ text: event.target.value })} value={activeText.text} /></label>
          <fieldset>
            <legend>Font</legend>
            {CUSTOM_TEXT_FONT_PRESETS.map((font) => (
              <button aria-pressed={activeText.fontPreset === font.id} key={font.id} onClick={() => patchText({ fontPreset: font.id })} type="button">{font.label}</button>
            ))}
          </fieldset>
          <label><span>Fill</span><input aria-label="Fill color" onChange={(event) => patchText({ fillColor: event.target.value })} type="color" value={activeText.fillColor} /></label>
          <label><input aria-label="Outline" checked={activeText.outlineEnabled} onChange={(event) => patchText({ outlineEnabled: event.target.checked })} type="checkbox" /><span>Outline</span></label>
          <label><span>Outline color</span><input aria-label="Outline color" onChange={(event) => patchText({ outlineColor: event.target.value })} type="color" value={activeText.outlineColor} /></label>
          <label><span>Letter spacing</span><input aria-label="Letter spacing" max="20" min="0" onChange={(event) => patchText({ letterSpacing: event.target.value })} type="range" value={activeText.letterSpacing} /></label>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Replace the navigation and wire selected elements**

In `productDefinitions.js`, change visible labels:

```js
optionLabels: {
  layout: 'Size',
  design: 'Design',
  material: 'Fabric',
  personalize: 'Personalize',
  decorations: 'Artwork',
  extras: 'Extras',
},
```

In `ConfiguratorPage.jsx`, use:

```js
const sectionDefaults = [
  { id: 'layout', label: 'Size', icon: Shirt },
  { id: 'design', label: 'Design', icon: Palette },
  { id: 'material', label: 'Fabric', icon: Layers3 },
  { id: 'personalize', label: 'Personalize', icon: Type },
  { id: 'decorations', label: 'Artwork', icon: Sticker },
  { id: 'extras', label: 'Extras', icon: Cable },
];
```

Replace `editingPrintId` with `selectedPersonalizationId`. Pass it to `PersonalizePanel` and `ProductStage`. The renderer Edit callback performs:

```js
setSelectedPersonalizationId(id);
setSection('personalize');
```

The `ProductStage` call receives both focus and selection synchronization:

```jsx
<ProductStage
  artworkFocusId={artworkFocusId}
  onBakeProvider={(provider) => { bakeProviderRef.current = provider; }}
  onEditPersonalization={(id) => {
    setSelectedPersonalizationId(id);
    setSection('personalize');
  }}
  onPersonalizationSelect={setSelectedPersonalizationId}
  onStatePatch={updateState}
  personalizationFocusId={selectedPersonalizationId}
  product={product}
  selected={selected}
  state={state}
/>
```

Add `onPersonalizationSelect` and `selectedPersonalizationId` to the existing `ConfigPanel` prop list, remove `editingPrintId`, `nameInputRef`, and `onLightingSelect`, and update the call site:

```jsx
<ConfigPanel
  onArtworkSelect={setArtworkFocusId}
  onPersonalizationSelect={setSelectedPersonalizationId}
  product={product}
  quote={quote}
  section={section}
  selected={selected}
  selectedPersonalizationId={selectedPersonalizationId}
  state={state}
  updateState={updateState}
/>
```

Render the existing Template/zone/bottom-pattern controls for `section === 'design'`; render `PersonalizePanel` for `section === 'personalize'`. Remove `ColorwayPanel`, the Colorway branch, `PrintFields`, and the old lighting OptionGrid from the visible panel.

In `ProductStage.jsx`, replace the Colorway stage caption with the active design label:

```jsx
const activeTemplate = product.options.templates.find(
  (template) => template.id === state.overrides?.appearance?.template,
);

<div className="stage-caption">
  <strong>{selected.layout?.label}</strong>
  <span>{activeTemplate?.label ?? 'Solid'} / {selected.material?.shortLabel}</span>
</div>
```

- [ ] **Step 5: Run focused tests and commit**

```powershell
npm test -- --run `
  src/features/configurator/ui/PersonalizePanel.test.jsx `
  src/features/configurator/ui/ConfiguratorPage.test.jsx `
  src/features/configurator/scene/ProductStage.test.jsx
git add src/features/configurator/ui/PersonalizePanel.jsx `
  src/features/configurator/ui/PersonalizePanel.test.jsx `
  src/features/configurator/ui/ConfiguratorPage.jsx `
  src/features/configurator/ui/ConfiguratorPage.test.jsx `
  src/features/configurator/config/productDefinitions.js
git commit -m "feat: add task-based personalize workflow"
```

Expected: focused tests PASS and the sidebar exposes exactly six sections.

### Task 6: Add the fixed checkout footer and move details into Review

**Files:**
- Modify: `src/features/configurator/ui/ConfiguratorPage.jsx`
- Modify: `src/features/configurator/ui/ConfiguratorPage.test.jsx`
- Modify: `src/features/configurator/ui/DesignReviewDialog.jsx`
- Modify: `src/features/configurator/ui/DesignReviewDialog.test.jsx`
- Modify: `src/features/configurator/ui/configurator.css`
- Modify: `src/features/configurator/ui/configuratorLayout.test.js`

- [ ] **Step 1: Add failing layout and review tests**

Extend `configuratorLayout.test.js`:

```js
it('keeps the panel header and checkout footer outside the scroll region', () => {
  expect(ruleBody(css, '.config-panel')).toContain('overflow: hidden');
  expect(ruleBody(css, '.panel-scroll')).toContain('overflow-y: auto');
  expect(ruleBody(css, '.panel-scroll')).toContain('min-height: 0');
  expect(ruleBody(css, '.panel-checkout')).toContain('flex: 0 0 auto');
});
```

Add to `ConfiguratorPage.test.jsx`:

```jsx
it('shows the total and Review design in the fixed panel checkout footer', async () => {
  render(<ConfiguratorPage />);
  await screen.findByText('Chelsea Match Jersey');

  const footer = screen.getByTestId('panel-checkout');
  expect(footer).toHaveTextContent('$89');
  fireEvent.click(within(footer).getByRole('button', { name: 'Review design' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('updates text price through add, undo, and redo', async () => {
  render(<ConfiguratorPage />);
  await screen.findByText('Chelsea Match Jersey');

  fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
  expect(screen.getByTestId('panel-checkout')).toHaveTextContent('$97');

  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.getByTestId('panel-checkout')).toHaveTextContent('$89');
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  expect(screen.getByTestId('panel-checkout')).toHaveTextContent('$97');
});
```

Update `DesignReviewDialog.test.jsx` to expect:

```jsx
expect(screen.queryByText('Colorway')).not.toBeInTheDocument();
expect(screen.getByText('Design')).toBeInTheDocument();
expect(screen.getByText('Custom text')).toBeInTheDocument();
expect(screen.getByText('CHELSEA FC')).toBeInTheDocument();
expect(screen.getByText('Customization subtotal')).toBeInTheDocument();
```

- [ ] **Step 2: Run focused tests and verify red**

```powershell
npm test -- --run `
  src/features/configurator/ui/configuratorLayout.test.js `
  src/features/configurator/ui/ConfiguratorPage.test.jsx `
  src/features/configurator/ui/DesignReviewDialog.test.jsx
```

Expected: the panel owns all overflow, the footer is absent, and Review still shows Colorway.

- [ ] **Step 3: Compose the fixed panel regions**

Change `ConfigPanel` to:

```jsx
<aside className="config-panel">
  <PanelHeader labels={product.optionLabels} section={section} />
  <div className="panel-scroll">
    {section === 'layout' && (
      <OptionGrid
        group="layout"
        onSelect={(layout) => updateState({ layout })}
        options={product.options.layout}
        selectedId={state.layout}
      />
    )}
    {section === 'design' && (
      <>
        <TemplateLibrary
          activeTemplate={state.overrides?.appearance?.template}
          onSelect={(template) => patchAppearance({ template })}
          templates={product.options.templates}
        />
        <ZoneColorPanel
          colors={state.overrides?.appearance?.colors ?? {}}
          onColorChange={(colors) => patchAppearance({ colors })}
          palette={APPEARANCE_PALETTE}
        />
        <BottomPatternPanel
          onChange={patchBottomPattern}
          pattern={state.overrides?.bottomPattern}
        />
      </>
    )}
    {section === 'material' && (
      <OptionGrid
        group="material"
        onSelect={(material) => updateState({ material })}
        options={product.options.material}
        selectedId={state.material}
      />
    )}
    {section === 'personalize' && (
      <PersonalizePanel
        onSelect={onPersonalizationSelect}
        selectedId={selectedPersonalizationId}
        state={state}
        updateState={updateState}
      />
    )}
    {section === 'decorations' && (
      <DecorationPanel
        onArtworkSelect={onArtworkSelect}
        product={product}
        state={state}
        updateState={updateState}
      />
    )}
    {section === 'extras' && (
      <ExtrasPanel
        extras={product.options.extras}
        state={state}
        updateState={updateState}
      />
    )}
  </div>
  <div className="panel-checkout" data-testid="panel-checkout">
    <span><small>Total</small><strong>${quote.total}</strong></span>
    <button className="primary-button" onClick={onReview} type="button">
      <ShoppingCart size={17} />
      Review design
    </button>
  </div>
</aside>
```

Pass `onReview={() => setReviewOpen(true)}` to `ConfigPanel`. Remove the Review button and price pill from `TopBar`, leaving theme, undo, redo, open, and save actions.

- [ ] **Step 4: Update Review to be the detailed summary**

In `DesignReviewDialog.jsx`:

```js
import {
  getBillableCustomTextItems,
  getCustomTextItems,
} from '../config/customTextItems.js';

const customTextItems = getBillableCustomTextItems(
  getCustomTextItems(state.overrides),
);
const customTextLabel = customTextItems.length
  ? `${customTextItems.length} item${customTextItems.length === 1 ? '' : 's'}: ${
    customTextItems.map((item) => item.text.trim()).join(', ')
  }`
  : 'None';
const extrasLabel = selected.extras.length
  ? selected.extras.map((item) => item.label).join(', ')
  : 'None';
```

Replace the Colorway and Print rows with:

```jsx
<div><dt>Design</dt><dd>{templateLabel}</dd></div>
<div><dt>Player set</dt><dd>{selected.lighting?.shortLabel}</dd></div>
<div><dt>Custom text</dt><dd>{customTextLabel}</dd></div>
<div><dt>Artwork</dt><dd>{artworkLabel}</dd></div>
<div><dt>Extras</dt><dd>{extrasLabel}</dd></div>
<div><dt>Customization subtotal</dt><dd>${quote.customizationTotal}</dd></div>
```

Retain size, fabric, appearance-zone colors, extras, final total, production notes, save/download actions, and Add to Shopify cart.

- [ ] **Step 5: Apply the fixed-header/scroll/footer CSS**

Update `configurator.css`:

```css
.config-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.panel-header,
.panel-checkout {
  flex: 0 0 auto;
}

.panel-scroll {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.panel-checkout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-top: 1px solid var(--line);
  background: var(--panel);
}

.panel-checkout span {
  display: grid;
  gap: 2px;
}

.panel-checkout small {
  color: var(--muted);
}

.panel-checkout strong {
  font-size: 24px;
}
```

At `@media (max-width: 1040px)`, restore:

```css
.config-panel,
.panel-scroll {
  overflow: visible;
}
```

Add focused styles for `.personalize-actions`, `.personalize-elements`, and `.personalize-editor` using existing colors, borders, spacing, focus outlines, and 44px minimum interactive height.

- [ ] **Step 6: Run focused tests and commit**

```powershell
npm test -- --run `
  src/features/configurator/ui/configuratorLayout.test.js `
  src/features/configurator/ui/ConfiguratorPage.test.jsx `
  src/features/configurator/ui/DesignReviewDialog.test.jsx
git add src/features/configurator/ui
git commit -m "feat: optimize configurator panel layout"
```

Expected: focused tests PASS; desktop panel scroll is isolated to `.panel-scroll`.

### Task 7: Add deterministic Shopify surcharge decomposition

**Files:**
- Modify: `src/features/configurator/shopify/cartHandoff.js`
- Modify: `src/features/configurator/shopify/cartHandoff.test.js`

- [ ] **Step 1: Replace the exact-only test with failing fallback cases**

Add these tests to `cartHandoff.test.js`:

```js
it('uses the fewest surcharge units when the exact amount is absent', () => {
  const context = parseShopifyLaunch(
    '?shop=testcsj.myshopify.com'
    + '&variantMap=%7B%22m%22%3A%2248039101923479%22%7D'
    + '&surchargeVariantMap=%7B%2250%22%3A%2249000000000050%22%2C%2212%22%3A%2249000000000012%22%2C%228%22%3A%2249000000000008%22%7D',
  );
  const url = createCartUrl({
    context,
    quote: { customizationTotal: 62, merchandisePrice: 89, total: 151 },
    state: { layout: 'm', extras: {}, overrides: { bottomPattern: { enabled: false } } },
  });

  expect(url).toContain(
    '/cart/48039101923479:1,49000000000050:1,49000000000012:1',
  );
});

it('uses quantity when repeated surcharge units are optimal', () => {
  const context = parseShopifyLaunch(
    '?shop=testcsj.myshopify.com'
    + '&variantMap=%7B%22m%22%3A%2248039101923479%22%7D'
    + '&surchargeVariantMap=%7B%228%22%3A%2249000000000008%22%7D',
  );
  const url = createCartUrl({
    context,
    quote: { customizationTotal: 24, merchandisePrice: 89, total: 113 },
    state: { layout: 'm', extras: {}, overrides: { bottomPattern: { enabled: false } } },
  });

  expect(url).toContain('/cart/48039101923479:1,49000000000008:3');
});

it('reports expired pricing before cart navigation when no exact sum exists', () => {
  const context = parseShopifyLaunch(
    '?shop=testcsj.myshopify.com'
    + '&variantMap=%7B%22m%22%3A%2248039101923479%22%7D'
    + '&surchargeVariantMap=%7B%2210%22%3A%2249000000000010%22%7D',
  );

  expect(() => createCartUrl({
    context,
    quote: { customizationTotal: 23, merchandisePrice: 89, total: 112 },
    state: { layout: 'm', extras: {}, overrides: { bottomPattern: { enabled: false } } },
  })).toThrow(
    'Pricing for this configurator launch has expired. Reopen it from the Shopify product page.',
  );
});
```

Extend the concise-property assertion with:

```js
'Custom Text': 'CHELSEA FC | LONDON',
```

- [ ] **Step 2: Run the focused test and verify red**

```powershell
npm test -- --run src/features/configurator/shopify/cartHandoff.test.js
```

Expected: fallback cases throw the old exact-variant error and the property is absent.

- [ ] **Step 3: Implement the pure decomposition helper**

Add to `cartHandoff.js`:

```js
export function findSurchargeCombination(variantMap, target) {
  if (!Number.isSafeInteger(target) || target < 0) return null;
  if (target === 0) return [];
  const entries = Object.entries(variantMap ?? {})
    .map(([amount, variantId]) => ({ amount: Number(amount), variantId: String(variantId) }))
    .filter((entry) => (
      Number.isSafeInteger(entry.amount)
      && entry.amount > 0
      && isNumericId(entry.variantId)
      && entry.amount <= target
    ))
    .sort((first, second) => second.amount - first.amount);
  const best = Array(target + 1).fill(null);
  best[0] = [];

  for (let subtotal = 1; subtotal <= target; subtotal += 1) {
    for (const entry of entries) {
      const previous = best[subtotal - entry.amount];
      if (!previous) continue;
      const candidate = [...previous, entry];
      if (!best[subtotal] || compareCombinations(candidate, best[subtotal]) < 0) {
        best[subtotal] = candidate;
      }
    }
  }

  if (!best[target]) return null;
  const grouped = new Map();
  best[target].forEach((entry) => {
    const current = grouped.get(entry.variantId) ?? { ...entry, quantity: 0 };
    current.quantity += 1;
    grouped.set(entry.variantId, current);
  });
  return [...grouped.values()].sort((first, second) => second.amount - first.amount);
}

function compareCombinations(first, second) {
  if (first.length !== second.length) return first.length - second.length;
  const firstKinds = new Set(first.map((item) => item.variantId)).size;
  const secondKinds = new Set(second.map((item) => item.variantId)).size;
  if (firstKinds !== secondKinds) return firstKinds - secondKinds;
  const firstAmounts = first.map((item) => item.amount).sort((a, b) => b - a);
  const secondAmounts = second.map((item) => item.amount).sort((a, b) => b - a);
  for (let index = 0; index < firstAmounts.length; index += 1) {
    if (firstAmounts[index] !== secondAmounts[index]) {
      return secondAmounts[index] - firstAmounts[index];
    }
  }
  return 0;
}
```

Use it in `createCartUrl`:

```js
if (customizationTotal > 0) {
  const surchargeItems = findSurchargeCombination(
    context?.surchargeVariantMap,
    customizationTotal,
  );
  if (!surchargeItems) {
    throw new Error(
      'Pricing for this configurator launch has expired. Reopen it from the Shopify product page.',
    );
  }
  surchargeItems.forEach(({ variantId: surchargeVariantId, quantity }) => {
    cartItems.push(`${surchargeVariantId}:${quantity}`);
  });
}
```

Use normalized billable text in `createProperties`:

```js
const customText = getBillableCustomTextItems(
  getCustomTextItems(state?.overrides),
).map((item) => item.text.trim()).join(' | ');

const properties = {
  Size: state?.layout ?? '',
  Template: appearance.template ?? '',
  Colors: JSON.stringify(appearance.colors ?? {}),
  Print: print,
  'Custom Text': customText,
  Extras: enabledExtras,
  Artwork: artworkLabels,
};
```

- [ ] **Step 4: Run focused tests and commit**

```powershell
npm test -- --run src/features/configurator/shopify/cartHandoff.test.js src/features/configurator/ui/ConfiguratorPage.test.jsx
git add src/features/configurator/shopify/cartHandoff.js `
  src/features/configurator/shopify/cartHandoff.test.js
git commit -m "fix: compose missing Shopify surcharge totals"
```

Expected: exact, composed, repeated-quantity, and expired-map cases PASS.

### Task 8: Run complete automated and local browser acceptance

**Files:**
- Create: `project-logs/changes/2026-07-24-navigation-personalize-cart.md`

- [ ] **Step 1: Run the complete automated suite**

```powershell
npm test -- --run
npm run build
npx wrangler deploy --dry-run
git diff --check
```

Expected:

- every Vitest file passes;
- app and Shopify builds exit zero;
- Wrangler dry-run completes with the existing Worker configuration;
- generated app assets stay out of the staged source diff;
- no whitespace errors.

- [ ] **Step 2: Start the production-shaped local build**

```powershell
npm run build
npx wrangler dev --local --port 8787
```

Open:

```text
http://127.0.0.1:8787/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&surchargeVariantMap=%7B%228%22%3A%2249000000000008%22%2C%2218%22%3A%2249000000000018%22%2C%2250%22%3A%2249000000000050%22%7D
```

- [ ] **Step 3: Verify desktop layout at `1908 × 942`**

Record:

- `window.innerHeight`;
- `document.documentElement.scrollHeight`;
- `.stage-wrap` bounding rectangle;
- `.panel-scroll` client/scroll heights;
- `.panel-checkout` bounding rectangle.

Expected:

- document height equals viewport height;
- the complete jersey remains visible and centered;
- `.panel-scroll` owns overflow;
- panel title and checkout footer remain visible;
- switching Size → Design → Personalize leaves the stage rectangle unchanged.

- [ ] **Step 4: Verify the custom-text shopper flow**

Perform:

1. Open Personalize.
2. Add one Text element.
3. Change text to `CHELSEA FC`.
4. Choose Block.
5. Set fill to `#C84F3D`.
6. Keep outline enabled and set it to `#F7F5EF`.
7. Set letter spacing to `6`.
8. Drag, rotate once, resize, duplicate, then delete the copy.
9. Save the design, reopen it, and reselect the text.

Expected:

- the 3D texture updates after each editor change;
- toolbar changes apply to the selected text;
- one final non-empty text adds `$8`;
- the reopened design restores content, style, placement, scale, and 45-degree rotation;
- Review lists `CHELSEA FC`, `$8` customization subtotal, and `$97` total for the base M configuration.

- [ ] **Step 5: Record local evidence**

Create `project-logs/changes/2026-07-24-navigation-personalize-cart.md` with:

- confirmed requirements;
- files and responsibilities changed;
- focused/full test commands and outcomes;
- build and Wrangler dry-run outcomes;
- viewport measurements;
- saved-design roundtrip evidence;
- local cart URL evidence;
- remaining production acceptance state.

- [ ] **Step 6: Commit the verified application**

```powershell
git add src project-logs/changes/2026-07-24-navigation-personalize-cart.md
git commit -m "feat: expand jersey personalization workflow"
```

Expected: commit includes application/test/log changes and excludes `.superpowers/`, `dist/`, `.wrangler/`, and local browser artifacts.

### Task 9: Deploy, verify Shopify cart totals, and close the handoff

**Files:**
- Modify: `project-logs/changes/2026-07-24-navigation-personalize-cart.md`
- Create: `docs/superpowers/handoffs/2026-07-24-navigation-personalize-cart-handoff.md`

- [ ] **Step 1: Verify the exact commit before deployment**

```powershell
git status --short
git log -1 --oneline
npm test -- --run
npm run build
```

Expected: only the ignored/untracked brainstorming companion may remain; tests and both production builds pass on the commit selected for deployment.

- [ ] **Step 2: Deploy the verified Worker**

```powershell
npx wrangler deploy
```

Expected: Wrangler reports a new version for `jersey-3d-configurator` at:

```text
https://jersey-3d-configurator.jason1064969838.workers.dev/
```

Record the Worker version identifier.

- [ ] **Step 3: Read back deployed assets and repeat UI acceptance**

Open the Worker with a cache-busting query:

```text
https://jersey-3d-configurator.jason1064969838.workers.dev/?acceptance=20260724
```

Record the deployed JavaScript/CSS asset names and repeat:

- six-section sidebar check;
- Design ownership check;
- desktop no-document-scroll measurements;
- Personalize add/edit/rotate/duplicate/delete flow;
- `$8` text price check;
- save/open roundtrip.

- [ ] **Step 4: Verify a real exact-map Shopify cart**

Launch from the live Shopify product page, add one custom text, and review the `$97` total. Add to Shopify cart.

Expected cart:

- Custom 3D Football Jersey / M: `$89`;
- 3D Customization Surcharge / 8: `$8`;
- total: `$97`;
- jersey properties include `Custom Text: CHELSEA FC`.

- [ ] **Step 5: Verify a composed-map cart**

Use a launch URL whose surcharge map omits `$62` but includes `$50` and `$12`. Recreate:

- M base jersey `$89`;
- Player mesh `+$24`;
- Name set `+$18`;
- Match patch `+$12`;
- Gift box `+$8`;
- customization subtotal `$62`;
- total `$151`.

Expected cart surcharge lines: one `$50` variant and one `$12` variant; Shopify cart total equals `$151`.

- [ ] **Step 6: Write the handoff and deployment checkpoint**

Create `docs/superpowers/handoffs/2026-07-24-navigation-personalize-cart-handoff.md` with:

- branch and final commit;
- Worker version and live URL;
- deployed asset names;
- automated verification results;
- viewport measurements;
- exact-map `$97` cart evidence;
- composed-map `$151` cart evidence;
- rollback Worker version;
- any storefront acceptance item that still needs a logged-in manual check.

Update the change log with the same deployment evidence.

- [ ] **Step 7: Commit and push the handoff**

```powershell
git add project-logs/changes/2026-07-24-navigation-personalize-cart.md `
  docs/superpowers/handoffs/2026-07-24-navigation-personalize-cart-handoff.md
git commit -m "docs: record personalization deployment acceptance"
git push origin codex/continuous-bottom-pattern
git push backup codex/continuous-bottom-pattern
git ls-remote --heads origin codex/continuous-bottom-pattern
git ls-remote --heads backup codex/continuous-bottom-pattern
```

Expected: local, `origin`, and `backup` branch hashes match.
