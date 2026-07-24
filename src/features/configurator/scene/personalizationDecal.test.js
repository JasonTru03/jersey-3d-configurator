import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createPersonalizationDecalGeometry,
  getPersonalizationDecalOrientation,
  getPersonalizationSurfaceFromIntersection,
  projectPersonalizationCenterOntoSurface,
  resolvePersonalizationSurface,
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
    geometry.dispose();
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
