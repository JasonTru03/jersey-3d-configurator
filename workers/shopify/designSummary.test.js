import { describe, expect, it } from 'vitest';
import { jerseyProduct } from '../../src/features/configurator/config/productDefinitions.js';
import { normalizeDesignState } from './designNormalizer.js';
import { createDesignSummary } from './designSummary.js';

function rawState(overrides = {}) {
  return {
    ...structuredClone(jerseyProduct.defaultState),
    ...overrides,
  };
}

const productionFiles = {
  bundleFilename: 'jersey-production.zip',
  designFilename: 'jersey-design.json',
  atlasFilename: 'jersey-atlas.png',
  atlasSha256: `sha256:${'a'.repeat(64)}`,
};

function summarize(state, files = null) {
  return createDesignSummary({
    state,
    normalizedState: normalizeDesignState(state),
    productionFiles: files,
  });
}

describe('createDesignSummary', () => {
  it('creates a bounded allowlisted fulfillment summary from trusted and validated fields', () => {
    const state = rawState({
      layout: 'xl',
      lighting: 'name-number',
      extras: { sleeveBadge: true, giftBox: false, matchPatch: true },
      overrides: {
        ...rawState().overrides,
        appearance: {
          template: 'gradient',
          colors: {
            body: '#f7f5ef',
            sleeves: '#20242a',
            shoulderSide: '#1f5b4f',
            collar: '#f4efe4',
            pattern: '#d1b05d',
            number: '#c84f3d',
          },
        },
        printItems: [{ id: 'print-1', name: 'CAPTAIN', number: '9' }],
        customTextItems: [{ text: '  FINAL  ' }, { text: '  ' }],
        decorations: [{ id: 'crest-1', name: 'Club Crest' }, { id: 'badge-2' }],
        bottomPattern: { enabled: true },
      },
    });

    expect(summarize(state, productionFiles)).toEqual({
      Size: 'xl',
      Template: 'gradient',
      Colors: JSON.stringify({
        body: '#F7F5EF',
        sleeves: '#20242A',
        shoulderSide: '#1F5B4F',
        collar: '#F4EFE4',
        pattern: '#D1B05D',
        number: '#C84F3D',
      }),
      Print: 'CAPTAIN #9',
      'Custom Text': 'FINAL',
      Extras: 'sleeveBadge, matchPatch',
      Artwork: 'Club Crest, badge-2',
      'Production Files': 'Local ZIP download',
      'Bundle File': 'jersey-production.zip',
      'Design File': 'jersey-design.json',
      'Atlas File': 'jersey-atlas.png',
      'UV Atlas SHA-256': `sha256:${'a'.repeat(64)}`,
    });
  });

  it('uses normalized size, extras, and custom text rather than caller-supplied summary data', () => {
    const state = rawState({
      layout: 's',
      extras: { sleeveBadge: false, giftBox: true, matchPatch: false },
      overrides: { ...rawState().overrides, customTextItems: [{ text: 'SAFE' }] },
      Size: 'forged',
      Extras: 'forged',
      'Custom Text': 'forged',
    });
    const normalized = normalizeDesignState(state);
    const summary = createDesignSummary({
      state: { ...state, layout: 'xl', extras: {}, overrides: { ...state.overrides, customTextItems: [{ text: 'FORGED' }] } },
      normalizedState: normalized,
      productionFiles: null,
    });

    expect(summary.Size).toBe('s');
    expect(summary.Extras).toBe('giftBox');
    expect(summary['Custom Text']).toBe('SAFE');
  });

  it('omits production summary when bottom pattern is disabled and requires files when enabled', () => {
    const disabled = rawState({
      overrides: { ...rawState().overrides, bottomPattern: { enabled: false } },
    });
    expect(summarize(disabled, productionFiles)).not.toHaveProperty('Production Files');

    const enabled = rawState({
      overrides: { ...rawState().overrides, bottomPattern: { enabled: true } },
    });
    expect(() => summarize(enabled, null)).toThrow('Production files');
  });

  it('rejects unknown templates, color zones, and non-canonical colors', () => {
    for (const appearance of [
      { template: 'unknown', colors: {} },
      { template: 'solid', colors: { unknownZone: '#FFFFFF' } },
      { template: 'solid', colors: { body: '#fff' } },
    ]) {
      const state = rawState({ overrides: { ...rawState().overrides, appearance } });
      expect(() => summarize(state)).toThrow();
    }
  });

  it('validates print length and safe characters only when print lighting is enabled', () => {
    for (const printItems of [
      [{ name: 'A'.repeat(15), number: '9' }],
      [{ name: 'PLAYER\nADMIN', number: '9' }],
      [{ name: 'PLAYER', number: '999' }],
      [{ name: 'PLAYER', number: 'https://x' }],
    ]) {
      const state = rawState({
        lighting: 'name-number',
        overrides: { ...rawState().overrides, printItems },
      });
      expect(() => summarize(state)).toThrow();
    }

    const disabled = rawState({
      lighting: 'none',
      overrides: { ...rawState().overrides, printItems: [{ name: 'https://ignored', number: '999' }] },
    });
    expect(summarize(disabled).Print).toBe('');
  });

  it('rejects oversized or unsafe artwork names and IDs without retaining data URLs', () => {
    const invalidDecorations = [
      Array.from({ length: 9 }, (_, index) => ({ id: `art-${index}` })),
      [{ id: 'data:image/png;base64,AAAA' }],
      [{ id: 'https://example.com/art.png' }],
      [{ id: 'data:image/png;base64,AAAA', name: 'Safe label' }],
      [{ id: 'art-1', name: '  https://example.com/art.png' }],
      [{ id: 'art-1', name: 'bad\u0000name' }],
      [{ id: 'a'.repeat(65) }],
    ];
    for (const decorations of invalidDecorations) {
      const state = rawState({ overrides: { ...rawState().overrides, decorations } });
      expect(() => summarize(state)).toThrow();
    }
  });

  it('rejects control characters in normalized custom text and bounds serialized output', () => {
    for (const text of ['bad\ntext', 'data:image/png,abc']) {
      const state = rawState({
        overrides: { ...rawState().overrides, customTextItems: [{ text }] },
      });
      expect(() => summarize(state)).toThrow();
    }
  });
});
