import { CUSTOM_TEXT_FONT_PRESETS } from '../config/customTextItems.js';

const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 256;
const FONT_SIZE = 112;
const OUTLINE_WIDTH = 12;

export function makeCustomTextCanvas(item = {}, canvas = document.createElement('canvas')) {
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create custom text canvas context.');

  const fontPreset = CUSTOM_TEXT_FONT_PRESETS.find((preset) => preset.id === item.fontPreset)
    ?? CUSTOM_TEXT_FONT_PRESETS[0];
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  const letterSpacing = Number.isFinite(Number(item.letterSpacing)) ? Number(item.letterSpacing) : 0;

  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = item.fillColor ?? '#20242A';
  context.strokeStyle = item.outlineColor ?? '#F7F5EF';
  context.lineWidth = OUTLINE_WIDTH;
  context.font = `900 ${FONT_SIZE}px ${fontPreset.family}`;

  drawSpacedText(context, text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, letterSpacing, Boolean(item.outlineEnabled));
  return canvas;
}

export function drawSpacedText(context, text, centerX, y, spacing, outlineEnabled) {
  const glyphs = Array.from(text);
  if (glyphs.length === 0) return;

  const widths = glyphs.map((glyph) => context.measureText(glyph).width);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + spacing * (glyphs.length - 1);
  let x = centerX - totalWidth / 2;

  glyphs.forEach((glyph, index) => {
    const glyphCenter = x + widths[index] / 2;
    if (outlineEnabled) context.strokeText(glyph, glyphCenter, y);
    context.fillText(glyph, glyphCenter, y);
    x += widths[index] + spacing;
  });
}