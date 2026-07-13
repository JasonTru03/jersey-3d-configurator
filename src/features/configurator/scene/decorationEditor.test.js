import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCameraFacingSurface, getRegionAnchor, resolveDecorationAsset, toSpriteTransform } from './decorationEditor.js';

describe('decoration editor geometry', () => {
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

  it('resolves a pattern preset to its renderable asset instead of its source id', () => {
    const assetUrl = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E';

    expect(resolveDecorationAsset(
      { kind: 'pattern', source: 'golden-stripe' },
      [{ source: 'golden-stripe', assetUrl }],
    )).toBe(assetUrl);
  });

  it('uses a camera-facing mesh surface instead of a sprite for visible artwork', () => {
    const surface = createCameraFacingSurface(new THREE.Texture());

    expect(surface.isMesh).toBe(true);
    expect(surface.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(surface.material.depthTest).toBe(false);
  });
});
