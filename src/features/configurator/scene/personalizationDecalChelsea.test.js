import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createPersonalizationDecalGeometry,
  resolvePersonalizationSurface,
} from './personalizationDecal.js';

const DEFAULT_PLACEMENT = {
  x: 0,
  y: 0.36,
  z: 0.5,
  normal: { x: 0, y: 0, z: 1 },
};
const TEXT_WIDTH = 1.05;
const TEXT_HEIGHT = TEXT_WIDTH / 4;

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
  garmentMeshes = [];
  gltf.scene.traverse((object) => {
    if (object.isMesh && /cloth|fabric|body/i.test(object.name)) garmentMeshes.push(object);
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('Chelsea personalization decal coverage', () => {
  it.each([
    { rotation: 0, scale: 0.55 },
    { rotation: 0, scale: 1 },
    { rotation: 0, scale: 1.8 },
    { rotation: 45, scale: 1 },
  ])('covers the visible center text UVs at scale $scale and rotation $rotation', ({
    rotation,
    scale,
  }) => {
    const footprint = {
      height: TEXT_HEIGHT,
      rotation,
      scale,
      width: TEXT_WIDTH,
    };
    const surface = resolvePersonalizationSurface(
      garmentMeshes,
      DEFAULT_PLACEMENT,
      footprint,
    );
    const geometry = createPersonalizationDecalGeometry({
      ...footprint,
      depth: surface.depth,
      mesh: surface.mesh,
      normal: surface.normal,
      position: surface.point,
    });
    const positions = geometry.getAttribute('position');

    expect(surface.mesh.name).toBe('Cloth_mesh_7');
    expect(surface.sampleCount).toBeGreaterThanOrEqual(3);
    expect(positions.count).toBeGreaterThan(300);
    expect([...positions.array].every(Number.isFinite)).toBe(true);
    expect(getUvRasterCoverage(geometry, {
      minU: 0.34,
      maxU: 0.66,
      minV: 0.28,
      maxV: 0.72,
    })).toBeGreaterThan(0.82);
    geometry.dispose();
  });
});

function getUvRasterCoverage(geometry, region) {
  const uv = geometry.getAttribute('uv');
  const columns = 24;
  const rows = 10;
  let covered = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = {
        x: THREE.MathUtils.lerp(region.minU, region.maxU, (column + 0.5) / columns),
        y: THREE.MathUtils.lerp(region.minV, region.maxV, (row + 0.5) / rows),
      };
      if (uvContainsPoint(uv, point)) covered += 1;
    }
  }
  return covered / (columns * rows);
}

function uvContainsPoint(uv, point) {
  const a = new THREE.Vector2();
  const b = new THREE.Vector2();
  const c = new THREE.Vector2();
  for (let index = 0; index + 2 < uv.count; index += 3) {
    a.fromBufferAttribute(uv, index);
    b.fromBufferAttribute(uv, index + 1);
    c.fromBufferAttribute(uv, index + 2);
    if (pointInTriangle(point, a, b, c)) return true;
  }
  return false;
}

function pointInTriangle(point, a, b, c) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 0.0000001) return false;
  const alpha = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y))
    / denominator;
  const beta = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y))
    / denominator;
  const gamma = 1 - alpha - beta;
  return alpha >= -0.000001 && beta >= -0.000001 && gamma >= -0.000001;
}
