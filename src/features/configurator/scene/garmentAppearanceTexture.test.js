import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getModelUvLayout } from '../config/modelUvLayouts.js';
import * as appearanceTextureModule from './garmentAppearanceTexture.js';
import {
  createGarmentAppearanceCanvas,
  renderGarmentAppearance,
  renderModelUvAppearance,
} from './garmentAppearanceTexture.js';
import { collectRenderableUvTriangles } from './renderableUvTriangles.js';
import { collectPieceAtlasTriangles } from './uvPatternPieces.js';

const appearance = {
  template: 'solid',
  colors: {
    body: '#F7F5EF',
    sleeves: '#1F5B4F',
    shoulderSide: '#20242A',
    collar: '#D1B05D',
    pattern: '#C84F3D',
    number: '#20242A',
  },
};
const garmentMeshesByModel = new Map();

beforeAll(async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ close() {}, height: 1, width: 1 }));
  await Promise.all(['chelsea-jersey', 'fn8788-jersey'].map(async (modelId) => {
    garmentMeshesByModel.set(modelId, await loadModelMeshes(modelId));
  }));
}, 20_000);

afterAll(() => {
  vi.unstubAllGlobals();
});

function createRecordingContext() {
  const calls = [];
  return {
    calls,
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    closePath: () => calls.push(['closePath']),
    clip: () => calls.push(['clip']),
    fill: () => calls.push(['fill']),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    createLinearGradient: (...args) => ({
      addColorStop: (...stop) => calls.push(['addColorStop', ...args, ...stop]),
    }),
    set fillStyle(value) { calls.push(['fillStyle', value]); },
  };
}

function createUvMesh(name, uvs, indices = null, options = {}) {
  const geometry = new THREE.BufferGeometry();
  const vertexCount = options.positionCount
    ?? options.uvAttribute?.count
    ?? Math.floor(uvs.length / 2);
  const positions = options.positions ?? Array.from(
    { length: vertexCount * 3 },
    (_, index) => (index % 3 === 0 ? index / 3 : 0),
  );
  if (!options.withoutPosition) {
    geometry.setAttribute('position', options.positionAttribute
      ?? new THREE.Float32BufferAttribute(positions, options.positionItemSize ?? 3));
  }
  if (!options.withoutUv) {
    geometry.setAttribute('uv', options.uvAttribute
      ?? new THREE.Float32BufferAttribute(uvs, options.uvItemSize ?? 2));
  }
  if (indices !== null) geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, options.material ?? new THREE.MeshBasicMaterial());
  mesh.name = name;
  return mesh;
}

function renderSingleConfiguredMesh(mesh, context = createRecordingContext()) {
  renderModelUvAppearance(context, { width: 100, height: 100 }, appearance, {
    modelMeshes: [mesh],
    uvLayout: {
      version: 1,
      pieceGroups: [
        { id: 'front', zone: 'body', order: 0, islandRefs: [{ meshName: mesh.name }] },
      ],
    },
  });
  return context;
}

function createSingleMeshLayout(meshName = 'front-mesh') {
  return {
    version: 1,
    pieceGroups: [
      { id: 'front', zone: 'body', order: 0, islandRefs: [{ meshName }] },
    ],
  };
}

function createNoopContext() {
  return {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {},
    fillRect() {},
    set fillStyle(_) {},
  };
}

describe('garment appearance texture', () => {
  it('paints clipped atlas regions at the requested size', () => {
    const context = createRecordingContext();

    renderGarmentAppearance(context, { width: 2048, height: 2048 }, appearance);

    expect(context.calls).toContainEqual(['fillRect', 0, 0, 2048, 2048]);
    expect(context.calls.some(([name]) => name === 'clip')).toBe(true);
  });

  it('keeps the 2048 atlas anchors stable for body, sleeves, panels, and collar', () => {
    const context = createRecordingContext();

    renderGarmentAppearance(context, { width: 2048, height: 2048 }, appearance);

    expect(context.calls).toContainEqual(['moveTo', 61.44, 102.4]);
    expect(context.calls).toContainEqual(['moveTo', 757.76, 102.4]);
    expect(context.calls).toContainEqual(['moveTo', 1413.12, 163.84]);
    expect(context.calls).toContainEqual(['moveTo', 491.52, 102.4]);
    expect(context.calls).toContainEqual(['moveTo', 245.76, 0]);
  });

  it.each(['solid', 'vertical-stripes', 'horizontal-stripes', 'diagonal', 'gradient', 'color-block'])(
    'renders the %s template through the body and pattern colors',
    (template) => {
      const context = createRecordingContext();

      renderGarmentAppearance(context, { width: 1024, height: 1024 }, { ...appearance, template });

      expect(context.calls.some(([name]) => name === 'clip')).toBe(true);
      expect(context.calls.some(([name]) => name === 'fillStyle')).toBe(true);
    },
  );

  it('rejects empty texture dimensions', () => {
    expect(() => renderGarmentAppearance(createRecordingContext(), { width: 0, height: 2048 }, appearance))
      .toThrow('Appearance texture requires a positive width and height.');
  });

  it('creates a 2048 square canvas by default', () => {
    const context = createRecordingContext();
    HTMLCanvasElement.prototype.getContext = () => context;
    const canvas = createGarmentAppearanceCanvas(undefined, appearance);

    expect(canvas.width).toBe(2048);
    expect(canvas.height).toBe(2048);
    expect(context.calls).toContainEqual(['fillStyle', '#F7F5EF']);
  });

  it('clips configured garment UV triangles instead of legacy atlas regions', () => {
    const context = createRecordingContext();
    HTMLCanvasElement.prototype.getContext = () => context;
    const front = createUvMesh('front-mesh', [
      0.125, 0.25,
      0.5, 0.25,
      0.125, 0.5,
    ], [0, 1, 2]);
    const back = createUvMesh('back-mesh', [
      0.625, 0.125,
      0.875, 0.125,
      0.875, 0.5,
    ]);
    const ignored = createUvMesh('ignored-mesh', [
      0, 0,
      0.25, 0,
      0, 0.25,
    ]);
    const uvLayout = {
      version: 7,
      pieceGroups: [
        { id: 'front', zone: 'body', order: 0, islandRefs: [{ meshName: 'front-mesh' }] },
        { id: 'back', zone: 'body', order: 1, islandRefs: [{ meshName: 'back-mesh' }] },
      ],
    };

    createGarmentAppearanceCanvas(100, appearance, {
      modelMeshes: [front, back, ignored],
      uvLayout,
    });

    expect(context.calls.filter(([name]) => name === 'clip')).toHaveLength(2);
    expect(context.calls.filter(([name]) => name === 'save')).toHaveLength(2);
    expect(context.calls.filter(([name]) => name === 'restore')).toHaveLength(2);
    expect(context.calls).toContainEqual(['moveTo', 12.5, 75]);
    expect(context.calls).toContainEqual(['lineTo', 50, 75]);
    expect(context.calls).toContainEqual(['lineTo', 12.5, 50]);
    expect(context.calls).toContainEqual(['moveTo', 62.5, 87.5]);
    expect(context.calls).not.toContainEqual(['moveTo', 0, 100]);
    expect(context.calls).not.toContainEqual(['fillRect', 0, 0, 100, 100]);
  });

  it('renders every appearance group instead of limiting the texture to factory piece groups', () => {
    const context = createRecordingContext();
    const front = createUvMesh('front-mesh', [0, 0, 0.2, 0, 0, 0.2]);
    const back = createUvMesh('back-mesh', [0.3, 0, 0.5, 0, 0.3, 0.2]);
    const sleeve = createUvMesh('sleeve-mesh', [0.6, 0, 0.8, 0, 0.6, 0.2]);
    const uvLayout = {
      version: 1,
      pieceGroups: [
        createLayoutGroup('front', 'body', 0, ['front-mesh'], {
          label: '正片', mirrorX: false, rotation: 0,
        }),
        createLayoutGroup('back', 'body', 1, ['back-mesh'], {
          label: '背片', mirrorX: false, rotation: 0,
        }),
      ],
      appearanceGroups: [
        createLayoutGroup('body', 'body', 0, ['front-mesh', 'back-mesh']),
        createLayoutGroup('sleeves', 'sleeves', 1, ['sleeve-mesh']),
      ],
    };

    renderModelUvAppearance(context, { width: 100, height: 100 }, appearance, {
      modelMeshes: [front, back, sleeve],
      uvLayout,
    });

    expect(readRecordedTriangles(context.calls)).toHaveLength(3);
    const sleeveMove = context.calls.find(([method, x]) => method === 'moveTo' && x > 50);
    expect(sleeveMove[1]).toBeCloseTo(60);
    expect(sleeveMove[2]).toBeCloseTo(100);
    expect(context.calls).toContainEqual(['fillStyle', appearance.colors.sleeves]);
  });

  it('consumes the same fake-mesh triangle coordinates in appearance and pattern pieces', () => {
    const mesh = createUvMesh('front-mesh', [
      0.125, 0.25,
      0.5, 0.25,
      0.125, 0.5,
      0.625, 0.125,
      0.875, 0.125,
      0.625, 0.375,
    ], [0, 1, 2, 3, 4, 5]);
    const context = renderSingleConfiguredMesh(mesh);
    const shared = collectRenderableUvTriangles(mesh);
    const pieceTriangles = collectPieceAtlasTriangles(mesh, 100);

    expect(readRecordedTriangles(context.calls)).toEqual(pieceTriangles);
    expect(pieceTriangles).toHaveLength(shared.triangleCount);
  });

  it('rejects a configured garment UV group without mapped triangles', () => {
    const context = createRecordingContext();
    HTMLCanvasElement.prototype.getContext = () => context;
    const emptyMesh = createUvMesh('empty-front', [0.25, 0.25, 0.5, 0.5]);
    const back = createUvMesh('back-mesh', [0.5, 0.5, 0.75, 0.5, 0.75, 0.75]);
    const uvLayout = {
      version: 1,
      pieceGroups: [
        { id: 'front', zone: 'body', order: 0, islandRefs: [{ meshName: 'empty-front' }] },
        { id: 'back', zone: 'body', order: 1, islandRefs: [{ meshName: 'back-mesh' }] },
      ],
    };

    expect(() => createGarmentAppearanceCanvas(100, appearance, {
      modelMeshes: [emptyMesh, back],
      uvLayout,
    })).toThrow('模型 UV 裁片组 "front" 没有可绘制的 UV 三角形。');
  });

  it('limits non-indexed triangles to the geometry position count and drawRange', () => {
    const mesh = createUvMesh('front-mesh', [
      0, 0, 0.25, 0, 0, 0.25,
      0.5, 0.5, 0.75, 0.5, 0.5, 0.75,
      0.9, 0.9,
    ], null, { positionCount: 6 });
    mesh.geometry.setDrawRange(3, 4);

    const context = renderSingleConfiguredMesh(mesh);
    const moves = context.calls.filter(([name]) => name === 'moveTo');

    expect(moves).toEqual([['moveTo', 50, 50]]);
  });

  it('allows non-indexed drawRange spans covered by a shorter UV attribute', () => {
    const mesh = createUvMesh('front-mesh', [
      0, 0, 1, 0, 0, 1,
    ], null, { positionCount: 6 });
    mesh.geometry.setDrawRange(0, 3);

    const context = renderSingleConfiguredMesh(mesh);

    expect(context.calls.filter(([name]) => name === 'moveTo')).toEqual([
      ['moveTo', 0, 100],
    ]);
  });

  it('allows indexed drawRange spans whose referenced vertices are covered by UVs', () => {
    const mesh = createUvMesh('front-mesh', [
      0, 0, 1, 0, 0, 1,
    ], [0, 1, 2, 3, 4, 5], { positionCount: 6 });
    mesh.geometry.setDrawRange(0, 3);

    const context = renderSingleConfiguredMesh(mesh);

    expect(context.calls.filter(([name]) => name === 'moveTo')).toEqual([
      ['moveTo', 0, 100],
    ]);
  });

  it('rejects a rendered indexed triangle that references beyond the UV attribute', () => {
    const mesh = createUvMesh('front-mesh', [
      0, 0, 1, 0, 0, 1,
    ], [0, 1, 2, 3, 4, 5], { positionCount: 6 });

    expect(() => renderSingleConfiguredMesh(mesh)).toThrow(
      '模型 UV 网格 "front-mesh" 的已绘制三角形引用了 UV 属性范围外的顶点。',
    );
  });

  it('rejects a rendered non-indexed triangle that extends beyond the UV attribute', () => {
    const mesh = createUvMesh('front-mesh', [
      0, 0, 1, 0, 0, 1,
    ], null, { positionCount: 6 });

    expect(() => renderSingleConfiguredMesh(mesh)).toThrow(
      '模型 UV 网格 "front-mesh" 的已绘制三角形引用了 UV 属性范围外的顶点。',
    );
  });

  it('intersects drawRange with valid groups for material-array meshes and de-duplicates overlaps', () => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = createUvMesh('front-mesh', [
      0, 0, 0.25, 0, 0, 0.25,
      0.5, 0.5, 0.75, 0.5, 0.5, 0.75,
      0.75, 0.75, 1, 0.75, 0.75, 1,
    ], null, { material: [material] });
    mesh.geometry.setDrawRange(3, 6);
    mesh.geometry.addGroup(3, 6, 0);
    mesh.geometry.addGroup(6, 3, 0);
    mesh.geometry.addGroup(0, 3, 5);

    const context = renderSingleConfiguredMesh(mesh);

    expect(context.calls.filter(([name]) => name === 'moveTo')).toEqual([
      ['moveTo', 50, 50],
      ['moveTo', 75, 25],
    ]);
  });

  it('preserves independent triangle phases for overlapping material groups', () => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = createUvMesh('front-mesh', [
      0, 0,
      0.2, 0,
      0, 0.2,
      0.5, 0.5,
      0.8, 0.5,
      0.5, 0.8,
    ], null, { material: [material] });
    mesh.geometry.addGroup(0, 4, 0);
    mesh.geometry.addGroup(2, 4, 0);

    const context = renderSingleConfiguredMesh(mesh);
    const moves = context.calls.filter(([name]) => name === 'moveTo');

    expect(moves).toHaveLength(2);
    expect(moves[0]).toEqual(['moveTo', 0, 100]);
    expect(moves[1][1]).toBeCloseTo(0);
    expect(moves[1][2]).toBeCloseTo(80);
  });

  it('does not paint the same triangle twice for overlapping material groups', () => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = createUvMesh('front-mesh', [
      0, 0, 1, 0, 0, 1,
    ], null, { material: [material] });
    mesh.geometry.addGroup(0, 3, 0);
    mesh.geometry.addGroup(0, 3, 0);

    const context = renderSingleConfiguredMesh(mesh);

    expect(context.calls.filter(([name]) => name === 'moveTo')).toEqual([
      ['moveTo', 0, 100],
    ]);
  });

  it('invalidates cached triangles when a single material becomes invisible', () => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = createUvMesh('front-mesh', [
      0, 0, 1, 0, 0, 1,
    ], null, { material });

    renderSingleConfiguredMesh(mesh);
    material.visible = false;

    expect(() => renderSingleConfiguredMesh(mesh))
      .toThrow('模型 UV 裁片组 "front" 没有可绘制的 UV 三角形。');
  });

  it('draws only visible material-array groups after visibility changes', () => {
    const firstMaterial = new THREE.MeshBasicMaterial();
    const secondMaterial = new THREE.MeshBasicMaterial();
    const mesh = createUvMesh('front-mesh', [
      0, 0, 0.25, 0, 0, 0.25,
      0.5, 0.5, 0.75, 0.5, 0.5, 0.75,
    ], null, { material: [firstMaterial, secondMaterial] });
    mesh.geometry.addGroup(0, 3, 0);
    mesh.geometry.addGroup(3, 3, 1);

    renderSingleConfiguredMesh(mesh);
    firstMaterial.visible = false;
    const context = renderSingleConfiguredMesh(mesh);

    expect(context.calls.filter(([name]) => name === 'moveTo')).toEqual([
      ['moveTo', 50, 50],
    ]);
  });

  it('ignores geometry groups for a single-material mesh', () => {
    const mesh = createUvMesh('front-mesh', [
      0, 0, 0.25, 0, 0, 0.25,
      0.5, 0.5, 0.75, 0.5, 0.5, 0.75,
    ]);
    mesh.geometry.addGroup(3, 3, 0);

    const context = renderSingleConfiguredMesh(mesh);

    expect(context.calls.filter(([name]) => name === 'moveTo')).toEqual([
      ['moveTo', 0, 100],
      ['moveTo', 50, 50],
    ]);
  });

  it('reads normalized UV buffer attributes through BufferAttribute accessors', () => {
    const normalizedUvs = new THREE.Uint16BufferAttribute([
      0, 0,
      65535, 0,
      0, 65535,
    ], 2, true);
    const mesh = createUvMesh('front-mesh', [], [0, 1, 2], { uvAttribute: normalizedUvs });

    const context = renderSingleConfiguredMesh(mesh);

    expect(context.calls).toContainEqual(['lineTo', 100, 100]);
    expect(context.calls).toContainEqual(['lineTo', 0, 0]);
  });

  it.each([
    ['missing position', () => createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], null, { withoutPosition: true })],
    ['missing uv', () => createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], null, { withoutUv: true })],
    ['short position itemSize', () => createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], null, { positionItemSize: 2 })],
    ['short uv itemSize', () => createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], null, { uvItemSize: 1 })],
    ['out-of-range index', () => createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], [0, 1, 4])],
    ['negative index', () => createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], new THREE.BufferAttribute(new Float32Array([0, 1, -1]), 1))],
    ['fractional index', () => createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], new THREE.BufferAttribute(new Float32Array([0, 1, 1.5]), 1))],
    ['non-finite index', () => createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], new THREE.BufferAttribute(new Float32Array([0, 1, Number.NaN]), 1))],
    ['non-finite uv', () => createUvMesh('front-mesh', [0, 0, 1, 0, Number.NaN, 1])],
    ['degenerate uv', () => createUvMesh('front-mesh', [0, 0, 0.5, 0.5, 1, 1])],
    ['near-degenerate uv', () => createUvMesh('front-mesh', [0, 0, 1, 0, 1, Number.EPSILON])],
    ['material array without groups', () => createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], null, { material: [new THREE.MeshBasicMaterial()] })],
  ])('rejects %s geometry when no valid configured UV triangle remains', (_label, createMesh) => {
    expect(() => renderSingleConfiguredMesh(createMesh()))
      .toThrow('模型 UV 裁片组 "front" 没有可绘制的 UV 三角形。');
  });

  it('rejects a referenced mesh name that is not unique in the model', () => {
    const first = createUvMesh('shared-mesh', [0, 0, 1, 0, 0, 1]);
    const second = createUvMesh('shared-mesh', [0.5, 0.5, 1, 0.5, 0.5, 1]);
    const uvLayout = {
      version: 1,
      pieceGroups: [
        { id: 'front', zone: 'body', order: 0, islandRefs: [{ meshName: 'shared-mesh' }] },
      ],
    };

    expect(() => renderModelUvAppearance(
      createRecordingContext(),
      { width: 100, height: 100 },
      appearance,
      { modelMeshes: [first, second], uvLayout },
    )).toThrow('模型 UV 网格名称 "shared-mesh" 不唯一。');
  });

  it('rejects duplicate mesh references within one configured group', () => {
    const mesh = createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1]);
    const uvLayout = {
      version: 1,
      pieceGroups: [{
        id: 'front',
        zone: 'body',
        order: 0,
        islandRefs: [{ meshName: 'front-mesh' }, { meshName: 'front-mesh' }],
      }],
    };

    expect(() => renderModelUvAppearance(
      createRecordingContext(),
      { width: 100, height: 100 },
      appearance,
      { modelMeshes: [mesh], uvLayout },
    )).toThrow('模型 UV 裁片组 "front" 重复引用网格 "front-mesh"。');
  });

  it('rejects one mesh referenced by different configured groups', () => {
    const mesh = createUvMesh('shared-mesh', [0, 0, 1, 0, 0, 1]);
    const uvLayout = {
      version: 1,
      pieceGroups: [
        { id: 'front', zone: 'body', order: 0, islandRefs: [{ meshName: 'shared-mesh' }] },
        { id: 'back', zone: 'body', order: 1, islandRefs: [{ meshName: 'shared-mesh' }] },
      ],
    };

    expect(() => renderModelUvAppearance(
      createRecordingContext(),
      { width: 100, height: 100 },
      appearance,
      { modelMeshes: [mesh], uvLayout },
    )).toThrow('模型 UV 网格 "shared-mesh" 被裁片组 "front" 和 "back" 重复引用。');
  });

  it('reuses parsed UV triangles until a BufferAttribute version changes', () => {
    const mesh = createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1], [0, 1, 2]);
    const uv = mesh.geometry.getAttribute('uv');
    const getX = vi.spyOn(uv, 'getX');
    const uvLayout = createSingleMeshLayout();
    const render = () => renderModelUvAppearance(
      createNoopContext(),
      { width: 100, height: 100 },
      appearance,
      { modelMeshes: [mesh], uvLayout },
    );

    render();
    const firstParseCalls = getX.mock.calls.length;
    render();
    expect(getX).toHaveBeenCalledTimes(firstParseCalls);

    uv.needsUpdate = true;
    render();
    expect(getX.mock.calls.length).toBeGreaterThan(firstParseCalls);
    const uvInvalidatedCalls = getX.mock.calls.length;

    mesh.geometry.getAttribute('position').needsUpdate = true;
    render();
    expect(getX.mock.calls.length).toBeGreaterThan(uvInvalidatedCalls);
    const positionInvalidatedCalls = getX.mock.calls.length;

    mesh.geometry.index.needsUpdate = true;
    render();
    expect(getX.mock.calls.length).toBeGreaterThan(positionInvalidatedCalls);
  });

  it('invalidates parsed UV triangles when draw spans or material-array semantics change', () => {
    const firstMaterial = new THREE.MeshBasicMaterial();
    const secondMaterial = new THREE.MeshBasicMaterial();
    const mesh = createUvMesh('front-mesh', [
      0, 0, 0.25, 0, 0, 0.25,
      0.5, 0.5, 0.75, 0.5, 0.5, 0.75,
    ], null, { material: [firstMaterial, secondMaterial] });
    mesh.geometry.addGroup(0, 3, 0);
    mesh.geometry.addGroup(3, 3, 1);
    const uv = mesh.geometry.getAttribute('uv');
    const getX = vi.spyOn(uv, 'getX');
    const uvLayout = createSingleMeshLayout();
    const render = () => renderModelUvAppearance(
      createNoopContext(),
      { width: 100, height: 100 },
      appearance,
      { modelMeshes: [mesh], uvLayout },
    );

    render();
    const initialCalls = getX.mock.calls.length;
    render();
    expect(getX).toHaveBeenCalledTimes(initialCalls);

    mesh.geometry.setDrawRange(3, 3);
    render();
    expect(getX.mock.calls.length).toBeGreaterThan(initialCalls);
    const drawRangeCalls = getX.mock.calls.length;

    mesh.geometry.groups[1].materialIndex = 0;
    render();
    expect(getX.mock.calls.length).toBeGreaterThan(drawRangeCalls);
    const groupsCalls = getX.mock.calls.length;

    mesh.material = firstMaterial;
    render();
    expect(getX.mock.calls.length).toBeGreaterThan(groupsCalls);
  });

  it('caches Path2D per layout geometry signature and output size', () => {
    const OriginalPath2D = globalThis.Path2D;
    const paths = [];
    class RecordingPath2D {
      constructor() { paths.push(this); }
      moveTo() {}
      lineTo() {}
      closePath() {}
    }
    globalThis.Path2D = RecordingPath2D;
    try {
      const mesh = createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1]);
      const uvLayout = createSingleMeshLayout();
      const render = (size) => renderModelUvAppearance(
        createNoopContext(),
        { width: size, height: size },
        appearance,
        { modelMeshes: [mesh], uvLayout },
      );

      render(2048);
      render(2048);
      render(4096);

      expect(paths).toHaveLength(2);
    } finally {
      if (OriginalPath2D === undefined) delete globalThis.Path2D;
      else globalThis.Path2D = OriginalPath2D;
    }
  });

  it('invalidates UV data and Path2D when an interleaved buffer version changes', () => {
    const OriginalPath2D = globalThis.Path2D;
    const paths = [];
    class RecordingPath2D {
      constructor() {
        this.calls = [];
        paths.push(this);
      }
      moveTo(...args) { this.calls.push(['moveTo', ...args]); }
      lineTo(...args) { this.calls.push(['lineTo', ...args]); }
      closePath() { this.calls.push(['closePath']); }
    }
    globalThis.Path2D = RecordingPath2D;
    try {
      const uvBuffer = new THREE.InterleavedBuffer(new Float32Array([
        0, 0,
        1, 0,
        0, 1,
      ]), 2);
      const uvAttribute = new THREE.InterleavedBufferAttribute(uvBuffer, 2, 0);
      const mesh = createUvMesh('front-mesh', [], null, { uvAttribute });
      const uvLayout = createSingleMeshLayout();
      const render = () => renderModelUvAppearance(
        createNoopContext(),
        { width: 100, height: 100 },
        appearance,
        { modelMeshes: [mesh], uvLayout },
      );

      render();
      uvAttribute.setXY(0, 0.25, 0.25);
      uvBuffer.needsUpdate = true;
      render();

      expect(paths).toHaveLength(2);
      expect(paths[1].calls).toContainEqual(['moveTo', 25, 75]);
    } finally {
      if (OriginalPath2D === undefined) delete globalThis.Path2D;
      else globalThis.Path2D = OriginalPath2D;
    }
  });

  it('bounds Path2D cache entries across repeated geometry revisions', () => {
    const OriginalPath2D = globalThis.Path2D;
    const paths = [];
    class RecordingPath2D {
      constructor() { paths.push(this); }
      moveTo() {}
      lineTo() {}
      closePath() {}
    }
    globalThis.Path2D = RecordingPath2D;
    try {
      const mesh = createUvMesh('front-mesh', [0, 0, 1, 0, 0, 1]);
      const uv = mesh.geometry.getAttribute('uv');
      const uvLayout = createSingleMeshLayout();
      const render = (size) => renderModelUvAppearance(
        createNoopContext(),
        { width: size, height: size },
        appearance,
        { modelMeshes: [mesh], uvLayout },
      );

      render(2048);
      render(4096);
      for (let revision = 1; revision <= 8; revision += 1) {
        uv.setXY(0, revision / 100, revision / 100);
        uv.needsUpdate = true;
        render(2048);
      }

      expect(appearanceTextureModule.getGarmentAppearancePathCacheStats)
        .toBeTypeOf('function');
      expect(appearanceTextureModule.getGarmentAppearancePathCacheStats(uvLayout))
        .toEqual({ entries: 2 });
      expect(paths).toHaveLength(10);
    } finally {
      if (OriginalPath2D === undefined) delete globalThis.Path2D;
      else globalThis.Path2D = OriginalPath2D;
    }
  });

  it('does not reparse real Chelsea appearance BufferAttributes on a second render', () => {
    const uvLayout = getModelUvLayout({ id: 'chelsea-jersey', version: '1' });
    const configuredMeshes = getConfiguredMeshes(
      garmentMeshesByModel.get('chelsea-jersey'),
      uvLayout.appearanceGroups,
    );
    const getUvX = configuredMeshes.map((mesh) => vi.spyOn(mesh.geometry.getAttribute('uv'), 'getX'));
    const render = () => renderModelUvAppearance(
      createNoopContext(),
      { width: 64, height: 64 },
      appearance,
      { modelMeshes: configuredMeshes, uvLayout },
    );

    render();
    const firstParseCalls = getUvX.map((spy) => spy.mock.calls.length);
    expect(firstParseCalls.every((count) => count > 0)).toBe(true);

    render();
    expect(getUvX.map((spy) => spy.mock.calls.length)).toEqual(firstParseCalls);
  });

  it.each([
    { model: { id: 'chelsea-jersey', version: '1' } },
    { model: { id: 'fn8788-jersey', version: '1' } },
  ])('renders every real $model.id appearance triangle while factory pieces remain front/back', ({ model }) => {
    const size = 64;
    const uvLayout = getModelUvLayout(model);
    const modelMeshes = garmentMeshesByModel.get(model.id);
    const appearanceMeshes = getConfiguredMeshes(modelMeshes, uvLayout.appearanceGroups);
    const pieceMeshes = getConfiguredMeshes(modelMeshes, uvLayout.pieceGroups);
    const context = createRecordingContext();

    renderModelUvAppearance(context, { width: size, height: size }, appearance, {
      modelMeshes,
      uvLayout,
    });
    const appearanceTriangles = appearanceMeshes
      .flatMap((mesh) => collectPieceAtlasTriangles(mesh, size));
    const appearanceTriangleCount = appearanceMeshes.reduce((count, mesh) => (
      count + collectRenderableUvTriangles(mesh).triangleCount
    ), 0);
    const pieceTriangleCount = pieceMeshes.reduce((count, mesh) => (
      count + collectRenderableUvTriangles(mesh).triangleCount
    ), 0);

    expect(readRecordedTriangles(context.calls)).toEqual(appearanceTriangles);
    expect(appearanceTriangles).toHaveLength(appearanceTriangleCount);
    expect(appearanceTriangleCount).toBeGreaterThan(pieceTriangleCount);
    expect(uvLayout.pieceGroups.map(({ id }) => id)).toEqual(['front', 'back']);
  });
});

function readRecordedTriangles(calls) {
  const triangles = [];
  let triangle = null;
  for (const [method, x, y] of calls) {
    if (method === 'moveTo') triangle = [{ x, y }];
    else if (method === 'lineTo') triangle?.push({ x, y });
    else if (method === 'closePath' && triangle?.length === 3) {
      triangles.push(triangle);
      triangle = null;
    }
  }
  return triangles;
}

function createLayoutGroup(id, zone, order, meshNames, properties = {}) {
  return {
    id,
    zone,
    order,
    islandRefs: meshNames.map((meshName) => ({ meshName })),
    ...properties,
  };
}

function getConfiguredMeshes(modelMeshes, groups) {
  const meshesByName = new Map(modelMeshes.map((mesh) => [mesh.name, mesh]));
  return groups.flatMap(({ islandRefs }) => (
    islandRefs.map(({ meshName }) => meshesByName.get(meshName))
  ));
}

async function loadModelMeshes(modelId) {
  const data = readFileSync(resolvePath(process.cwd(), `public/models/${modelId}.glb`));
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
  const meshes = [];
  gltf.scene.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  return meshes;
}
