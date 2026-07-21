import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_PALETTE,
  APPEARANCE_TEMPLATES,
  APPEARANCE_TEXTURE_VERSION,
  APPEARANCE_ZONES,
  normalizeAppearance,
} from './appearance.js';
import { selectedOptions } from './selectors.js';

describe('appearance configuration', () => {
  const swatches = {
    accent: '#c84f3d',
    fabric: '#20242a',
    number: '#f4efe4',
    trim: '#f4efe4',
  };

  it('exposes stable texture metadata, zones, templates, and palette', () => {
    expect(APPEARANCE_TEXTURE_VERSION).toBe(1);
    expect(APPEARANCE_ZONES).toEqual(['body', 'sleeves', 'shoulderSide', 'collar', 'pattern', 'number']);
    expect(APPEARANCE_TEMPLATES.map((template) => template.id)).toEqual([
      'solid', 'vertical-stripes', 'horizontal-stripes', 'diagonal', 'gradient', 'color-block',
    ]);
    expect(APPEARANCE_PALETTE).not.toHaveLength(0);
  });

  it('migrates legacy swatches and normalizes color casing', () => {
    expect(normalizeAppearance({
      template: 'diagonal',
      colors: { body: '#f7f5ef', number: '#aBc123' },
    }, swatches)).toEqual({
      template: 'diagonal',
      colors: {
        body: '#F7F5EF',
        sleeves: '#20242A',
        shoulderSide: '#F4EFE4',
        collar: '#F4EFE4',
        pattern: '#C84F3D',
        number: '#ABC123',
      },
    });
  });

  it('falls back to solid for an unknown template', () => {
    expect(normalizeAppearance({ template: 'club-checker' }, swatches).template).toBe('solid');
  });

  it('rejects an explicitly invalid zone color', () => {
    expect(() => normalizeAppearance({ colors: { collar: '#fff' } }, swatches))
      .toThrow('Appearance color collar must be a six-digit hex color.');
  });

  it('returns normalized appearance with the selected options', () => {
    const selected = selectedOptions({
      options: {
        colorway: [{ id: 'home', swatches }],
        extras: [],
        layout: [],
        material: [],
        lighting: [],
      },
    }, {
      colorway: 'home',
      extras: {},
      overrides: { appearance: { template: 'gradient', colors: { body: '#f7f5ef' } } },
    });

    expect(selected.appearance).toMatchObject({
      template: 'gradient',
      colors: { body: '#F7F5EF', sleeves: '#20242A' },
    });
  });
});
