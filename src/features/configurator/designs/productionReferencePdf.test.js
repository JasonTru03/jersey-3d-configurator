import { describe, expect, it, vi } from 'vitest';
import { createProductionReferencePdf } from './productionReferencePdf.js';

const input = {
  atlas: { id: 'atlas', width: 4096, height: 4096 },
  atlasSize: 4096,
  designFingerprint: '12ab34cd',
  generatedAt: '2026-07-31T08:00:00.000Z',
  model: {
    id: 'chelsea-jersey',
    version: '1',
    uvExportVersion: '1',
  },
  previewBack: { id: 'back', width: 1600, height: 1600 },
  previewFront: { id: 'front', width: 1600, height: 1600 },
  productName: 'Chelsea Match Jersey',
  sizeLabel: 'M',
  templateLabel: '色块',
  zoneColors: [
    { label: '衣身', value: '#F7F5EF' },
    { label: '袖子', value: '#20242A' },
  ],
};

describe('production reference PDF', () => {
  it('creates two A4 landscape raster pages with Chinese reference content', async () => {
    const harness = createCanvasHarness();

    const result = await createProductionReferencePdf(input, {
      createCanvas: harness.createCanvas,
    });

    expect(result).toMatchObject({
      blob: expect.objectContaining({ type: 'application/pdf' }),
      pageCount: 2,
      pageSize: { widthMm: 297, heightMm: 210 },
    });
    expect(harness.canvases).toHaveLength(2);
    const allText = harness.contexts.flatMap((context) => (
      context.fillText.mock.calls.map(([text]) => text)
    ));
    expect(allText).toContain('球衣定制生产参考');
    expect(allText).toContain('本地设计，尚未关联 Shopify 订单');
    expect(allText).toContain('正面预览');
    expect(allText).toContain('背面预览');
    expect(allText.filter((text) => text.includes('不是工厂 1:1 裁片文件')))
      .toHaveLength(2);
    const imageSources = harness.contexts.flatMap((context) => (
      context.drawImage.mock.calls.map(([source]) => source)
    ));
    expect(imageSources).toEqual(expect.arrayContaining([
      input.previewFront,
      input.previewBack,
      input.atlas,
    ]));

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(text.match(/\/MediaBox \[0 0 841\.89 595\.28\]/g)).toHaveLength(2);
    expect(text.endsWith('%%EOF')).toBe(true);
    const xrefOffset = Number(text.match(/startxref\n(\d+)\n%%EOF$/)?.[1]);
    expect(text.slice(xrefOffset, xrefOffset + 4)).toBe('xref');
  });

  it('fails clearly when a page cannot be encoded', async () => {
    const harness = createCanvasHarness({ encodedBlob: null });

    await expect(createProductionReferencePdf(input, {
      createCanvas: harness.createCanvas,
    })).rejects.toThrow('无法生成 PDF 页面图像。');
  });
});

function createCanvasHarness({
  encodedBlob = new Blob(['jpeg'], { type: 'image/jpeg' }),
} = {}) {
  const canvases = [];
  const contexts = [];
  return {
    canvases,
    contexts,
    createCanvas: vi.fn((width, height) => {
      const context = {
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        set fillStyle(_value) {},
        set font(_value) {},
        set textAlign(_value) {},
        set textBaseline(_value) {},
      };
      const canvas = {
        width,
        height,
        getContext: vi.fn(() => context),
        toBlob: vi.fn((callback) => callback(encodedBlob)),
      };
      canvases.push(canvas);
      contexts.push(context);
      return canvas;
    }),
  };
}
