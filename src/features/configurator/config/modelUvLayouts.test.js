import { describe, expect, it } from 'vitest';
import { jerseyProduct } from './productDefinitions.js';
import {
  MODEL_UV_LAYOUTS,
  getModelUvLayout,
  validateModelUvLayout,
} from './modelUvLayouts.js';

describe('model UV seam layouts', () => {
  it.each([
    {
      model: { id: 'chelsea-jersey', version: '1' },
      meshes: ['Cloth_mesh_7', 'Cloth_mesh_4'],
    },
    {
      model: { id: 'fn8788-jersey', version: '1' },
      meshes: ['Cloth_mesh_1', 'Cloth_mesh_5'],
    },
  ])('exposes verified front and back groups for $model.id', ({ model, meshes }) => {
    const layout = getModelUvLayout(model);

    expect(layout.pieceGroups.map(({ id }) => id)).toEqual(['front', 'back']);
    expect(layout.pieceGroups.flatMap(({ islandRefs }) => (
      islandRefs.map(({ meshName }) => meshName)
    ))).toEqual(meshes);
    expect(layout.pieceGroups.map(({ rotation, mirrorX }) => ({ rotation, mirrorX })))
      .toEqual([
        { rotation: 0, mirrorX: false },
        { rotation: 0, mirrorX: false },
      ]);
    expect(validateModelUvLayout(
      layout,
      meshes.map((name) => ({ name })),
    )).toBe(true);
  });

  it('freezes the model layout registry and registered layouts', () => {
    expect(Object.isFrozen(MODEL_UV_LAYOUTS)).toBe(true);
    expect(Object.values(MODEL_UV_LAYOUTS).every(Object.isFrozen)).toBe(true);
  });

  it('rejects a layout without the two-piece minimum', () => {
    expect(() => validateModelUvLayout({
      version: 1,
      pieceGroups: [{ id: 'front', islandRefs: [{ meshName: 'front-mesh' }] }],
    }, [{ name: 'front-mesh' }])).toThrow('正片和背片');
  });

  it('rejects an island reference to a missing mesh', () => {
    expect(() => validateModelUvLayout({
      version: 1,
      pieceGroups: [
        { id: 'front', islandRefs: [{ meshName: 'missing-mesh' }] },
        { id: 'back', islandRefs: [{ meshName: 'back-mesh' }] },
      ],
    }, [{ name: 'back-mesh' }])).toThrow('找不到网格 "missing-mesh"');
  });

  it('rejects a piece group without usable island references', () => {
    expect(() => validateModelUvLayout({
      version: 1,
      pieceGroups: [
        { id: 'front', islandRefs: [] },
        { id: 'back', islandRefs: [{ meshName: 'back-mesh' }] },
      ],
    }, [{ name: 'back-mesh' }])).toThrow('front');
  });

  it('rejects an unsupported model with a clear error', () => {
    expect(() => getModelUvLayout({ id: 'unknown', version: '1' }))
      .toThrow('缺少 UV 裁片配置');
  });

  it('links the product model to its registered UV layout', () => {
    expect(jerseyProduct.model.uvExportLayoutId).toBe('chelsea-jersey@1');
    expect(MODEL_UV_LAYOUTS).toHaveProperty(jerseyProduct.model.uvExportLayoutId);
  });
});
