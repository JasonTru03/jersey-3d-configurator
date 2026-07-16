import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getNextPrintPlacement, getPrintToolbarAnchor, hasPrintToolbarAnchorChanged, selectDecorationMeshes } from './garmentRenderer.js';

describe('garment decoration mesh selection', () => {
  it('uses cloth meshes instead of topstitch meshes for artwork placement', () => {
    const cloth = new THREE.Mesh();
    cloth.name = 'Cloth_mesh';
    const topstitch = new THREE.Mesh();
    topstitch.name = 'Topstitch_1146195';

    expect(selectDecorationMeshes([cloth, topstitch])).toEqual([cloth]);
  });

  it('falls back to all meshes when a model has no identifiable cloth mesh', () => {
    const first = new THREE.Mesh();
    const second = new THREE.Mesh();

    expect(selectDecorationMeshes([first, second])).toEqual([first, second]);
  });

  it('chooses a copy placement away from existing print placements', () => {
    const selected = getNextPrintPlacement(
      [{ x: 0, y: 0.36, z: 0.5 }, { x: 0.3, y: 0.36, z: 0.5 }],
      [{ x: 0, y: 0.36, z: 0.5 }],
    );

    expect(selected).toEqual({ x: 0.3, y: 0.36, z: 0.5 });
  });

  it('flips a visible anchor away from the stage edges', () => {
    const bounds = { width: 480, height: 360 };

    expect(getPrintToolbarAnchor({ x: 0.5, y: 0.5, z: 0 }, bounds)).toMatchObject({ placement: 'left-bottom', visible: true });
    expect(getPrintToolbarAnchor({ x: -0.3, y: 0.5, z: 0 }, bounds)).toMatchObject({ placement: 'right-bottom', visible: true });
    expect(getPrintToolbarAnchor({ x: 0.5, y: -0.2, z: 0 }, bounds)).toMatchObject({ placement: 'left-top', visible: true });
    expect(getPrintToolbarAnchor({ x: -0.3, y: -0.2, z: 0 }, bounds)).toMatchObject({ placement: 'right-top', visible: true });
  });

  it('hides the anchor when a print is outside the camera view', () => {
    expect(getPrintToolbarAnchor({ x: 0, y: 0, z: 1.1 }, { width: 480, height: 360 })).toEqual({ visible: false });
  });

  it('does not notify React when the projected toolbar anchor has not changed', () => {
    const anchor = { visible: true, x: 180, y: 220, placement: 'right-top' };

    expect(hasPrintToolbarAnchorChanged(anchor, anchor)).toBe(false);
    expect(hasPrintToolbarAnchorChanged(anchor, { ...anchor, x: 181 })).toBe(true);
    expect(hasPrintToolbarAnchorChanged(anchor, { visible: false })).toBe(true);
  });
});
