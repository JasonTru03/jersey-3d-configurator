import { describe, expect, it } from 'vitest';
import { createCylindricalProjector, selectGarmentPatternMeshes } from './modelProjection.js';

describe('model projection', () => {
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

  it('keeps v finite when the garment height range is zero', () => {
    const projector = createCylindricalProjector({
      center: { x: 0, z: 0 },
      minY: 5,
      maxY: 5,
    });

    expect(Number.isFinite(projector.project({ x: 0, y: 5, z: 1 }).v)).toBe(true);
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
});
