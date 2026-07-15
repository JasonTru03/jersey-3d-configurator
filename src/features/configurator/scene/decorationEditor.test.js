import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createRegionSurface,
  getRegionAnchor,
  getRegionFrame,
  resolveDecorationAsset,
  toRegionPosition,
  toRegionTransform,
  toSpriteTransform,
} from './decorationEditor.js';

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
});
