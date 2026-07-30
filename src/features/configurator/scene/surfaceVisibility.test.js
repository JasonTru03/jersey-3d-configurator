import { describe, expect, it, vi } from 'vitest';
import { Mesh, PlaneGeometry, Vector3 } from 'three';
import {
  ELEMENT_SURFACE_EPSILON,
  SURFACE_FACING_THRESHOLD,
  findNearestFacingIntersection,
  findVisibleElementIntersection,
  getWorldIntersectionNormal,
  isIntersectionFacingRay,
} from './surfaceVisibility.js';

function createMesh() {
  const mesh = new Mesh(new PlaneGeometry(1, 1));
  mesh.updateMatrixWorld(true);
  return mesh;
}

function createHit({ distance, normal = new Vector3(0, 0, 1), object = createMesh() }) {
  return {
    distance,
    face: { normal },
    object,
  };
}

function createRaycaster(direction, intersectionsByObjects) {
  return {
    ray: { direction },
    intersectObjects: vi.fn((objects) => intersectionsByObjects.get(objects) ?? []),
  };
}

describe('camera-visible surface policy', () => {
  it('transforms an intersection normal into world space', () => {
    const mesh = createMesh();
    mesh.rotation.y = Math.PI;
    mesh.updateMatrixWorld(true);

    const normal = getWorldIntersectionNormal(createHit({
      distance: 1,
      normal: new Vector3(0, 0, 1),
      object: mesh,
    }));

    expect(normal.x).toBeCloseTo(0);
    expect(normal.y).toBeCloseTo(0);
    expect(normal.z).toBeCloseTo(-1);
    expect(SURFACE_FACING_THRESHOLD).toBe(0.08);
  });

  it('accepts front-facing intersections and rejects back-facing intersections', () => {
    const rayDirection = new Vector3(0, 0, -1);

    expect(isIntersectionFacingRay(
      createHit({ distance: 1, normal: new Vector3(0, 0, 1) }),
      rayDirection,
    )).toBe(true);
    expect(isIntersectionFacingRay(
      createHit({ distance: 1, normal: new Vector3(0, 0, -1) }),
      rayDirection,
    )).toBe(false);
    expect(isIntersectionFacingRay(createHit({ distance: 1 }), new Vector3())).toBe(false);
  });

  it('fails closed for invalid facing thresholds while preserving valid boundary values', () => {
    const rayDirection = new Vector3(0, 0, -1);
    const frontHit = createHit({ distance: 1, normal: new Vector3(0, 0, 1) });
    const backHit = createHit({ distance: 1, normal: new Vector3(0, 0, -1) });
    const tangentHit = createHit({ distance: 1, normal: new Vector3(1, 0, 0) });

    for (const [threshold, hit] of [
      [-1, backHit],
      [1.01, frontHit],
      [Infinity, frontHit],
      [Number.NaN, frontHit],
      ['1', frontHit],
    ]) {
      expect(isIntersectionFacingRay(hit, rayDirection, threshold)).toBe(false);
    }

    expect(isIntersectionFacingRay(tangentHit, rayDirection, 0)).toBe(true);
    expect(isIntersectionFacingRay(frontHit, rayDirection, 0.08)).toBe(true);
    expect(isIntersectionFacingRay(frontHit, rayDirection, 1)).toBe(true);
  });

  it('skips a nearer back-facing garment hit and returns the next outward hit', () => {
    const garmentMeshes = [createMesh()];
    const backHit = createHit({ distance: 1, normal: new Vector3(0, 0, -1) });
    const outwardHit = createHit({ distance: 2, normal: new Vector3(0, 0, 1) });
    const raycaster = createRaycaster(
      new Vector3(0, 0, -1),
      new Map([[garmentMeshes, [backHit, outwardHit]]]),
    );

    expect(findNearestFacingIntersection(raycaster, garmentMeshes)).toBe(outwardHit);
  });

  it('rejects an outward element hidden behind the front garment surface', () => {
    const elements = [createMesh()];
    const garmentMeshes = [createMesh()];
    const hiddenElementHit = createHit({ distance: 3 });
    const garmentHit = createHit({ distance: 2 });
    const raycaster = createRaycaster(
      new Vector3(0, 0, -1),
      new Map([
        [elements, [hiddenElementHit]],
        [garmentMeshes, [garmentHit]],
      ]),
    );

    expect(findVisibleElementIntersection({
      elements,
      garmentMeshes,
      raycaster,
    })).toBeNull();
  });

  it('accepts an outward element within the garment surface epsilon', () => {
    const elements = [createMesh()];
    const garmentMeshes = [createMesh()];
    const elementHit = createHit({ distance: 2.03 });
    const garmentHit = createHit({ distance: 2 });
    const raycaster = createRaycaster(
      new Vector3(0, 0, -1),
      new Map([
        [elements, [elementHit]],
        [garmentMeshes, [garmentHit]],
      ]),
    );

    expect(ELEMENT_SURFACE_EPSILON).toBe(0.04);
    expect(findVisibleElementIntersection({
      elements,
      garmentMeshes,
      raycaster,
    })).toBe(elementHit);
  });

  it('fails closed for invalid surface epsilons while preserving valid tolerance behavior', () => {
    const elements = [createMesh()];
    const garmentMeshes = [createMesh()];
    const hiddenElementHit = createHit({ distance: 3 });
    const nearElementHit = createHit({ distance: 2.03 });
    const garmentHit = createHit({ distance: 2 });
    const direction = new Vector3(0, 0, -1);
    const hiddenRaycaster = createRaycaster(
      direction,
      new Map([
        [elements, [hiddenElementHit]],
        [garmentMeshes, [garmentHit]],
      ]),
    );
    const nearRaycaster = createRaycaster(
      direction,
      new Map([
        [elements, [nearElementHit]],
        [garmentMeshes, [garmentHit]],
      ]),
    );

    for (const surfaceEpsilon of [-1, Infinity, Number.NaN, '1']) {
      expect(findVisibleElementIntersection({
        elements,
        garmentMeshes,
        raycaster: hiddenRaycaster,
        surfaceEpsilon,
      })).toBeNull();
    }

    expect(findVisibleElementIntersection({
      elements,
      garmentMeshes,
      raycaster: nearRaycaster,
      surfaceEpsilon: 0,
    })).toBeNull();
    expect(findVisibleElementIntersection({
      elements,
      garmentMeshes,
      raycaster: nearRaycaster,
      surfaceEpsilon: 0.04,
    })).toBe(nearElementHit);
  });

  it('accepts a genuinely visible oblique side element when that ray has no garment hit', () => {
    const elements = [createMesh()];
    const garmentMeshes = [createMesh()];
    const sideHit = createHit({ distance: 1, normal: new Vector3(1, 0, 0) });
    const raycaster = createRaycaster(
      new Vector3(-0.2, 0, -1).normalize(),
      new Map([
        [elements, [sideHit]],
        [garmentMeshes, []],
      ]),
    );

    expect(findVisibleElementIntersection({
      elements,
      garmentMeshes,
      raycaster,
    })).toBe(sideHit);
  });
});
