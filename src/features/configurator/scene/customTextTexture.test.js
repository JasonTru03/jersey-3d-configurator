import { describe, expect, it } from 'vitest';
import { drawSpacedText, makeCustomTextCanvas } from './customTextTexture.js';

function createRecordingContext({ glyphWidth = 10 } = {}) {
  const calls = [];
  return {
    calls,
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    measureText: (text) => {
      calls.push(['measureText', text]);
      return { width: glyphWidth };
    },
    strokeText: (...args) => calls.push(['strokeText', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    set textAlign(value) { calls.push(['textAlign', value]); },
    set textBaseline(value) { calls.push(['textBaseline', value]); },
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set strokeStyle(value) { calls.push(['strokeStyle', value]); },
    set lineWidth(value) { calls.push(['lineWidth', value]); },
    set font(value) { calls.push(['font', value]); },
  };
}

function createCanvas(context) {
  return {
    width: 0,
    height: 0,
    getContext: () => context,
  };
}

describe('custom text texture', () => {
  it('creates a centered 1024 by 256 styled canvas using the selected font family', () => {
    const context = createRecordingContext();
    const canvas = createCanvas(context);

    const result = makeCustomTextCanvas({
      text: '  TEAM  ',
      fontPreset: 'block',
      fillColor: '#123456',
      outlineEnabled: true,
      outlineColor: '#FEDCBA',
      letterSpacing: 4,
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
    expect(context.calls).toContainEqual(['strokeText', 'T', 491, 128]);
    expect(context.calls).toContainEqual(['fillText', 'T', 491, 128]);
  });

  it('falls back to the first font preset for unknown font ids', () => {
    const context = createRecordingContext();

    makeCustomTextCanvas({ text: 'A', fontPreset: 'unknown' }, createCanvas(context));

    expect(context.calls).toContainEqual(['font', '900 112px Arial Black, Arial, sans-serif']);
  });

  it('strokes each glyph before filling when outlines are enabled', () => {
    const context = createRecordingContext();

    makeCustomTextCanvas({ text: 'AB', outlineEnabled: true }, createCanvas(context));

    expect(context.calls.filter(([name]) => name === 'strokeText' || name === 'fillText')).toEqual([
      ['strokeText', 'A', 507, 128],
      ['fillText', 'A', 507, 128],
      ['strokeText', 'B', 517, 128],
      ['fillText', 'B', 517, 128],
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
      ['fillText', 'A', 85, 40],
      ['fillText', 'B', 100, 40],
      ['fillText', 'C', 115, 40],
    ]);
  });

  it('does not draw empty text', () => {
    const context = createRecordingContext();

    drawSpacedText(context, '', 100, 40, 5, false);

    expect(context.calls).toEqual([]);
  });

  it('splits unicode text by code point before measuring and drawing', () => {
    const context = createRecordingContext();

    drawSpacedText(context, 'A😀B', 100, 40, 0, false);

    expect(context.calls.filter(([name]) => name === 'measureText')).toEqual([
      ['measureText', 'A'],
      ['measureText', '😀'],
      ['measureText', 'B'],
    ]);
    expect(context.calls.filter(([name]) => name === 'fillText').map(([, glyph]) => glyph)).toEqual(['A', '😀', 'B']);
  });

  it('throws a clear error when the canvas lacks a 2d context', () => {
    expect(() => makeCustomTextCanvas({ text: 'A' }, createCanvas(null)))
      .toThrow('Unable to create custom text canvas context.');
  });
});