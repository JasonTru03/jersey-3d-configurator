import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const REAL_GARMENT_MODELS = Object.freeze([
  Object.freeze({
    assetName: 'chelsea-jersey.glb',
    model: Object.freeze({ id: 'chelsea-jersey', version: '1' }),
  }),
  Object.freeze({
    assetName: 'fn8788-jersey.glb',
    model: Object.freeze({ id: 'fn8788-jersey', version: '1' }),
  }),
]);

export async function loadRealGarmentMeshes(modelName) {
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
  return modelMeshes;
}
