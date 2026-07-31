import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  collectRenderableUvTriangles,
  getRenderableUvTriangleRevision,
  iterateRenderableUvTriangles,
} from './renderableUvTriangles.js';

describe('renderable UV triangles', () => {
  it('iterates the same triangle coordinates collected by the compatibility API', () => {
    const mesh = createMesh({
      uvs: [[0, 0], [1, 0], [0, 1], [0.5, 0], [1, 1], [0.5, 1]],
    });
    const iterated = Array.from(iterateRenderableUvTriangles(mesh));
    const collected = collectRenderableUvTriangles(mesh);

    expect(iterated).toEqual([
      [0, 0, 1, 0, 0, 1],
      [0.5, 0, 1, 1, 0.5, 1],
    ]);
    expect(iterated.flat()).toEqual(collected.coordinates);
    expect(iterated).toHaveLength(collected.triangleCount);
  });

  it.each([
    ['indexed', [0, 1, 2, 3, 4, 5]],
    ['non-indexed', null],
  ])('accepts a shorter UV attribute when the rendered %s span is covered', (_, indices) => {
    const mesh = createMesh({
      positionCount: 6,
      uvs: [[0, 0], [1, 0], [0, 1]],
      indices,
    });
    mesh.geometry.setDrawRange(0, 3);

    expect(collectRenderableUvTriangles(mesh)).toMatchObject({
      coordinates: [0, 0, 1, 0, 0, 1],
      triangleCount: 1,
    });

    mesh.geometry.setDrawRange(0, 6);
    expect(() => collectRenderableUvTriangles(mesh)).toThrow('UV 属性范围外');
  });

  it('preserves a non-aligned group phase and de-duplicates overlapping draw calls', () => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = createMesh({
      uvs: [[0, 0], [0, 0], [0, 0], [0.5, 0], [0, 1]],
      material: [material],
    });
    mesh.geometry.addGroup(2, 3, 0);
    mesh.geometry.addGroup(2, 3, 0);

    expect(collectRenderableUvTriangles(mesh)).toMatchObject({
      coordinates: [0, 0, 0.5, 0, 0, 1],
      triangleCount: 1,
    });
  });

  it('uses Three material visibility semantics', () => {
    const single = createMesh({ uvs: [[0, 0], [1, 0], [0, 1]] });
    single.material.visible = false;
    expect(collectRenderableUvTriangles(single)).toBeNull();

    const noGroups = createMesh({
      uvs: [[0, 0], [1, 0], [0, 1]],
      material: [new THREE.MeshBasicMaterial()],
    });
    expect(collectRenderableUvTriangles(noGroups)).toBeNull();

    const visibleGroup = createMesh({
      uvs: [[0, 0], [1, 0], [0, 1]],
      material: [new THREE.MeshBasicMaterial()],
    });
    visibleGroup.geometry.addGroup(0, 3, 0);
    expect(collectRenderableUvTriangles(visibleGroup)?.triangleCount).toBe(1);
  });

  it.each([
    ['non-finite position', { positions: [0, 0, 0, 1, 0, 0, Number.NaN, 1, 0] }],
    ['out-of-range index', { indices: [0, 1, 4] }],
    ['fractional index', { indices: new THREE.BufferAttribute(new Float32Array([0, 1, 1.5]), 1) }],
    ['non-finite UV', { uvs: [[0, 0], [1, 0], [Number.NaN, 1]] }],
    ['degenerate UV', { uvs: [[0, 0], [0.5, 0.5], [1, 1]] }],
    ['near-degenerate UV', { uvs: [[0, 0], [1, 0], [1, Number.EPSILON]] }],
  ])('skips %s triangles', (_, overrides) => {
    expect(collectRenderableUvTriangles(createMesh({
      uvs: [[0, 0], [1, 0], [0, 1]],
      ...overrides,
    }))).toBeNull();
  });

  it('reads interleaved accessors and allows finite UV coordinates outside 0..1', () => {
    const buffer = new THREE.InterleavedBuffer(new Float32Array([
      -0.25, 0,
      1.25, 0,
      0, 1.5,
    ]), 2);
    const uvAttribute = new THREE.InterleavedBufferAttribute(buffer, 2, 0);
    const mesh = createMesh({ uvs: [], uvAttribute });

    expect(collectRenderableUvTriangles(mesh)).toMatchObject({
      coordinates: [-0.25, 0, 1.25, 0, 0, 1.5],
      bounds: { minU: -0.25, minV: 0, maxU: 1.25, maxV: 1.5 },
    });
  });

  it('reuses cached parsing until geometry or render semantics change', () => {
    const mesh = createMesh({ uvs: [[0, 0], [1, 0], [0, 1]] });
    const uv = mesh.geometry.getAttribute('uv');
    const getX = vi.spyOn(uv, 'getX');

    const first = collectRenderableUvTriangles(mesh);
    const firstCalls = getX.mock.calls.length;
    expect(collectRenderableUvTriangles(mesh)).toBe(first);
    expect(getX).toHaveBeenCalledTimes(firstCalls);
    expect(getRenderableUvTriangleRevision(mesh)).toBe(first.revision);

    uv.needsUpdate = true;
    const second = collectRenderableUvTriangles(mesh);
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(getX.mock.calls.length).toBeGreaterThan(firstCalls);

    mesh.material.visible = false;
    expect(collectRenderableUvTriangles(mesh)).toBeNull();
  });
});

function createMesh({
  uvs,
  indices = null,
  positionCount = null,
  positions = null,
  uvAttribute = null,
  material = new THREE.MeshBasicMaterial(),
}) {
  const geometry = new THREE.BufferGeometry();
  const count = positionCount ?? uvAttribute?.count ?? uvs.length;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    positions ?? Array.from({ length: count }, (_, index) => [index, 0, 0]).flat(),
    3,
  ));
  geometry.setAttribute('uv', uvAttribute ?? new THREE.Float32BufferAttribute(uvs.flat(), 2));
  if (indices !== null) geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'shared-mesh';
  return mesh;
}
