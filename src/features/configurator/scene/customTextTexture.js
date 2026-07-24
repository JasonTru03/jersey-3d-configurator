import { CUSTOM_TEXT_FONT_PRESETS } from '../config/customTextItems.js';

export const CUSTOM_TEXT_CANVAS_WIDTH = 1024;
export const CUSTOM_TEXT_CANVAS_HEIGHT = 256;
export const CUSTOM_TEXT_CANVAS_ASPECT = CUSTOM_TEXT_CANVAS_WIDTH / CUSTOM_TEXT_CANVAS_HEIGHT;
export const CUSTOM_TEXT_HORIZONTAL_PADDING = 48;

const FONT_SIZE = 112;
const OUTLINE_WIDTH = 12;

export function makeCustomTextCanvas(item = {}, canvas = document.createElement('canvas')) {
  canvas.width = CUSTOM_TEXT_CANVAS_WIDTH;
  canvas.height = CUSTOM_TEXT_CANVAS_HEIGHT;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create custom text canvas context.');

  const fontPreset = CUSTOM_TEXT_FONT_PRESETS.find((preset) => preset.id === item.fontPreset)
    ?? CUSTOM_TEXT_FONT_PRESETS[0];
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  const letterSpacing = normalizeSpacing(item.letterSpacing);

  context.clearRect(0, 0, CUSTOM_TEXT_CANVAS_WIDTH, CUSTOM_TEXT_CANVAS_HEIGHT);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = item.fillColor ?? '#20242A';
  context.strokeStyle = item.outlineColor ?? '#F7F5EF';
  context.lineWidth = OUTLINE_WIDTH;
  context.font = fontFor(fontPreset.family, FONT_SIZE);

  if (text) {
    fitTextToCanvas(context, text, letterSpacing, fontPreset.family);
    drawSpacedText(context, text, CUSTOM_TEXT_CANVAS_WIDTH / 2, CUSTOM_TEXT_CANVAS_HEIGHT / 2, letterSpacing, Boolean(item.outlineEnabled));
  }

  return canvas;
}

export function drawSpacedText(context, text, centerX, y, spacing, outlineEnabled) {
  if (!text) return;

  const normalizedSpacing = normalizeSpacing(spacing);
  if (normalizedSpacing === 0) {
    measureTextWidth(context, text);
    if (outlineEnabled) context.strokeText(text, centerX, y);
    context.fillText(text, centerX, y);
    return;
  }

  const elements = splitTextElements(text);
  const widths = elements.map((element) => measureTextWidth(context, element));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + normalizedSpacing * (elements.length - 1);
  let x = centerX - totalWidth / 2;

  elements.forEach((element, index) => {
    const elementCenter = x + widths[index] / 2;
    if (outlineEnabled) context.strokeText(element, elementCenter, y);
    context.fillText(element, elementCenter, y);
    x += widths[index] + normalizedSpacing;
  });
}

export function splitTextElements(text) {
  if (typeof Intl?.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

function fitTextToCanvas(context, text, spacing, family) {
  const outlineInset = OUTLINE_WIDTH / 2;
  const maxWidth = CUSTOM_TEXT_CANVAS_WIDTH - 2 * (CUSTOM_TEXT_HORIZONTAL_PADDING + outlineInset);
  const epsilon = 0.01;
  let fontSize = FONT_SIZE;
  let layout = measureTextLayout(context, text, spacing);

  for (let iteration = 0; iteration < 3 && layout.totalWidth > maxWidth + epsilon; iteration += 1) {
    fontSize = nextFittedFontSize(fontSize, layout, maxWidth);
    context.font = fontFor(family, fontSize);
    layout = measureTextLayout(context, text, spacing);
  }

  for (let iteration = 0; iteration < 3 && layout.totalWidth > maxWidth + epsilon; iteration += 1) {
    fontSize = nextFittedFontSize(fontSize, layout, maxWidth) * 0.99;
    context.font = fontFor(family, fontSize);
    layout = measureTextLayout(context, text, spacing);
  }

  if (layout.totalWidth > maxWidth + epsilon) {
    throw new Error('Unable to fit custom text within the canvas width.');
  }
}

function nextFittedFontSize(fontSize, layout, maxWidth) {
  const availableGlyphWidth = maxWidth - layout.spacingWidth;
  if (!(availableGlyphWidth > 0) || !(layout.glyphWidth > 0)) {
    throw new Error('Custom text spacing exceeds the available canvas width.');
  }
  return fontSize * Math.min(1, availableGlyphWidth / layout.glyphWidth);
}

function measureTextLayout(context, text, spacing) {
  if (spacing === 0) {
    const width = measureTextWidth(context, text);
    return { glyphWidth: width, spacingWidth: 0, totalWidth: width };
  }

  const elements = splitTextElements(text);
  const glyphWidth = elements.reduce((sum, element) => sum + measureTextWidth(context, element), 0);
  const spacingWidth = spacing * (elements.length - 1);
  return { glyphWidth, spacingWidth, totalWidth: glyphWidth + spacingWidth };
}

function measureTextWidth(context, text) {
  const width = context.measureText(text).width;
  if (!Number.isFinite(width) || width < 0) throw new Error('Unable to measure custom text glyph.');
  return width;
}

function normalizeSpacing(value) {
  const spacing = Number(value);
  return Number.isFinite(spacing) && spacing > 0 ? spacing : 0;
}

function fontFor(family, size) {
  return `900 ${size}px ${family}`;
}
