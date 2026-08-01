import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DecorationEditor } from './decorationEditor.js';
import { bakeProductionAtlas } from './productionAtlasBaker.js';
import { loadRealGarmentMeshes } from './realGarmentModelTestHelpers.js';

const garmentMeshesByModel = new Map();

beforeAll(async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ close() {}, height: 1, width: 1 }));
  await Promise.all([
    'chelsea-jersey.glb',
    'fn8788-jersey.glb',
  ].map(async (modelName) => {
    garmentMeshesByModel.set(modelName, await loadRealGarmentMeshes(modelName));
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('production atlas artwork mapping on real garment models', () => {
  it.each([
    { modelName: 'chelsea-jersey.glb', region: 'front' },
    { modelName: 'chelsea-jersey.glb', region: 'back' },
    { modelName: 'fn8788-jersey.glb', region: 'front' },
    { modelName: 'fn8788-jersey.glb', region: 'back' },
  ])('maps default $region artwork on $modelName without dropping decal triangles', async ({
    modelName,
    region,
  }) => {
    const garmentMeshes = garmentMeshesByModel.get(modelName);
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
    });
    editor.setGarmentMeshes(garmentMeshes);
    editor.update([{
      id: `upload-${region}`,
      kind: 'upload',
      label: `Upload ${region}`,
      placement: null,
      region,
      rotation: 0,
      scale: 1,
      source: '',
    }], null, []);
    const { canvas } = installCanvasHarness();

    await expect(bakeProductionAtlas({
      appearanceCanvas: { width: 32, height: 32 },
      atlasSize: 4096,
      garmentMeshes,
      layers: editor.getProductionLayers(),
    })).resolves.toMatchObject({
      height: 4096,
      width: 4096,
    });

    editor.dispose();
    canvas.width = 0;
    canvas.height = 0;
  }, 20_000);

  it.each([
    'chelsea-jersey.glb',
    'fn8788-jersey.glb',
  ])('maps two automatically placed front artworks on %s', async (modelName) => {
    const garmentMeshes = garmentMeshesByModel.get(modelName);
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
    });
    editor.setGarmentMeshes(garmentMeshes);
    editor.update([
      createDecoration('crest-front', 'badge'),
      createDecoration('upload-front', 'upload'),
    ], null, []);
    installCanvasHarness();

    await expect(bakeProductionAtlas({
      appearanceCanvas: { width: 32, height: 32 },
      atlasSize: 4096,
      garmentMeshes,
      layers: editor.getProductionLayers(),
    })).resolves.toMatchObject({
      height: 4096,
      width: 4096,
    });

    editor.dispose();
  }, 20_000);
});

function createDecoration(id, kind) {
  return {
    id,
    kind,
    label: id,
    placement: null,
    region: 'front',
    rotation: 0,
    scale: 1,
    source: '',
  };
}

function installCanvasHarness() {
  const context = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    clip: vi.fn(),
    closePath: vi.fn(),
    drawImage: vi.fn(),
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
