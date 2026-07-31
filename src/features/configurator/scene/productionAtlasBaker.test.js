import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bakeProductionAtlas } from './productionAtlasBaker.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('production atlas baker', () => {
  it('composes appearance, legacy pattern, and live layers in render order', async () => {
    const { canvas, context } = installCanvasHarness();
    const garment = createGarmentMesh([
      [0.05, 0.1],
      [0.45, 0.1],
      [0.25, 0.9],
    ]);
    const appearance = { id: 'appearance', width: 32, height: 32 };
    const pattern = { id: 'pattern', width: 32, height: 32 };
    const lower = createLayer({ garmentMesh: garment, id: 'lower', renderOrder: 4 });
    const upper = createLayer({ garmentMesh: garment, id: 'upper', renderOrder: 8 });

    const result = await bakeProductionAtlas({
      appearanceCanvas: appearance,
      atlasSize: 64,
      garmentMeshes: [garment],
      layers: [upper, lower],
      legacyPatternCanvas: pattern,
    });

    expect(result).toMatchObject({
      blob: expect.objectContaining({ type: 'image/png' }),
      canvas,
      colorSpace: 'sRGB',
      height: 64,
      width: 64,
    });
    expect(context.drawImage.mock.calls.map(([source]) => source.id)).toEqual([
      'appearance',
      'pattern',
      'lower',
      'upper',
    ]);
    expect(context.clip).toHaveBeenCalledTimes(2);
  });

  it('maps front and back layers only into their garment UV islands', async () => {
    const { context } = installCanvasHarness();
    const front = createGarmentMesh([
      [0.05, 0.1],
      [0.45, 0.1],
      [0.25, 0.9],
    ], 'Front');
    const back = createGarmentMesh([
      [0.55, 0.1],
      [0.95, 0.1],
      [0.75, 0.9],
    ], 'Back');

    await bakeProductionAtlas({
      appearanceCanvas: { id: 'appearance', width: 32, height: 32 },
      atlasSize: 100,
      garmentMeshes: [front, back],
      layers: [
        createLayer({ garmentMesh: front, id: 'front', renderOrder: 8 }),
        createLayer({ garmentMesh: back, id: 'back', renderOrder: 8 }),
      ],
    });

    const layerStarts = context.moveTo.mock.calls.map(([x]) => x);
    expect(layerStarts).toHaveLength(2);
    expect(layerStarts[0]).toBeLessThan(50);
    expect(layerStarts[1]).toBeGreaterThan(50);
  });

  it('draws UV seam copies on both horizontal atlas edges', async () => {
    const { context } = installCanvasHarness();
    const garment = createGarmentMesh([
      [0.98, 0.1],
      [0.02, 0.1],
      [0.96, 0.9],
    ], 'Seam');

    await bakeProductionAtlas({
      appearanceCanvas: { id: 'appearance', width: 32, height: 32 },
      atlasSize: 100,
      garmentMeshes: [garment],
      layers: [createLayer({
        garmentMesh: garment,
        id: 'seam',
        renderOrder: 8,
        inset: 0.99,
      })],
    });

    expect(context.clip.mock.calls.length).toBe(2);
    const starts = context.moveTo.mock.calls.map(([x]) => x);
    expect(starts.some((x) => x > 90)).toBe(true);
    expect(starts.some((x) => x < 10)).toBe(true);
  });

  it('preserves transparent source pixels by clipping drawImage without a fill', async () => {
    const { context } = installCanvasHarness();
    const garment = createGarmentMesh([
      [0.05, 0.1],
      [0.45, 0.1],
      [0.25, 0.9],
    ]);

    await bakeProductionAtlas({
      appearanceCanvas: { id: 'appearance', width: 32, height: 32 },
      atlasSize: 64,
      garmentMeshes: [garment],
      layers: [createLayer({ garmentMesh: garment, id: 'transparent', renderOrder: 8 })],
    });

    expect(context.fill).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'transparent' }),
      0,
      0,
    );
  });

  it('reuses a successful garment UV projection for duplicated decal vertices', async () => {
    installCanvasHarness();
    const garment = createGarmentMesh([
      [0.05, 0.1],
      [0.45, 0.1],
      [0.25, 0.9],
    ]);
    const layer = createLayer({ garmentMesh: garment, id: 'shared', renderOrder: 8 });
    const positions = [...layer.geometry.getAttribute('position').array];
    const uvs = [...layer.geometry.getAttribute('uv').array];
    layer.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([...positions, ...positions], 3),
    );
    layer.geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([...uvs, ...uvs], 2),
    );
    const intersectObjects = vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects');

    await bakeProductionAtlas({
      appearanceCanvas: { id: 'appearance', width: 32, height: 32 },
      atlasSize: 64,
      garmentMeshes: [garment],
      layers: [layer],
    });

    expect(intersectObjects).toHaveBeenCalledTimes(3);
  });

  it('fails when a printable garment mesh has no UVs', async () => {
    const garment = createGarmentMesh(undefined, 'Body');
    garment.geometry.deleteAttribute('uv');

    await expect(bakeProductionAtlas({
      appearanceCanvas: {},
      atlasSize: 64,
      garmentMeshes: [garment],
      layers: [],
    })).rejects.toThrow('服装网格 "Body" 缺少 UV。');
  });

  it('fails instead of silently skipping an incompletely mapped layer', async () => {
    installCanvasHarness();
    const garment = createGarmentMesh([
      [0.05, 0.1],
      [0.45, 0.1],
      [0.25, 0.9],
    ]);
    const layer = createLayer({ garmentMesh: garment, id: 'broken', renderOrder: 8 });
    layer.surface.position.x = 10;
    layer.surface.updateMatrixWorld(true);

    await expect(bakeProductionAtlas({
      appearanceCanvas: {},
      atlasSize: 64,
      garmentMeshes: [garment],
      layers: [layer],
    })).rejects.toThrow('生产图层 "broken" 无法完整映射到服装 UV。');
  });

  it('honors the configured 4096 atlas contract', async () => {
    const { canvas } = installCanvasHarness();
    const garment = createGarmentMesh([
      [0.05, 0.1],
      [0.45, 0.1],
      [0.25, 0.9],
    ]);

    const result = await bakeProductionAtlas({
      appearanceCanvas: {},
      atlasSize: 4096,
      garmentMeshes: [garment],
      layers: [],
    });

    expect(canvas.width).toBe(4096);
    expect(canvas.height).toBe(4096);
    expect(result).toMatchObject({ width: 4096, height: 4096 });
  });
});

function installCanvasHarness() {
  const context = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
    fill: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: (callback) => callback(new Blob(['png'], { type: 'image/png' })),
  };
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
  return { canvas, context };
}

function createGarmentMesh(uvs = [
  [0, 0],
  [1, 0],
  [0.5, 1],
], name = 'Body') {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
  ], 3));
  if (uvs) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  }
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.name = name;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function createLayer({
  garmentMesh,
  id,
  inset = 0.8,
  renderOrder,
}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -inset, -inset, 0.02,
    inset, -inset, 0.02,
    0, inset, 0.02,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0.5, 1,
  ], 2));
  const surface = new THREE.Mesh(geometry);
  surface.updateMatrixWorld(true);
  return {
    garmentMesh,
    geometry,
    id,
    label: id,
    renderOrder,
    surface,
    textureSource: { id, width: 16, height: 16 },
  };
}
