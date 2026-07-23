import { describe, expect, it } from 'vitest';
import { CHELSEA_V1_PROJECTION, createCylindricalProjector, selectGarmentPatternMeshes } from './modelProjection.js';

describe('model projection', () => {
  it('defines the versioned Chelsea front angle used for UV projection', () => {
    expect(CHELSEA_V1_PROJECTION).toEqual({ id: 'chelsea-jersey-cylindrical-v1', version: 1, frontAngleDeg: 0 });
  });
  it('projects v from the garment height range', () => {
    const projector = createCylindricalProjector({
      center: { x: 10, z: -4 },
      minY: 2,
      maxY: 12,
    });

    expect(projector.project({ x: 10, y: 2, z: -3 }).v).toBe(0);
    expect(projector.project({ x: 10, y: 7, z: -3 }).v).toBe(0.5);
    expect(projector.project({ x: 10, y: 12, z: -3 }).v).toBe(1);
  });

  it('wraps u continuously across the cylindrical seam', () => {
    const projector = createCylindricalProjector({
      center: { x: 0, z: 0 },
      minY: 0,
      maxY: 1,
    });

    const beforeSeam = projector.project({ x: 0.001, y: 0.5, z: -1 });
    const afterSeam = projector.project({ x: -0.001, y: 0.5, z: -1 });

    expect(beforeSeam.u).toBeGreaterThan(0.999);
    expect(afterSeam.u).toBeLessThan(0.001);
    expect(Math.min(
      Math.abs(beforeSeam.u - afterSeam.u),
      1 - Math.abs(beforeSeam.u - afterSeam.u),
    )).toBeLessThan(0.001);
  });

  it('normalizes u around the seam after applying the front angle', () => {
    const projector = createCylindricalProjector({
      center: { x: 0, z: 0 },
      minY: 0,
      maxY: 1,
      frontAngleDeg: 270,
    });

    const front = projector.project({ x: 0, y: 0.5, z: 1 });
    const back = projector.project({ x: 0, y: 0.5, z: -1 });

    expect(front.u).toBeCloseTo(0.75);
    expect(back.u).toBeCloseTo(0.25);
    expect(front.u).toBeGreaterThanOrEqual(0);
    expect(front.u).toBeLessThan(1);
  });

  it('uses v zero when the garment height range is zero', () => {
    const projector = createCylindricalProjector({
      center: { x: 0, z: 0 },
      minY: 5,
      maxY: 5,
    });

    expect(projector.project({ x: 0, y: 5, z: 1 }).v).toBe(0);
    expect(projector.project({ x: 0, y: 100, z: 1 }).v).toBe(0);
  });

  it('selects garment cloth meshes by name', () => {
    const meshes = [
      { name: 'Jersey_Cloth' },
      { name: 'FabricPanel' },
      { name: 'Body_Main' },
      { name: 'SleeveTrim' },
    ];

    expect(selectGarmentPatternMeshes(meshes)).toEqual(meshes.slice(0, 3));
  });

  it('falls back to all meshes when no garment names match', () => {
    const meshes = [{ name: 'SleeveTrim' }, { name: 'Collar' }];

    expect(selectGarmentPatternMeshes(meshes)).toEqual(meshes);
  });
});
