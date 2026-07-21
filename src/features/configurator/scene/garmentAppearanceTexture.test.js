import { describe, expect, it } from 'vitest';
import { createGarmentAppearanceCanvas, renderGarmentAppearance } from './garmentAppearanceTexture.js';

const appearance = {
  template: 'solid',
  colors: {
    body: '#F7F5EF',
    sleeves: '#1F5B4F',
    shoulderSide: '#20242A',
    collar: '#D1B05D',
    pattern: '#C84F3D',
    number: '#20242A',
  },
};

function createRecordingContext() {
  const calls = [];
  return {
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    closePath: () => calls.push(['closePath']),
    clip: () => calls.push(['clip']),
    fill: () => calls.push(['fill']),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    createLinearGradient: (...args) => ({
      addColorStop: (...stop) => calls.push(['addColorStop', ...args, ...stop]),
    }),
    set fillStyle(value) { calls.push(['fillStyle', value]); },
  };
}

describe('garment appearance texture', () => {
  it('paints clipped atlas regions at the requested size', () => {
    const context = createRecordingContext();

    renderGarmentAppearance(context, { width: 2048, height: 2048 }, appearance);

    expect(context.calls).toContainEqual(['fillRect', 0, 0, 2048, 2048]);
    expect(context.calls.some(([name]) => name === 'clip')).toBe(true);
  });

  it('keeps the 2048 atlas anchors stable for body, sleeves, panels, and collar', () => {
    const context = createRecordingContext();

    renderGarmentAppearance(context, { width: 2048, height: 2048 }, appearance);

    expect(context.calls).toContainEqual(['moveTo', 61.44, 102.4]);
    expect(context.calls).toContainEqual(['moveTo', 757.76, 102.4]);
    expect(context.calls).toContainEqual(['moveTo', 1413.12, 163.84]);
    expect(context.calls).toContainEqual(['moveTo', 491.52, 102.4]);
    expect(context.calls).toContainEqual(['moveTo', 245.76, 0]);
  });

  it.each(['solid', 'vertical-stripes', 'horizontal-stripes', 'diagonal', 'gradient', 'color-block'])(
    'renders the %s template through the body and pattern colors',
    (template) => {
      const context = createRecordingContext();

      renderGarmentAppearance(context, { width: 1024, height: 1024 }, { ...appearance, template });

      expect(context.calls.some(([name]) => name === 'clip')).toBe(true);
      expect(context.calls.some(([name]) => name === 'fillStyle')).toBe(true);
    },
  );

  it('rejects empty texture dimensions', () => {
    expect(() => renderGarmentAppearance(createRecordingContext(), { width: 0, height: 2048 }, appearance))
      .toThrow('Appearance texture requires a positive width and height.');
  });

  it('creates a 2048 square canvas by default', () => {
    const context = createRecordingContext();
    HTMLCanvasElement.prototype.getContext = () => context;
    const canvas = createGarmentAppearanceCanvas(undefined, appearance);

    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(2048);
    expect(context.calls).toContainEqual(['fillStyle', '#F7F5EF']);
  });
});
