import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecorationEditor } from './decorationEditor.js';
import { selectDecorationMeshes } from './garmentRenderer.js';
import { bakeProductionAtlas } from './productionAtlasBaker.js';

const garmentMeshesByModel = new Map();

beforeAll(async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ close() {}, height: 1, width: 1 }));
  await Promise.all([
    'chelsea-jersey.glb',
    'fn8788-jersey.glb',
  ].map(async (modelName) => {
    garmentMeshesByModel.set(modelName, await loadGarmentMeshes(modelName));
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

async function loadGarmentMeshes(modelName) {
  const data = readFileSync(resolvePath(process.cwd(), `public/models/${modelName}`));
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = 2.35 / Math.max(size.x, size.y, size.z);
  gltf.scene.scale.setScalar(scale);
  gltf.scene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  gltf.scene.updateMatrixWorld(true);
  const modelMeshes = [];
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => {
        material.side = THREE.DoubleSide;
      });
    } else {
      object.material.side = THREE.DoubleSide;
    }
    modelMeshes.push(object);
  });
  return selectDecorationMeshes(modelMeshes);
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
