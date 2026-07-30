import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createPersonalizationDecalGeometry,
  getPersonalizationDecalOrientation,
  getPersonalizationAlphaMask,
  getPersonalizationSurfaceFromIntersection,
  getPersonalizationUvCoverage,
  projectPersonalizationCenterOntoSurface,
  resolvePersonalizationSurface,
  shouldUsePersonalizationDecal,
} from './personalizationDecal.js';

describe('personalization decal surface resolution', () => {
  it('raycasts a legacy offset placement back onto the nearest garment surface', () => {
    const garment = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.4));
    garment.updateMatrixWorld(true);

    const surface = resolvePersonalizationSurface([garment], {
      x: 0,
      y: 0,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    });

    expect(surface.mesh).toBe(garment);
    expect(surface.point.z).toBeCloseTo(0.2, 6);
    expect(surface.normal.z).toBeCloseTo(1, 6);
  });

  it('chooses the closest valid garment hit', () => {
    const front = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2));
    front.position.z = 0.15;
    front.updateMatrixWorld(true);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.2));
    back.position.z = -0.2;
    back.updateMatrixWorld(true);

    const surface = resolvePersonalizationSurface([back, front], {
      x: 0,
      y: 0,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    });

    expect(surface.mesh).toBe(front);
    expect(surface.point.z).toBeCloseTo(0.25, 6);
  });

  it.each([
    [[], null],
    [[], { x: 0, y: 0, z: 0, normal: { x: 0, y: 0, z: 1 } }],
    [[new THREE.Mesh()], { x: Number.NaN, y: 0, z: 0 }],
    [[new THREE.Mesh()], { x: 0, y: 0, z: 0, normal: { x: 0, y: 0, z: 0 } }],
  ])('returns null when a surface cannot be resolved', (meshes, placement) => {
    expect(resolvePersonalizationSurface(meshes, placement)).toBeNull();
  });

  it('clones an intersection and projects a proxy center onto its tangent surface', () => {
    const garment = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.4));
    garment.updateMatrixWorld(true);
    const hit = {
      object: garment,
      face: { normal: new THREE.Vector3(0, 0, 1) },
      point: new THREE.Vector3(0.2, 0.1, 0.2),
    };

    const surface = getPersonalizationSurfaceFromIntersection(hit);
    const projected = projectPersonalizationCenterOntoSurface(
      surface,
      new THREE.Vector3(0.7, 0.4, 0.218),
    );
    hit.point.set(9, 9, 9);
    hit.face.normal.set(1, 0, 0);

    expect(surface.point.toArray()).toEqual([0.2, 0.1, 0.2]);
    expect(surface.normal.toArray()).toEqual([0, 0, 1]);
    expect(projected.point.toArray()).toEqual([0.7, 0.4, 0.2]);
    expect(projected.mesh).toBe(garment);
  });

  it('resolves a surface from footprint samples when the proxy center misses', () => {
    const garment = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    garment.updateMatrixWorld(true);

    const surface = resolvePersonalizationSurface(
      [garment],
      {
        x: 0.7,
        y: 0,
        z: 0.018,
        normal: { x: 0, y: 0, z: 1 },
      },
      {
        height: 0.25,
        rotation: 0,
        scale: 1,
        width: 1.05,
      },
    );

    expect(surface.mesh).toBe(garment);
    expect(surface.sampleCount).toBeGreaterThan(0);
    expect(surface.point.x).toBeCloseTo(0.7, 6);
  });

  it('keeps adjacent nearest garment meshes for a footprint that crosses a seam', () => {
    const left = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    left.position.x = -0.25;
    left.updateMatrixWorld(true);
    const right = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    right.position.x = 0.25;
    right.updateMatrixWorld(true);

    const surface = resolvePersonalizationSurface([left, right], {
      x: 0,
      y: 0,
      z: 0.018,
      normal: { x: 0, y: 0, z: 1 },
    }, {
      height: 0.4,
      rotation: 0,
      scale: 1,
      width: 0.8,
    });
    const geometry = createPersonalizationDecalGeometry({
      height: 0.4,
      rotation: 0,
      scale: 1,
      surfaces: surface.surfaces,
      width: 0.8,
    });
    const positions = geometry.getAttribute('position');
    const xValues = Array.from({ length: positions.count }, (_, index) => positions.getX(index));

    expect(surface.surfaces.map(({ mesh }) => mesh)).toEqual(expect.arrayContaining([left, right]));
    expect(geometry.userData.surfaceCount).toBe(2);
    expect(Math.min(...xValues)).toBeLessThan(-0.3);
    expect(Math.max(...xValues)).toBeGreaterThan(0.3);
    geometry.dispose();
  });

  it('keeps only the nearest positive-facing mesh for overlapping front and back layers', () => {
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    front.position.z = 0.1;
    front.updateMatrixWorld(true);
    const behind = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    behind.position.z = 0;
    behind.updateMatrixWorld(true);

    const surface = resolvePersonalizationSurface([behind, front], {
      x: 0,
      y: 0,
      z: 0.3,
      normal: { x: 0, y: 0, z: 1 },
    }, {
      height: 1,
      scale: 1,
      width: 1,
    });

    expect(surface.surfaces).toHaveLength(1);
    expect(surface.surfaces[0].mesh).toBe(front);
  });

  it('keeps center and edge meshes when footprint samples are evenly split', () => {
    const center = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    center.updateMatrixWorld(true);
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    edge.position.x = 0.3;
    edge.updateMatrixWorld(true);

    const surface = resolvePersonalizationSurface([edge, center], {
      x: 0,
      y: 0,
      z: 0.018,
      normal: { x: 0, y: 0, z: 1 },
    }, {
      height: 0.4,
      scale: 1,
      width: 0.8,
    });

    expect(surface.mesh).toBe(center);
    expect(surface.surfaces.map(({ mesh }) => mesh)).toEqual(expect.arrayContaining([center, edge]));
  });

  it('does not reduce estimated projection depth when scale grows and edge samples miss', () => {
    const garment = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 3, 64),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    garment.updateMatrixWorld(true);
    const placement = {
      x: 1.2,
      y: 0,
      z: 0,
      normal: { x: 1, y: 0, z: 0 },
    };
    const small = resolvePersonalizationSurface([garment], placement, {
      height: 0.3,
      scale: 0.8,
      width: 0.8,
    });
    const large = resolvePersonalizationSurface([garment], placement, {
      height: 0.3,
      scale: 1.8,
      width: 0.8,
    });

    expect(large.depth).toBeGreaterThanOrEqual(small.depth);
  });

  it.each([
    new THREE.SkinnedMesh(new THREE.BoxGeometry(2, 2, 0.4)),
    Object.assign(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.4)), {
      morphTargetInfluences: [0, 0.5],
    }),
  ])('uses fallback for an unsupported deformed garment mesh', (garment) => {
    garment.updateMatrixWorld(true);
    expect(resolvePersonalizationSurface([garment], {
      x: 0,
      y: 0,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    }, {
      height: 0.25,
      scale: 1,
      width: 1,
    })).toBeNull();
  });
});

describe('personalization decal geometry', () => {
  it('creates projected vertices with requested aspect, scale, and rotation', () => {
    const garment = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.4));
    garment.updateMatrixWorld(true);
    const surface = resolvePersonalizationSurface([garment], {
      x: 0,
      y: 0,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    });

    const geometry = createPersonalizationDecalGeometry({
      height: 0.35,
      mesh: surface.mesh,
      normal: surface.normal,
      position: surface.point,
      rotation: 45,
      scale: 1.2,
      width: 1.05,
    });

    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    const bounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
    const size = bounds.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(size.y, 5);
    expect(size.x).toBeCloseTo((1.05 * 1.2 + 0.35 * 1.2) / Math.sqrt(2), 5);
    geometry.dispose();
  });

  it('scales width and height without losing the requested text aspect', () => {
    const garment = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.4));
    garment.updateMatrixWorld(true);
    const surface = resolvePersonalizationSurface([garment], {
      x: 0,
      y: 0,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    });
    const geometry = createPersonalizationDecalGeometry({
      height: 0.25,
      mesh: surface.mesh,
      normal: surface.normal,
      position: surface.point,
      rotation: 0,
      scale: 1.5,
      width: 1,
    });
    const bounds = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position'));
    const size = bounds.getSize(new THREE.Vector3());

    expect(size.x).toBeCloseTo(1.5, 5);
    expect(size.y).toBeCloseTo(0.375, 5);
    expect(size.x / size.y).toBeCloseTo(4, 5);
    geometry.dispose();
  });

  it.each([
    {
      label: 'back',
      geometry: new THREE.BoxGeometry(3, 3, 0.4),
      placement: { x: 0, y: 0, z: -0.5, normal: { x: 0, y: 0, z: -1 } },
      surfaceAxis: 'z',
      surfaceValue: -0.2,
    },
    {
      label: 'side',
      geometry: new THREE.BoxGeometry(0.4, 3, 3),
      placement: { x: 0.5, y: 0, z: 0, normal: { x: 1, y: 0, z: 0 } },
      surfaceAxis: 'x',
      surfaceValue: 0.2,
    },
  ])('projects finite rotated geometry onto the $label garment face', ({
    geometry: garmentGeometry,
    placement,
    surfaceAxis,
    surfaceValue,
  }) => {
    const garment = new THREE.Mesh(garmentGeometry);
    garment.updateMatrixWorld(true);
    const surface = resolvePersonalizationSurface([garment], placement);
    const geometry = createPersonalizationDecalGeometry({
      height: 0.25,
      mesh: surface.mesh,
      normal: surface.normal,
      position: surface.point,
      rotation: 30,
      scale: 1,
      width: 1,
    });
    const positions = geometry.getAttribute('position');
    const points = Array.from({ length: positions.count }, (_, index) => (
      new THREE.Vector3().fromBufferAttribute(positions, index)
    ));

    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point.toArray().every(Number.isFinite))).toBe(true);
    expect(points.every((point) => Math.abs(point[surfaceAxis] - surfaceValue) < 0.00001)).toBe(true);
    const size = new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3());
    const inSurfaceDimensions = surfaceAxis === 'z' ? [size.x, size.y] : [size.z, size.y];
    expect(inSurfaceDimensions[0]).toBeGreaterThan(0.9);
    expect(inSurfaceDimensions[1]).toBeGreaterThan(0.65);
    geometry.dispose();
  });

  it('projects finite geometry that follows a curved garment surface', () => {
    const garment = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 64));
    garment.updateMatrixWorld(true);
    const surface = resolvePersonalizationSurface([garment], {
      x: 1.3,
      y: 0,
      z: 0,
      normal: { x: 1, y: 0, z: 0 },
    });
    const geometry = createPersonalizationDecalGeometry({
      height: 0.3,
      mesh: surface.mesh,
      normal: surface.normal,
      position: surface.point,
      rotation: 20,
      scale: 1,
      width: 0.8,
    });
    const positions = geometry.getAttribute('position');
    const points = Array.from({ length: positions.count }, (_, index) => (
      new THREE.Vector3().fromBufferAttribute(positions, index)
    ));
    const radii = points.map((point) => Math.hypot(point.x, point.z));
    const bounds = new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3());

    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point) => point.toArray().every(Number.isFinite))).toBe(true);
    expect(Math.min(...radii)).toBeGreaterThan(0.998);
    expect(Math.max(...radii)).toBeLessThan(1.002);
    expect(bounds.x).toBeGreaterThan(0.04);
    expect(bounds.z).toBeGreaterThan(0.5);
    expect(bounds.y).toBeGreaterThan(0.5);
    expect(geometry.userData.projectionDepth).toBeGreaterThan(0.08);
    geometry.dispose();
  });

  it('filters the opposite garment side when adaptive depth spans the body', () => {
    const garment = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.4));
    garment.updateMatrixWorld(true);
    const surface = {
      mesh: garment,
      normal: new THREE.Vector3(0, 0, 1),
      point: new THREE.Vector3(0, 0, 0.2),
      depth: 1,
    };
    const geometry = createPersonalizationDecalGeometry({
      depth: surface.depth,
      height: 1,
      mesh: surface.mesh,
      normal: surface.normal,
      position: surface.point,
      rotation: 0,
      scale: 1,
      width: 1,
    });
    const positions = geometry.getAttribute('position');
    const zValues = Array.from({ length: positions.count }, (_, index) => positions.getZ(index));

    expect(positions.count).toBeGreaterThan(0);
    expect(Math.min(...zValues)).toBeCloseTo(0.2, 5);
    expect(Math.max(...zValues)).toBeCloseTo(0.2, 5);
    expect(geometry.userData.projectionDepth).toBe(1);
    geometry.dispose();
  });

  it.each([
    [-1, 1, 1, { x: 0, y: 0, z: 1 }],
    [1, -1, 1, { x: 0, y: 0, z: 1 }],
    [1, 1, -1, { x: 0, y: 0, z: -1 }],
    [-1, -1, 1, { x: 0, y: 0, z: 1 }],
  ])('keeps facing triangles under scale [%s, %s, %s]', (x, y, z, normal) => {
    const garment = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    garment.scale.set(x, y, z);
    garment.updateMatrixWorld(true);
    const geometry = createPersonalizationDecalGeometry({
      height: 1,
      mesh: garment,
      normal: new THREE.Vector3(normal.x, normal.y, normal.z),
      position: new THREE.Vector3(),
      rotation: 0,
      scale: 1,
      width: 1,
    });

    expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
    geometry.dispose();
  });

  it('extracts actual alpha samples and measures their UV coverage', () => {
    const alpha = new Uint8ClampedArray(8 * 4 * 4);
    for (let y = 1; y <= 2; y += 1) {
      for (let x = 2; x <= 5; x += 1) alpha[(y * 8 + x) * 4 + 3] = 255;
    }
    const canvas = {
      height: 4,
      width: 8,
      getContext: () => ({
        getImageData: () => ({ data: alpha }),
      }),
    };
    const mask = getPersonalizationAlphaMask(canvas, 1);
    const full = new THREE.PlaneGeometry(1, 1).toNonIndexed();
    const partial = new THREE.BufferGeometry();
    partial.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,
      0, -0.5, 0,
      -0.5, 0.5, 0,
      0, -0.5, 0,
      0, 0.5, 0,
      -0.5, 0.5, 0,
    ], 3));
    partial.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0, 0.5, 0, 0, 1,
      0.5, 0, 0.5, 1, 0, 1,
    ], 2));

    expect(mask.bounds).toEqual({
      maxU: 0.6875,
      maxV: 0.625,
      minU: 0.3125,
      minV: 0.375,
    });
    expect(getPersonalizationUvCoverage(full, mask)).toBe(1);
    expect(getPersonalizationUvCoverage(partial, mask)).toBe(0.5);
    expect(shouldUsePersonalizationDecal(full, mask)).toBe(true);
    expect(shouldUsePersonalizationDecal(partial, mask)).toBe(false);
    expect(shouldUsePersonalizationDecal(new THREE.BufferGeometry(), mask)).toBe(false);
    full.dispose();
    partial.dispose();
  });

  it('keeps exact alpha bounds and samples thin pixels between the sampling grid', () => {
    const alpha = new Uint8ClampedArray(8 * 4 * 4);
    alpha[(1 * 8 + 3) * 4 + 3] = 255;
    alpha[(2 * 8 + 6) * 4 + 3] = 255;
    const mask = getPersonalizationAlphaMask({
      height: 4,
      width: 8,
      getContext: () => ({
        getImageData: () => ({ data: alpha }),
      }),
    }, 4);

    expect(mask.samples).toHaveLength(2);
    expect(mask.bounds).toEqual({
      maxU: 0.8125,
      maxV: 0.625,
      minU: 0.4375,
      minV: 0.375,
    });
  });

  it.each([
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
  ])('builds a finite stable orientation for normal %o', (normal) => {
    const orientation = getPersonalizationDecalOrientation(normal, 135);
    expect(orientation.toArray().every(Number.isFinite)).toBe(true);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
    expect(forward.distanceTo(normal)).toBeLessThan(0.000001);
  });

  it('keeps local up stable across curved back-facing normals', () => {
    const garmentUp = new THREE.Vector3(0, 1, 0);
    [
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0.02, -0.9998).normalize(),
      new THREE.Vector3(0, -0.02, -0.9998).normalize(),
    ].forEach((normal) => {
      const orientation = getPersonalizationDecalOrientation(normal, 0);
      const actualUp = garmentUp.clone().applyQuaternion(orientation);
      const expectedUp = garmentUp.clone()
        .addScaledVector(normal, -garmentUp.dot(normal))
        .normalize();

      expect(actualUp.dot(expectedUp)).toBeGreaterThan(0.999999);
    });
  });

  it('rejects degenerate geometry inputs', () => {
    const garment = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.4));
    garment.updateMatrixWorld(true);
    expect(() => createPersonalizationDecalGeometry({
      height: 0,
      mesh: garment,
      normal: new THREE.Vector3(0, 0, 1),
      position: new THREE.Vector3(),
      rotation: 0,
      scale: 1,
      width: 1,
    })).toThrow(/dimensions/i);
  });
});
