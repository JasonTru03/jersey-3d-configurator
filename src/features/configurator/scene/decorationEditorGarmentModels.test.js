import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecorationEditor, getRegionFrame } from './decorationEditor.js';
import { selectDecorationMeshes } from './garmentRenderer.js';

const garmentMeshesByModel = new Map();

beforeAll(async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ close() {}, height: 1, width: 1 }));
  await Promise.all([
    'chelsea-jersey.glb',
    'fn8788-jersey.glb',
  ].map(async (modelName) => {
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
    garmentMeshesByModel.set(modelName, selectDecorationMeshes(modelMeshes));
  }));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('garment artwork default placement', () => {
  it.each([
    ...createPlacementCases('chelsea-jersey.glb'),
    ...createPlacementCases('fn8788-jersey.glb'),
  ])('centers $kind artwork on the $region projection of $modelName', ({
    expectedNormalZ,
    kind,
    modelName,
    region,
  }) => {
    const onDecorationsChange = vi.fn();
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
      onDecorationsChange,
    });
    const decoration = {
      id: `${kind}-${region}`,
      kind,
      label: `${kind} ${region}`,
      placement: null,
      region,
      rotation: 0,
      scale: 1,
      source: '',
      x: 0,
      y: 0,
    };

    editor.setGarmentMeshes(garmentMeshesByModel.get(modelName));
    editor.update([decoration], decoration.id, []);

    const surface = editor.surfaces.get(decoration.id);
    const positions = surface.geometry.getAttribute('position');
    surface.geometry.computeBoundingBox();
    const geometryCenter = surface.geometry.boundingBox.getCenter(new THREE.Vector3());
    expect(positions.count).toBeGreaterThan(0);
    expect(geometryCenter.x).toBeCloseTo(0, 1);
    expect(geometryCenter.y).toBeCloseTo(getRegionFrame(region).anchor.y, 1);
    expect(Math.sign(geometryCenter.z)).toBe(expectedNormalZ);

    const placement = onDecorationsChange.mock.calls[0][0][0].placement;
    expect(placement.position.x).toBeCloseTo(0, 3);
    expect(placement.position.y).toBeCloseTo(getRegionFrame(region).anchor.y, 3);
    expect(Math.sign(placement.position.z)).toBe(expectedNormalZ);
    expect(placement.normal).toEqual({
      x: 0,
      y: 0,
      z: expectedNormalZ,
    });

    editor.dispose();
  });
});

function createPlacementCases(modelName) {
  return [
    { modelName, kind: 'badge', region: 'front', expectedNormalZ: 1 },
    { modelName, kind: 'badge', region: 'back', expectedNormalZ: -1 },
    { modelName, kind: 'upload', region: 'front', expectedNormalZ: 1 },
    { modelName, kind: 'upload', region: 'back', expectedNormalZ: -1 },
  ];
}
