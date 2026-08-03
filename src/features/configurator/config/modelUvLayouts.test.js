import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { APPEARANCE_ZONES } from './appearance.js';
import { jerseyProduct } from './productDefinitions.js';
import { selectGarmentPatternMeshes } from '../scene/modelProjection.js';
import {
  MODEL_UV_LAYOUTS,
  getModelUvLayout,
  validateModelUvLayout,
} from './modelUvLayouts.js';

const garmentMeshesByModel = new Map();

beforeAll(async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ close() {}, height: 1, width: 1 }));
  await Promise.all([
    'chelsea-jersey',
    'fn8788-jersey',
  ].map(async (modelId) => {
    garmentMeshesByModel.set(modelId, await loadModelMeshes(modelId));
  }));
}, 20_000);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('model UV seam layouts', () => {
  it.each([
    { model: { id: 'chelsea-jersey', version: '1' } },
    { model: { id: 'fn8788-jersey', version: '1' } },
  ])('declares the production pattern output orientation for $model.id', ({ model }) => {
    const layout = getModelUvLayout(model);

    expect(layout.version).toBe(2);
    expect(layout.patternOutputTransform).toEqual({ rotation: 180, mirrorX: true });
  });

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
        { rotation: 180, mirrorX: true },
        { rotation: 180, mirrorX: true },
      ]);
  });

  it.each([
    {
      model: { id: 'chelsea-jersey', version: '1' },
      expectedGroups: {
        body: ['Cloth_mesh_7', 'Cloth_mesh_4'],
        sleeves: [
          'Cloth_mesh', 'Cloth_mesh_1', 'Cloth_mesh_2', 'Cloth_mesh_13',
          'Cloth_mesh_14', 'Cloth_mesh_15',
        ],
        shoulderSide: [
          'Cloth_mesh_3', 'Cloth_mesh_5', 'Cloth_mesh_6',
          'Cloth_mesh_10', 'Cloth_mesh_11', 'Cloth_mesh_12',
        ],
        collar: [
          'Cloth_mesh_8', 'Cloth_mesh_9', 'Cloth_mesh_16', 'Cloth_mesh_17', 'Cloth_mesh_18',
        ],
      },
    },
    {
      model: { id: 'fn8788-jersey', version: '1' },
      expectedGroups: {
        body: ['Cloth_mesh_1', 'Cloth_mesh_5'],
        sleeves: [
          'Cloth_mesh', 'Cloth_mesh_2', 'Cloth_mesh_3', 'Cloth_mesh_9',
          'Cloth_mesh_10', 'Cloth_mesh_11',
        ],
        shoulderSide: [
          'Cloth_mesh_4', 'Cloth_mesh_6', 'Cloth_mesh_7',
          'Cloth_mesh_12', 'Cloth_mesh_13', 'Cloth_mesh_14',
        ],
        collar: ['Cloth_mesh_8', 'Cloth_mesh_15'],
      },
    },
  ])('covers every real garment mesh exactly once for $model.id appearance rendering', ({
    expectedGroups,
    model,
  }) => {
    const layout = getModelUvLayout(model);
    const meshes = selectGarmentPatternMeshes(garmentMeshesByModel.get(model.id));
    const configuredNames = layout.appearanceGroups.flatMap(({ islandRefs }) => (
      islandRefs.map(({ meshName }) => meshName)
    ));

    expect(layout.appearanceGroups.map(({ id, zone }) => ({ id, zone }))).toEqual([
      { id: 'body', zone: 'body' },
      { id: 'sleeves', zone: 'sleeves' },
      { id: 'shoulderSide', zone: 'shoulderSide' },
      { id: 'collar', zone: 'collar' },
    ]);
    expect(Object.fromEntries(layout.appearanceGroups.map(({ id, islandRefs }) => [
      id,
      islandRefs.map(({ meshName }) => meshName),
    ]))).toEqual(expectedGroups);
    expect(configuredNames).toHaveLength(new Set(configuredNames).size);
    expect(configuredNames.toSorted()).toEqual(meshes.map(({ name }) => name).toSorted());
    expect(validateModelUvLayout(layout, meshes)).toBe(true);
    expect(layout.pieceGroups.map(({ id }) => id)).toEqual(['front', 'back']);
  });

  it.each([
    {
      model: { id: 'chelsea-jersey', version: '1' },
      evidence: [
        { id: 'front', material: /^zheng mian_/, normalZ: 1 },
        { id: 'back', material: /^hou mian_/, normalZ: -1 },
      ],
    },
    {
      model: { id: 'fn8788-jersey', version: '1' },
      evidence: [
        { id: 'front', material: /^X D_/, normalZ: 1 },
        { id: 'back', material: /^X D_/, normalZ: -1 },
      ],
    },
  ])('validates $model.id layout against its real GLB meshes', ({ model, evidence }) => {
    const layout = getModelUvLayout(model);
    const meshes = garmentMeshesByModel.get(model.id);

    expect(validateModelUvLayout(layout, meshes)).toBe(true);
    for (const expected of evidence) {
      const group = layout.pieceGroups.find(({ id }) => id === expected.id);
      const mesh = meshes.find(({ name }) => name === group.islandRefs[0].meshName);
      const normalZ = getAverageWorldNormalZ(mesh);

      // Chelsea material labels expose front/back directly. FN8788 uses a generic
      // material, so its fixed mesh references are cross-checked by outward normal.
      expect(mesh.material.name).toMatch(expected.material);
      expect(mesh.geometry.getAttribute('uv')).toBeDefined();
      expect(Math.sign(normalZ)).toBe(expected.normalZ);
      expect(Math.abs(normalZ)).toBeGreaterThan(0.5);
    }
  });

  it('freezes the model layout registry and registered layouts', () => {
    expect(Object.isFrozen(MODEL_UV_LAYOUTS)).toBe(true);
    for (const layout of Object.values(MODEL_UV_LAYOUTS)) {
      expect(Object.isFrozen(layout)).toBe(true);
      expect(Object.isFrozen(layout.patternOutputTransform)).toBe(true);
      expect(Object.isFrozen(layout.pieceGroups)).toBe(true);
      for (const group of layout.pieceGroups) {
        expect(Object.isFrozen(group)).toBe(true);
        expect(Object.isFrozen(group.islandRefs)).toBe(true);
        expect(group.islandRefs.every(Object.isFrozen)).toBe(true);
      }
      expect(Object.isFrozen(layout.appearanceGroups)).toBe(true);
      for (const group of layout.appearanceGroups) {
        expect(Object.isFrozen(group)).toBe(true);
        expect(Object.isFrozen(group.islandRefs)).toBe(true);
        expect(group.islandRefs.every(Object.isFrozen)).toBe(true);
      }
    }
  });

  it('rejects a layout without the two-piece minimum', () => {
    const layout = createValidLayout();
    layout.pieceGroups.pop();

    expect(() => validateModelUvLayout(layout, VALID_MESHES)).toThrow('正片和背片');
  });

  it('rejects an island reference to a missing mesh', () => {
    const layout = createValidLayout();
    layout.pieceGroups[0].islandRefs[0].meshName = 'missing-mesh';

    expect(() => validateModelUvLayout(layout, VALID_MESHES))
      .toThrow('找不到网格 "missing-mesh"');
  });

  it.each([
    ['omitted mesh', (layout) => layout.appearanceGroups.pop(), '未覆盖'],
    ['duplicate mesh', (layout) => {
      layout.appearanceGroups[1].islandRefs[0].meshName = 'front-mesh';
    }, '重复引用'],
    ['duplicate mesh in one group', (layout) => {
      layout.appearanceGroups[0].islandRefs.push({ meshName: 'front-mesh' });
    }, '重复引用'],
    ['unknown mesh', (layout) => {
      layout.appearanceGroups[1].islandRefs[0].meshName = 'missing-mesh';
    }, '找不到网格 "missing-mesh"'],
  ])('fails closed for appearance group mesh mapping: %s', (_label, mutate, message) => {
    const layout = createAppearanceLayout();
    mutate(layout);

    expect(() => validateModelUvLayout(layout, VALID_MESHES)).toThrow(message);
  });

  it.each([
    ['appearanceGroups 为空', (layout) => { layout.appearanceGroups = []; }, '外观组'],
    ['id 为空', (layout) => { layout.appearanceGroups[0].id = ' '; }, 'id'],
    ['id 重复', (layout) => { layout.appearanceGroups[1].id = 'body'; }, 'id'],
    ['zone 未知', (layout) => { layout.appearanceGroups[0].zone = 'unknown'; }, 'zone'],
    ['order 重复', (layout) => { layout.appearanceGroups[1].order = 0; }, 'order'],
    ['islandRefs 为空', (layout) => { layout.appearanceGroups[0].islandRefs = []; }, 'islandRefs'],
    ['meshName 为空', (layout) => {
      layout.appearanceGroups[0].islandRefs[0].meshName = ' ';
    }, 'meshName'],
  ])('拒绝无效外观组配置：%s', (_label, mutate, message) => {
    const layout = createAppearanceLayout();
    mutate(layout);

    expect(() => validateModelUvLayout(layout, VALID_MESHES)).toThrow(message);
  });

  it('rejects a piece group without usable island references', () => {
    const layout = createValidLayout();
    layout.pieceGroups[0].islandRefs = [];

    expect(() => validateModelUvLayout(layout, VALID_MESHES)).toThrow('front');
  });

  it.each([
    ['patternOutputTransform is null', (layout) => { layout.patternOutputTransform = null; }, 'patternOutputTransform'],
    ['patternOutputTransform rotation is not a right angle', (layout) => {
      layout.patternOutputTransform = { rotation: 45, mirrorX: true };
    }, 'rotation'],
    ['patternOutputTransform mirrorX is not boolean', (layout) => {
      layout.patternOutputTransform = { rotation: 180, mirrorX: 'true' };
    }, 'mirrorX'],
  ])('rejects an invalid pattern output transform: %s', (_label, mutate, message) => {
    const layout = createValidLayout();
    mutate(layout);

    expect(() => validateModelUvLayout(layout, VALID_MESHES)).toThrow(message);
  });

  it('accepts legacy layouts that omit patternOutputTransform', () => {
    expect(validateModelUvLayout(createValidLayout(), VALID_MESHES)).toBe(true);
  });

  it.each([
    ['layout 为 null', null, '配置'],
    ['version 为零', { ...createValidLayout(), version: 0 }, '版本'],
    ['version 为字符串', { ...createValidLayout(), version: '1' }, '版本'],
    ['version 为小数', { ...createValidLayout(), version: 1.5 }, '版本'],
    ['pieceGroups 为空', { ...createValidLayout(), pieceGroups: [] }, '裁片组'],
    ['pieceGroups 不是数组', { ...createValidLayout(), pieceGroups: {} }, '裁片组'],
    ['group 为 null', { ...createValidLayout(), pieceGroups: [null] }, '裁片组'],
    ['group 为数组', { ...createValidLayout(), pieceGroups: [[]] }, '裁片组'],
    ['id 为空白', withGroup({ id: '  ' }), 'id'],
    ['label 为空', withGroup({ label: '' }), 'label'],
    ['zone 为空', withGroup({ zone: '' }), 'zone'],
    ['zone 未知', withGroup({ zone: 'unknown-zone' }), 'zone'],
    ['order 为负数', withGroup({ order: -1 }), 'order'],
    ['order 为小数', withGroup({ order: 0.5 }), 'order'],
    ['rotation 为非有限数', withGroup({ rotation: Number.POSITIVE_INFINITY }), 'rotation'],
    ['rotation 不是直角', withGroup({ rotation: 45 }), 'rotation'],
    ['mirrorX 不是 boolean', withGroup({ mirrorX: 'false' }), 'mirrorX'],
    ['islandRefs 为 null', withGroup({ islandRefs: null }), 'islandRefs'],
    ['island 为 null', withGroup({ islandRefs: [null] }), 'UV 岛'],
    ['island 为数组', withGroup({ islandRefs: [[]] }), 'UV 岛'],
    ['meshName 为空白', withGroup({ islandRefs: [{ meshName: '  ' }] }), 'meshName'],
  ])('拒绝无效配置：%s', (name, layout, message) => {
    expect(() => validateModelUvLayout(layout, VALID_MESHES)).toThrow(message);
  });

  it('rejects duplicate group ids', () => {
    const layout = createValidLayout();
    layout.pieceGroups[1].id = 'front';

    expect(() => validateModelUvLayout(layout, VALID_MESHES)).toThrow('id');
  });

  it('rejects duplicate group orders', () => {
    const layout = createValidLayout();
    layout.pieceGroups[1].order = 0;

    expect(() => validateModelUvLayout(layout, VALID_MESHES)).toThrow('order');
  });

  it.each(APPEARANCE_ZONES)('accepts the existing appearance zone %s', (zone) => {
    expect(validateModelUvLayout(withGroup({ zone }), VALID_MESHES)).toBe(true);
  });

  it.each([
    ['meshes 为 null', null, '网格列表'],
    ['meshes 为对象', {}, '网格列表'],
    ['mesh 为 null', [null], '网格项'],
    ['mesh 缺少 name', [{}], '网格项'],
  ])('拒绝无效网格输入：%s', (name, meshes, message) => {
    expect(() => validateModelUvLayout(createValidLayout(), meshes)).toThrow(message);
  });

  it('rejects an unsupported model with a clear error', () => {
    expect(() => getModelUvLayout({ id: 'unknown', version: '1' }))
      .toThrow('缺少 UV 裁片配置');
  });

  it('links the product model to its registered UV layout', () => {
    expect(jerseyProduct.model.uvExportLayoutId)
      .toBe(`${jerseyProduct.model.id}@${jerseyProduct.model.version}`);
    expect(MODEL_UV_LAYOUTS).toHaveProperty(jerseyProduct.model.uvExportLayoutId);
    expect(jerseyProduct.model.uvExportVersion).toBe('2');
  });
});

const VALID_MESHES = [{ name: 'front-mesh' }, { name: 'back-mesh' }];

function createValidLayout() {
  return {
    version: 1,
    pieceGroups: [
      createGroup({ id: 'front', label: '正片', order: 0, meshName: 'front-mesh' }),
      createGroup({ id: 'back', label: '背片', order: 1, meshName: 'back-mesh' }),
    ],
  };
}

function createGroup({ id, label, order, meshName }) {
  return {
    id,
    label,
    order,
    zone: 'body',
    rotation: 0,
    mirrorX: false,
    islandRefs: [{ meshName }],
  };
}

function createAppearanceGroup({ id, order, meshNames }) {
  return {
    id,
    order,
    zone: id,
    islandRefs: meshNames.map((meshName) => ({ meshName })),
  };
}

function createAppearanceLayout() {
  return {
    ...createValidLayout(),
    appearanceGroups: [
      createAppearanceGroup({ id: 'body', order: 0, meshNames: ['front-mesh'] }),
      createAppearanceGroup({ id: 'sleeves', order: 1, meshNames: ['back-mesh'] }),
    ],
  };
}

function withGroup(overrides) {
  const layout = createValidLayout();
  Object.assign(layout.pieceGroups[0], overrides);
  return layout;
}

async function loadModelMeshes(modelId) {
  const data = readFileSync(resolvePath(process.cwd(), `public/models/${modelId}.glb`));
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  return meshes;
}

function getAverageWorldNormalZ(mesh) {
  const normal = mesh.geometry.getAttribute('normal');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const average = new THREE.Vector3();
  for (let index = 0; index < normal.count; index += 1) {
    average.add(new THREE.Vector3(
      normal.getX(index),
      normal.getY(index),
      normal.getZ(index),
    ).applyMatrix3(normalMatrix).normalize());
  }
  return average.divideScalar(normal.count).z;
}
