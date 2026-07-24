import { describe, expect, it } from 'vitest';
import {
  CUSTOM_TEXT_FONT_PRESETS,
  CUSTOM_TEXT_PRICE,
  MAX_CUSTOM_TEXT_ITEMS,
  createCustomTextItem,
  duplicateCustomTextItem,
  getBillableCustomTextItems,
  getCustomTextItems,
  nextTextId,
  patchCustomTextItem,
  removeCustomTextItem,
} from './customTextItems.js';
import { jerseyProduct } from './productDefinitions.js';

describe('custom text items', () => {
  it('exposes the configured price, capacity, and four font presets', () => {
    expect(CUSTOM_TEXT_PRICE).toBe(8);
    expect(MAX_CUSTOM_TEXT_ITEMS).toBe(8);
    expect(CUSTOM_TEXT_FONT_PRESETS).toEqual([
      { id: 'athletic', label: 'Athletic', family: 'Arial Black, Arial, sans-serif' },
      { id: 'block', label: 'Block', family: 'Impact, Arial Black, sans-serif' },
      { id: 'modern', label: 'Modern', family: 'Arial, Helvetica, sans-serif' },
      { id: 'classic', label: 'Classic', family: 'Georgia, Times New Roman, serif' },
    ]);
  });

  it('normalizes a custom text item into its stable fields', () => {
    expect(createCustomTextItem({
      id: 'headline',
      text: 'abcdefghijklmnopqrstuvwxyz',
      fontPreset: 'not-a-font',
      fillColor: '#a1b2c3',
      outlineEnabled: 1,
      outlineColor: '#d4e5f6',
      letterSpacing: 28,
      placement: { x: 0.1, y: 0.2, z: 0.3 },
      scale: 3,
      rotation: -1,
    })).toEqual({
      id: 'headline',
      text: 'abcdefghijklmnopqrstuvwx',
      fontPreset: 'athletic',
      fillColor: '#A1B2C3',
      outlineEnabled: true,
      outlineColor: '#D4E5F6',
      letterSpacing: 20,
      placement: { x: 0.1, y: 0.2, z: 0.3 },
      scale: 1.8,
      rotation: 359,
    });
  });

  it('falls back to default colors when values are not six-digit hex colors', () => {
    expect(createCustomTextItem({ fillColor: '#BAD', outlineColor: 'red' }))
      .toMatchObject({ fillColor: '#20242A', outlineColor: '#F7F5EF' });
  });

  it('starts the product state with an empty custom text collection', () => {
    expect(jerseyProduct.defaultState.overrides.customTextItems).toEqual([]);
  });
  it('uses the documented defaults and lower bounds', () => {
    expect(createCustomTextItem({
      letterSpacing: -4,
      scale: 0,
      rotation: 720,
    })).toEqual({
      id: 'text-1',
      text: '',
      fontPreset: 'athletic',
      fillColor: '#20242A',
      outlineEnabled: true,
      outlineColor: '#F7F5EF',
      letterSpacing: 0,
      placement: null,
      scale: 0.55,
      rotation: 0,
    });
  });

  it('keeps non-string text editable but excludes it from billing', () => {
    const items = getCustomTextItems({
      customTextItems: [
        { id: 'text-1', text: null },
        { id: 'text-2', text: undefined },
        { id: 'text-3', text: { value: 'GO' } },
        { id: 'text-4', text: ['GO'] },
      ],
    });

    expect(items.map((item) => item.text)).toEqual(['', '', '', '']);
    expect(getBillableCustomTextItems(items)).toEqual([]);
  });
  it('returns no items when custom text data is missing and rejects non-array data', () => {
    expect(getCustomTextItems({})).toEqual([]);
    expect(() => getCustomTextItems({ customTextItems: 'nope' }))
      .toThrow(new TypeError('Custom text items must be an array.'));
  });

  it('normalizes at most eight items and generates ids for missing ids', () => {
    const items = getCustomTextItems({
      customTextItems: Array.from({ length: 9 }, (_, index) => ({ text: `Text ${index + 1}` })),
    });

    expect(items).toHaveLength(8);
    expect(items.map((item) => item.id)).toEqual([
      'text-1', 'text-2', 'text-3', 'text-4', 'text-5', 'text-6', 'text-7', 'text-8',
    ]);
  });

  it('generates missing ids without colliding with later explicit ids', () => {
    const items = getCustomTextItems({
      customTextItems: [{ text: 'FIRST' }, { id: 'text-1', text: 'SECOND' }],
    });

    expect(items.map((item) => item.id)).toEqual(['text-2', 'text-1']);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it('replaces duplicate explicit ids with generated unique ids', () => {
    const items = getCustomTextItems({
      customTextItems: [{ id: 'text-1', text: 'FIRST' }, { id: 'text-1', text: 'SECOND' }],
    });

    expect(items.map((item) => item.id)).toEqual(['text-1', 'text-2']);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
  it('keeps blank items editable while billing only trimmed non-empty text', () => {
    const items = getCustomTextItems({
      customTextItems: [{ id: 'text-1', text: '   ' }, { id: 'text-2', text: ' GO ' }],
    });

    expect(items).toHaveLength(2);
    expect(getBillableCustomTextItems(items)).toEqual([items[1]]);
  });

  it('falls back non-finite letter spacing and scale values to their defaults', () => {
    expect(createCustomTextItem({ letterSpacing: Number.NaN, scale: Infinity }))
      .toMatchObject({ letterSpacing: 0, scale: 1 });
  });
  it('patches and removes matching items without changing the other entries', () => {
    const items = [
      createCustomTextItem({ id: 'text-1', text: 'ONE' }),
      createCustomTextItem({ id: 'text-2', text: 'TWO' }),
    ];

    expect(patchCustomTextItem(items, 'text-1', { id: 'text-99', text: 'UPDATED', rotation: 361 })[0])
      .toMatchObject({ id: 'text-1', text: 'UPDATED', rotation: 1 });
    expect(removeCustomTextItem(items, 'text-1')).toEqual([items[1]]);
  });

  it('generates the next unused id and duplicates only when capacity and placement allow it', () => {
    const items = [
      createCustomTextItem({ id: 'text-1', text: 'ONE' }),
      createCustomTextItem({ id: 'text-3', text: 'THREE' }),
    ];

    expect(nextTextId(items)).toBe('text-4');
    expect(duplicateCustomTextItem(items, 'text-1', { x: 0.4, y: 0.5, z: 0.6 }))
      .toMatchObject({ id: 'text-4', text: 'ONE', placement: { x: 0.4, y: 0.5, z: 0.6 } });
    expect(duplicateCustomTextItem(items, 'missing', { x: 0, y: 0, z: 0 })).toBeNull();
    expect(duplicateCustomTextItem(items, 'text-1', null)).toBeNull();
    expect(duplicateCustomTextItem(
      Array.from({ length: 8 }, (_, index) => createCustomTextItem({ id: `text-${index + 1}` })),
      'text-1',
      { x: 0, y: 0, z: 0 },
    )).toBeNull();
  });
});
