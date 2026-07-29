import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecorationEditor } from './decorationEditor.js';
import { selectDecorationMeshes } from './garmentRenderer.js';

let garmentMeshes;

beforeAll(async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ close() {}, height: 1, width: 1 }));
  const data = readFileSync(resolvePath(process.cwd(), 'public/models/chelsea-jersey.glb'));
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
  garmentMeshes = selectDecorationMeshes(modelMeshes);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('Chelsea artwork default placement', () => {
  it.each([
    { kind: 'badge', region: 'front', expectedNormalZ: 1 },
    { kind: 'badge', region: 'back', expectedNormalZ: -1 },
    { kind: 'upload', region: 'front', expectedNormalZ: 1 },
    { kind: 'upload', region: 'back', expectedNormalZ: -1 },
  ])('centers $kind artwork on the $region projection', ({
    expectedNormalZ,
    kind,
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

    editor.setGarmentMeshes(garmentMeshes);
    editor.update([decoration], decoration.id, []);

    const placement = onDecorationsChange.mock.calls[0][0][0].placement;
    expect(placement.position.x).toBeCloseTo(0, 3);
    expect(Math.sign(placement.position.z)).toBe(expectedNormalZ);
    expect(placement.normal).toEqual({
      x: 0,
      y: 0,
      z: expectedNormalZ,
    });

    editor.dispose();
  });
});
