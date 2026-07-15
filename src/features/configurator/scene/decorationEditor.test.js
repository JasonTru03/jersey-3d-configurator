import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DecorationEditor,
  createDecalSurface,
  createRegionSurface,
  getDefaultDecorationPlacement,
  getRegionAnchor,
  getRegionFrame,
  resolveDecorationAsset,
  toRegionPosition,
  toRegionTransform,
  toSpriteTransform,
} from './decorationEditor.js';

describe('decoration editor geometry', () => {
  it('updates an empty decoration collection without invoking removed camera-facing behavior', () => {
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
    });

    expect(() => editor.update([], null, [])).not.toThrow();

    editor.dispose();
  });

  it('clamps a sprite transform to the editable range', () => {
    expect(toSpriteTransform({ x: 9, y: -9, scale: 9, rotation: 300 })).toEqual({
      x: 1,
      y: -1,
      scale: 2.4,
      rotation: 180,
    });
  });

  it('provides distinct anchors for the four named jersey regions', () => {
    expect(getRegionAnchor('front')).not.toEqual(getRegionAnchor('back'));
    expect(getRegionAnchor('left-sleeve')).not.toEqual(getRegionAnchor('right-sleeve'));
  });

  it('maps back coordinates onto the back surface and restores their local transform', () => {
    const frame = getRegionFrame('back');
    const position = toRegionPosition('back', { x: 0.5, y: -0.25 });

    expect(frame.normal.z).toBe(-1);
    expect(position.z).toBeLessThan(frame.anchor.z);
    expect(toRegionTransform('back', position)).toMatchObject({ x: 0.5, y: -0.25 });
  });

  it('maps sleeve coordinates through a reversible local frame', () => {
    const position = toRegionPosition('right-sleeve', { x: -0.4, y: 0.35 });

    expect(toRegionTransform('right-sleeve', position)).toEqual({ x: -0.4, y: 0.35 });
  });

  it('resolves a pattern preset to its renderable asset instead of its source id', () => {
    const assetUrl = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E';

    expect(resolveDecorationAsset(
      { kind: 'pattern', source: 'golden-stripe' },
      [{ source: 'golden-stripe', assetUrl }],
    )).toBe(assetUrl);
  });

  it('creates artwork surfaces that participate in garment depth occlusion', () => {
    const surface = createRegionSurface(new THREE.Texture());

    expect(surface.isMesh).toBe(true);
    expect(surface.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(surface.material.depthTest).toBe(true);
    expect(surface.material.depthWrite).toBe(false);
  });

  it('derives a front artwork placement from the loaded garment mesh', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);

    expect(getDefaultDecorationPlacement([mesh], 'front')).toMatchObject({
      region: 'front',
      position: { x: 0, y: 0, z: 1 },
      normal: { x: 0, y: 0, z: 1 },
    });
  });

  it('creates a depth-tested polygon-offset decal on a garment mesh', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const surface = createDecalSurface(
      new THREE.Texture(),
      mesh,
      {
        region: 'front',
        position: { x: 0, y: 0, z: 1 },
        normal: { x: 0, y: 0, z: 1 },
      },
      { scale: 1, rotation: 0 },
    );

    expect(surface).toBeInstanceOf(THREE.Mesh);
    expect(surface.material.depthTest).toBe(true);
    expect(surface.material.depthWrite).toBe(false);
    expect(surface.material.polygonOffset).toBe(true);
  });
});
