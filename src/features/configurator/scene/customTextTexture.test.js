import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_TEXT_CANVAS_ASPECT,
  CUSTOM_TEXT_CANVAS_HEIGHT,
  CUSTOM_TEXT_CANVAS_WIDTH,
  CUSTOM_TEXT_HORIZONTAL_PADDING,
  drawSpacedText,
  makeCustomTextCanvas,
  splitTextElements,
} from './customTextTexture.js';

function createRecordingContext({ glyphWidth = 10, measureText } = {}) {
  const calls = [];
  let font = '';
  return {
    calls,
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    measureText: (text) => {
      calls.push(['measureText', text]);
      return { width: measureText ? measureText(text, font) : glyphWidth };
    },
    strokeText: (...args) => calls.push(['strokeText', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    set textAlign(value) { calls.push(['textAlign', value]); },
    set textBaseline(value) { calls.push(['textBaseline', value]); },
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set strokeStyle(value) { calls.push(['strokeStyle', value]); },
    set lineWidth(value) { calls.push(['lineWidth', value]); },
    set font(value) { font = value; calls.push(['font', value]); },
  };
}

function createCanvas(context) {
  return { width: 0, height: 0, getContext: () => context };
}

afterEach(() => vi.unstubAllGlobals());

describe('custom text texture', () => {
  it('creates a centered 1024 by 256 styled canvas using the selected font family', () => {
    const context = createRecordingContext();
    const canvas = createCanvas(context);
    const result = makeCustomTextCanvas({
      text: '  TEAM  ', fontPreset: 'block', fillColor: '#123456', outlineEnabled: true,
      outlineColor: '#FEDCBA', letterSpacing: 4,
    }, canvas);

    expect(result).toBe(canvas);
    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(256);
    expect(context.calls).toContainEqual(['clearRect', 0, 0, 1024, 256]);
    expect(context.calls).toContainEqual(['textAlign', 'center']);
    expect(context.calls).toContainEqual(['textBaseline', 'middle']);
    expect(context.calls).toContainEqual(['fillStyle', '#123456']);
    expect(context.calls).toContainEqual(['strokeStyle', '#FEDCBA']);
    expect(context.calls).toContainEqual(['lineWidth', 12]);
    expect(context.calls).toContainEqual(['font', '900 112px Impact, Arial Black, sans-serif']);
  });

  it('falls back to the first font preset for unknown font ids', () => {
    const context = createRecordingContext();
    makeCustomTextCanvas({ text: 'A', fontPreset: 'unknown' }, createCanvas(context));
    expect(context.calls).toContainEqual(['font', '900 112px Arial Black, Arial, sans-serif']);
  });

  it('strokes each glyph before filling when outlines and letter spacing are enabled', () => {
    const context = createRecordingContext();
    makeCustomTextCanvas({ text: 'AB', outlineEnabled: true, letterSpacing: 1 }, createCanvas(context));
    expect(context.calls.filter(([name]) => name === 'strokeText' || name === 'fillText')).toEqual([
      ['strokeText', 'A', 506.5, 128], ['fillText', 'A', 506.5, 128],
      ['strokeText', 'B', 517.5, 128], ['fillText', 'B', 517.5, 128],
    ]);
  });

  it('fills without stroking when outlines are disabled', () => {
    const context = createRecordingContext();
    makeCustomTextCanvas({ text: 'A', outlineEnabled: false }, createCanvas(context));
    expect(context.calls.some(([name]) => name === 'strokeText')).toBe(false);
    expect(context.calls).toContainEqual(['fillText', 'A', 512, 128]);
  });

  it('draws spaced glyphs around the requested center', () => {
    const context = createRecordingContext();
    drawSpacedText(context, 'ABC', 100, 40, 5, false);
    expect(context.calls.filter(([name]) => name === 'fillText')).toEqual([
      ['fillText', 'A', 85, 40], ['fillText', 'B', 100, 40], ['fillText', 'C', 115, 40],
    ]);
  });

  it('draws unspaced text in one operation to preserve shaped scripts', () => {
    const context = createRecordingContext();
    drawSpacedText(context, 'سلام', 100, 40, 0, true);
    expect(context.calls.filter(([name]) => name === 'strokeText' || name === 'fillText')).toEqual([
      ['strokeText', 'سلام', 100, 40], ['fillText', 'سلام', 100, 40],
    ]);
  });

  it('does not draw empty text', () => {
    const context = createRecordingContext();
    drawSpacedText(context, '', 100, 40, 5, false);
    expect(context.calls).toEqual([]);
  });

  it('does not draw all-whitespace item text after trimming', () => {
    const context = createRecordingContext();
    makeCustomTextCanvas({ text: '   ', outlineEnabled: true }, createCanvas(context));
    expect(context.calls.some(([name]) => name === 'strokeText' || name === 'fillText')).toBe(false);
  });

  it('splits combining marks, ZWJ emoji, and CJK by grapheme', () => {
    expect(splitTextElements('e\u0301')).toEqual(['e\u0301']);
    expect(splitTextElements('👩‍🚀')).toEqual(['👩‍🚀']);
    expect(splitTextElements('中文A')).toEqual(['中', '文', 'A']);
  });

  it('uses code-point splitting when Intl.Segmenter is unavailable without splitting surrogate pairs', () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    expect(splitTextElements('A😀B')).toEqual(['A', '😀', 'B']);
  });

  it('uses grapheme elements for spaced unicode drawing', () => {
    const context = createRecordingContext();
    drawSpacedText(context, 'A😀B', 100, 40, 5, false);
    expect(context.calls.filter(([name]) => name === 'measureText')).toEqual([
      ['measureText', 'A'], ['measureText', '😀'], ['measureText', 'B'],
    ]);
    expect(context.calls.filter(([name]) => name === 'fillText').map(([, glyph]) => glyph)).toEqual(['A', '😀', 'B']);
  });

  it('fits maximum-length wide text inside the outlined horizontal safe area', () => {
    const baseWidths = { W: 60, M: 45, i: 15 };
    const context = createRecordingContext({
      measureText: (text, font) => {
        const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 112);
        return Array.from(text).reduce((sum, glyph) => sum + (baseWidths[glyph] ?? 10) * size / 112, 0);
      },
    });
    makeCustomTextCanvas({ text: 'WMi'.repeat(8), letterSpacing: 20, outlineEnabled: true }, createCanvas(context));

    const finalFont = context.calls.filter(([name]) => name === 'font').at(-1)[1];
    const finalSize = Number(/(\d+(?:\.\d+)?)px/.exec(finalFont)[1]);
    expect(finalSize).toBeLessThan(112);
    const fillCalls = context.calls.filter(([name]) => name === 'fillText');
    expect(fillCalls).toHaveLength(24);
    fillCalls.forEach(([, glyph, x]) => {
      const glyphHalfWidth = baseWidths[glyph] * finalSize / 112 / 2;
      expect(x - glyphHalfWidth - 6).toBeGreaterThanOrEqual(CUSTOM_TEXT_HORIZONTAL_PADDING);
      expect(x + glyphHalfWidth + 6).toBeLessThanOrEqual(CUSTOM_TEXT_CANVAS_WIDTH - CUSTOM_TEXT_HORIZONTAL_PADDING);
    });
  });

  it('rejects non-finite glyph measurements instead of drawing an invalid texture', () => {
    const context = createRecordingContext({ measureText: () => Number.NaN });
    expect(() => drawSpacedText(context, 'A', 100, 40, 5, false))
      .toThrow('Unable to measure custom text glyph.');
  });

  it('propagates canvas measurement failures', () => {
    const context = createRecordingContext({ measureText: () => { throw new Error('measurement failed'); } });
    expect(() => makeCustomTextCanvas({ text: 'A' }, createCanvas(context))).toThrow('measurement failed');
  });

  it('exports the 4:1 text-plane aspect contract', () => {
    expect(CUSTOM_TEXT_CANVAS_ASPECT).toBe(4);
    expect(CUSTOM_TEXT_CANVAS_WIDTH / CUSTOM_TEXT_CANVAS_HEIGHT).toBe(CUSTOM_TEXT_CANVAS_ASPECT);
  });

  it('throws a clear error when the canvas lacks a 2d context', () => {
    expect(() => makeCustomTextCanvas({ text: 'A' }, createCanvas(null)))
      .toThrow('Unable to create custom text canvas context.');
  });
});