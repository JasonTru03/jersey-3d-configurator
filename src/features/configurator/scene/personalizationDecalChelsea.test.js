import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createPersonalizationDecalGeometry,
  fitPersonalizationDecalToSurface,
  getPersonalizationAlphaMask,
  getPersonalizationUvCoverage,
  resolvePersonalizationSurface,
  shouldUsePersonalizationDecal,
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
const textAlphaMask = makeTextAlphaMask();

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
    { expectedUseDecal: true, rotation: 0, scale: 0.55 },
    { expectedUseDecal: true, rotation: 0, scale: 1 },
    { expectedUseDecal: false, rotation: 0, scale: 1.8 },
    { expectedUseDecal: true, rotation: 45, scale: 1 },
  ])('selects a complete decal or full proxy at scale $scale and rotation $rotation', ({
    expectedUseDecal,
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
      surfaces: surface.surfaces,
    });
    const positions = geometry.getAttribute('position');
    const alphaCoverage = getPersonalizationUvCoverage(geometry, textAlphaMask);

    expect(surface.mesh.name).toBe('Cloth_mesh_7');
    expect(surface.sampleCount).toBeGreaterThanOrEqual(3);
    expect(positions.count).toBeGreaterThan(300);
    expect([...positions.array].every(Number.isFinite)).toBe(true);
    expect(shouldUsePersonalizationDecal(geometry, textAlphaMask)).toBe(expectedUseDecal);
    if (expectedUseDecal) expect(alphaCoverage).toBeGreaterThanOrEqual(0.985);
    else expect(alphaCoverage).toBeLessThan(0.985);
    geometry.dispose();
  });

  it('clamps an oversized saved scale to the largest complete Chelsea decal', () => {
    const fit = fitPersonalizationDecalToSurface({
      alphaMask: textAlphaMask,
      height: TEXT_HEIGHT,
      meshes: garmentMeshes,
      minimumCoverage: 0.985,
      minimumScale: 0.55,
      placement: DEFAULT_PLACEMENT,
      rotation: 0,
      scale: 1.8,
      width: TEXT_WIDTH,
    });

    expect(fit).not.toBeNull();
    expect(fit.scale).toBeGreaterThanOrEqual(0.55);
    expect(fit.scale).toBeLessThan(1.8);
    expect(fit.coverage).toBeGreaterThanOrEqual(0.985);
    expect(shouldUsePersonalizationDecal(fit.geometry, textAlphaMask)).toBe(true);
    fit.geometry.dispose();
  });

  it('returns the tighter legal scale when the real Chelsea decal rotates to fifteen degrees', () => {
    const atZero = fitPersonalizationDecalToSurface({
      alphaMask: textAlphaMask,
      height: TEXT_HEIGHT,
      meshes: garmentMeshes,
      minimumCoverage: 0.985,
      minimumScale: 0.55,
      placement: DEFAULT_PLACEMENT,
      rotation: 0,
      scale: 1.8,
      width: TEXT_WIDTH,
    });
    const atFifteen = fitPersonalizationDecalToSurface({
      alphaMask: textAlphaMask,
      height: TEXT_HEIGHT,
      meshes: garmentMeshes,
      minimumCoverage: 0.985,
      minimumScale: 0.55,
      placement: DEFAULT_PLACEMENT,
      rotation: 15,
      scale: atZero.scale,
      width: TEXT_WIDTH,
    });

    expect(atZero.scale).toBeCloseTo(1.0664, 3);
    expect(atFifteen.scale).toBeCloseTo(1.0271, 3);
    expect(atFifteen.scale).toBeLessThan(atZero.scale);
    expect(atFifteen.coverage).toBeGreaterThanOrEqual(0.985);
    atZero.geometry.dispose();
    atFifteen.geometry.dispose();
  }, 15_000);
});

function makeTextAlphaMask() {
  const width = 128;
  const height = 32;
  const alpha = new Uint8ClampedArray(width * height * 4);
  for (let y = 6; y < 26; y += 1) {
    for (let x = 8; x < 120; x += 1) alpha[(y * width + x) * 4 + 3] = 255;
  }
  return getPersonalizationAlphaMask({
    height,
    width,
    getContext: () => ({
      getImageData: () => ({ data: alpha }),
    }),
  }, 2);
}
