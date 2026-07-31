import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGarmentAppearanceCanvas, renderGarmentAppearance } from './garmentAppearanceTexture.js';

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

function createUvMesh(name, uvs, indices = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (indices) geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = name;
  return mesh;
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
});
