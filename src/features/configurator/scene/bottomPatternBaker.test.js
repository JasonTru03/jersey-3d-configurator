import { afterEach, describe, expect, it, vi } from 'vitest';
import { bakeBottomPatternAtlas, createPatternBakeKey } from './bottomPatternBaker.js';

const bakeInput = {
  sourceHash: 'sha256:pattern-a',
  transform: {
    offset: { u: 0.1, v: -0.2 },
    scale: 1.5,
    rotationDeg: 45,
    repeat: { u: 3, v: 4 },
  },
  projectionVersion: 1,
  projectionId: 'chelsea-jersey-cylindrical-v1',
  size: 2048,
};

afterEach(() => vi.restoreAllMocks());

describe('bottom pattern baker', () => {
  it('creates the same key for the same bake inputs', () => {
    expect(createPatternBakeKey(bakeInput)).toBe(createPatternBakeKey(structuredClone(bakeInput)));
  });

  it.each([
    ['source hash', { sourceHash: 'sha256:pattern-b' }],
    ['transform', { transform: { ...bakeInput.transform, scale: 2 } }],
    ['projection version', { projectionVersion: 2 }],
    ['projection id', { projectionId: 'alternate-projection-v1' }],
    ['atlas size', { size: 1024 }],
  ])('changes the key when the %s changes', (_, changed) => {
    expect(createPatternBakeKey({ ...bakeInput, ...changed })).not.toBe(createPatternBakeKey(bakeInput));
  });

  it('accepts the bottom-pattern configuration projection field', async () => {
    const context = { clearRect: vi.fn(), drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' })),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);

    const { metadata } = await bakeBottomPatternAtlas({
      meshEntries: [{ name: 'Body_Main' }],
      pattern: { ...bakeInput, projectionId: undefined, modelProjectionId: bakeInput.projectionId },
      sourceTexture: { width: 16, height: 16 },
    });

    expect(metadata.projectionId).toBe(bakeInput.projectionId);
  });

  it('rejects invalid bake inputs before creating an atlas', async () => {
    await expect(bakeBottomPatternAtlas({
      meshEntries: [],
      pattern: { ...bakeInput },
      sourceTexture: {},
      size: 1024,
    })).rejects.toThrow('meshEntries must contain at least one entry');

    await expect(bakeBottomPatternAtlas({
      meshEntries: [{ name: 'Body' }],
      pattern: { ...bakeInput },
      sourceTexture: null,
      size: 1024,
    })).rejects.toThrow('sourceTexture is required');

    await expect(bakeBottomPatternAtlas({
      meshEntries: [{ name: 'Body' }],
      pattern: { ...bakeInput },
      sourceTexture: {},
      size: 0,
    })).rejects.toThrow('size must be a positive integer');
  });

  it('returns a PNG blob with deterministic 2048 atlas metadata', async () => {
    const context = { clearRect: vi.fn(), drawImage: vi.fn() };
    const png = new Blob(['png'], { type: 'image/png' });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: (callback) => callback(png),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);

    const sourceTexture = { width: 16, height: 16 };
    const result = await bakeBottomPatternAtlas({
      meshEntries: [{ name: 'Body_Main' }, { name: 'Sleeve' }],
      pattern: bakeInput,
      sourceTexture,
    });

    expect(result.blob).toBe(png);
    expect(result.metadata).toEqual({
      key: createPatternBakeKey(bakeInput),
      mimeType: 'image/png',
      atlasSize: 2048,
      size: 2048,
      width: 2048,
      height: 2048,
      meshCount: 2,
      sourceHash: 'sha256:pattern-a',
      transform: bakeInput.transform,
      projectionVersion: 1,
      projectionId: 'chelsea-jersey-cylindrical-v1',
    });
    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(2048);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 2048, 2048);
    expect(context.drawImage).toHaveBeenCalledWith(sourceTexture, 0, 0, 2048, 2048);
  });

  it('bakes projected garment triangles into the model UV atlas instead of copying source metadata only', async () => {
    const context = {
      clearRect: vi.fn(), drawImage: vi.fn(), createPattern: vi.fn(() => ({ setTransform: vi.fn() })),
      save: vi.fn(), restore: vi.fn(), transform: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
      set fillStyle(_) {},
    };
    const canvas = {
      width: 0, height: 0, getContext: vi.fn(() => context),
      toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' })),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);
    const geometry = {
      attributes: {
        position: { count: 3, getX: (index) => [0, 1, 0][index], getY: (index) => [0, 0, 1][index], getZ: () => 0 },
        uv: { getX: (index) => [0, 1, 0][index], getY: (index) => [0, 0, 1][index] },
      },
    };

    await bakeBottomPatternAtlas({
      meshEntries: [{ geometry, localToWorld: (point) => point }], pattern: bakeInput, sourceTexture: { width: 16, height: 16 }, size: 64,
    });

    expect(context.createPattern).toHaveBeenCalledWith(expect.anything(), 'repeat');
    expect(context.transform).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalledOnce();
    expect(context.lineWidth).toBe(8);
    expect(context.stroke).toHaveBeenCalledOnce();
  });
});
