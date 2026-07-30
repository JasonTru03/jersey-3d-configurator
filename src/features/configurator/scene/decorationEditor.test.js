import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DecorationEditor,
  createDecalSurface,
  createRegionSurface,
  getDefaultDecorationPlacement,
  getDecorationGrabOffset,
  applyDecorationGrabOffset,
  hasExceededDecorationDragThreshold,
  getPlacementFromIntersection,
  getRegionAnchor,
  getRegionFrame,
  toRegionPosition,
  toRegionTransform,
  toSpriteTransform,
} from './decorationEditor.js';

const fixtureCleanups = [];

afterEach(() => {
  vi.useRealTimers();
  while (fixtureCleanups.length) fixtureCleanups.pop()();
});

function cleanupAfterTest(callback) {
  fixtureCleanups.push(callback);
}

function createFrontCamera() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function createEditorFixture() {
  const domElement = document.createElement('canvas');
  domElement.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  const editor = new DecorationEditor({
    camera: createFrontCamera(),
    domElement,
    scene: new THREE.Scene(),
  });
  cleanupAfterTest(() => editor.dispose());
  return editor;
}

function createPlane(z, { backFacing = false } = {}) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.position.z = z;
  if (backFacing) mesh.rotation.y = Math.PI;
  mesh.updateMatrixWorld(true);
  return mesh;
}

function disposeMeshes(meshes) {
  meshes.forEach((mesh) => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
}

function createFrameScheduler() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    cancelFrame: vi.fn((id) => callbacks.delete(id)),
    flushLatest() {
      const entries = [...callbacks.entries()];
      callbacks.clear();
      entries.forEach(([, callback]) => callback(0));
    },
    pendingCount() {
      return callbacks.size;
    },
    requestFrame: vi.fn((callback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    }),
  };
}

function createDragEditor({
  cancelFrame,
  onDecorationsChange = vi.fn(),
  requestFrame,
} = {}) {
  const scene = new THREE.Scene();
  const domElement = document.createElement('canvas');
  domElement.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  const garment = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  garment.updateMatrixWorld(true);
  const placement = {
    region: 'front',
    position: { x: 0, y: 0, z: 1 },
    normal: { x: 0, y: 0, z: 1 },
  };
  const decoration = {
    id: 'crest',
    kind: 'pattern',
    source: 'crest',
    label: 'Crest',
    region: 'front',
    placement,
    rotation: 17,
    scale: 0.8,
  };
  const surface = createDecalSurface(new THREE.Texture(), garment, placement, decoration);
  surface.userData.decorationId = decoration.id;
  surface.userData.garmentMesh = garment;
  surface.userData.placement = placement;
  const editor = new DecorationEditor({
    camera: createFrontCamera(),
    cancelFrame,
    domElement,
    onDecorationsChange,
    onSelectionChange: vi.fn(),
    requestFrame,
    scene,
  });
  editor.group.add(surface);
  editor.setGarmentMeshes([garment]);
  editor.surfaces.set(decoration.id, surface);
  editor.decorations = [decoration];
  editor.pickDecoration = () => ({
    decoration,
    point: new THREE.Vector3(0, 0, 1),
  });
  editor.pickGarment = ({ clientX, clientY }) => ({
    point: new THREE.Vector3((clientX - 100) / 100, (clientY - 100) / 100, 1),
    face: { normal: new THREE.Vector3(0, 0, 1) },
    object: garment,
  });
  cleanupAfterTest(() => {
    editor.dispose();
    disposeMeshes([garment]);
  });
  return {
    decoration,
    editor,
    garment,
    onDecorationsChange,
    placement,
    surface,
  };
}

describe('decoration editor geometry', () => {
  it('picks only the front artwork visible above the garment', () => {
    const editor = createEditorFixture();
    const garment = createPlane(0);
    const frontSurface = createPlane(0.02);
    const hiddenSurface = createPlane(-0.08);
    const frontDecoration = { id: 'front-artwork' };
    const hiddenDecoration = { id: 'hidden-artwork' };
    frontSurface.userData.decorationId = frontDecoration.id;
    hiddenSurface.userData.decorationId = hiddenDecoration.id;
    editor.setGarmentMeshes([garment]);
    editor.surfaces.set(frontDecoration.id, frontSurface);
    editor.surfaces.set(hiddenDecoration.id, hiddenSurface);
    editor.decorations = [frontDecoration, hiddenDecoration];
    cleanupAfterTest(() => disposeMeshes([garment]));

    const picked = editor.pickDecoration({ clientX: 50, clientY: 50 });

    expect(picked?.decoration).toBe(frontDecoration);
    expect(picked?.point.z).toBeCloseTo(0.02);
  });

  it('does not pick artwork hidden behind the garment', () => {
    const editor = createEditorFixture();
    const garment = createPlane(0);
    const hiddenSurface = createPlane(-0.08);
    const hiddenDecoration = { id: 'hidden-artwork' };
    hiddenSurface.userData.decorationId = hiddenDecoration.id;
    editor.setGarmentMeshes([garment]);
    editor.surfaces.set(hiddenDecoration.id, hiddenSurface);
    editor.decorations = [hiddenDecoration];
    cleanupAfterTest(() => disposeMeshes([garment]));

    expect(editor.pickDecoration({ clientX: 50, clientY: 50 })).toBeNull();
  });

  it('skips a nearer back-facing garment hit while picking a drag surface', () => {
    const editor = createEditorFixture();
    const backFacingMesh = createPlane(0.2, { backFacing: true });
    const outwardMesh = createPlane(0);
    const createHit = (distance, point, object) => ({
      distance,
      point,
      object,
      face: {
        a: 0,
        b: 1,
        c: 2,
        normal: new THREE.Vector3(0, 0, 1),
        materialIndex: 0,
      },
      faceIndex: 0,
      uv: new THREE.Vector2(0.5, 0.5),
    });
    const backFacingHit = createHit(1.8, new THREE.Vector3(0, 0, 0.2), backFacingMesh);
    const outwardHit = createHit(2, new THREE.Vector3(0, 0, 0), outwardMesh);
    editor.setGarmentMeshes([backFacingMesh, outwardMesh]);
    vi.spyOn(editor.raycaster, 'intersectObjects').mockReturnValue([
      backFacingHit,
      outwardHit,
    ]);
    cleanupAfterTest(() => disposeMeshes([backFacingMesh, outwardMesh]));

    expect(editor.pickGarment({ clientX: 50, clientY: 50 })).toBe(outwardHit);
  });

  it('returns a decoration geometry center in world coordinates', () => {
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    parent.position.set(10, 20, 30);
    scene.add(parent);
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: parent,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      2, 4, 6,
      6, 8, 10,
    ], 3));
    const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    surface.position.set(1, 2, 3);
    editor.group.add(surface);
    editor.surfaces.set('crest', surface);

    expect(editor.getDecorationWorldCenter('crest')).toEqual(new THREE.Vector3(15, 28, 41));

    editor.dispose();
  });

  it('returns null when a decoration surface or its bounding box is unavailable', () => {
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
    });
    const surface = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    surface.geometry.computeBoundingBox = () => {
      surface.geometry.boundingBox = null;
    };
    editor.surfaces.set('empty', surface);

    expect(editor.getDecorationWorldCenter('missing')).toBeNull();
    expect(editor.getDecorationWorldCenter('empty')).toBeNull();

    editor.dispose();
  });

  it('does not report editing when artwork is selected but not being dragged', () => {
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
    });
    editor.selectedId = 'crest';

    expect(editor.isEditing()).toBe(false);

    editor.dispose();
  });

  it('does not start moving an artwork until its pointer moves beyond the drag threshold', () => {
    const frameScheduler = createFrameScheduler();
    const { editor, onDecorationsChange } = createDragEditor(frameScheduler);

    editor.handlePointerDown({ clientX: 100, clientY: 100 });
    expect(editor.isEditing()).toBe(true);
    expect(editor.handlePointerMove({ clientX: 103, clientY: 102 })).toBe(false);
    expect(onDecorationsChange).not.toHaveBeenCalled();
    expect(editor.handlePointerUp()).toBe(true);
    expect(onDecorationsChange).not.toHaveBeenCalled();

    editor.handlePointerDown({ clientX: 100, clientY: 100 });
    expect(editor.handlePointerMove({ clientX: 105, clientY: 103 })).toBe(true);
    frameScheduler.flushLatest();
    expect(onDecorationsChange).not.toHaveBeenCalled();
    expect(editor.handlePointerUp()).toBe(true);
    expect(onDecorationsChange).toHaveBeenCalledOnce();
  });

  it('coalesces artwork drag previews into one frame and persists only on pointer up', () => {
    const frameScheduler = createFrameScheduler();
    const {
      decoration,
      editor,
      onDecorationsChange,
      surface,
    } = createDragEditor(frameScheduler);
    const originalGeometry = surface.geometry;
    const originalTexture = surface.material.map;

    editor.handlePointerDown({ clientX: 100, clientY: 100 });
    for (let index = 0; index < 60; index += 1) {
      expect(editor.handlePointerMove({
        clientX: 105 + index,
        clientY: 103 + index,
      })).toBe(true);
    }

    expect(frameScheduler.requestFrame).toHaveBeenCalledOnce();
    expect(frameScheduler.pendingCount()).toBe(1);
    frameScheduler.flushLatest();
    expect(frameScheduler.pendingCount()).toBe(0);
    expect(onDecorationsChange).not.toHaveBeenCalled();
    expect(surface.geometry).not.toBe(originalGeometry);
    expect(surface.material.map).toBe(originalTexture);
    expect(surface.userData.rotation).toBe(decoration.rotation);
    expect(editor.selectedId).toBe(decoration.id);

    expect(editor.handlePointerUp()).toBe(true);
    expect(onDecorationsChange).toHaveBeenCalledOnce();
    expect(onDecorationsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: decoration.id,
        kind: decoration.kind,
        source: decoration.source,
        rotation: decoration.rotation,
        scale: decoration.scale,
        placement: expect.objectContaining({
          position: { x: 0.64, y: 0.62, z: 1 },
        }),
      }),
    ]);
  });

  it('restores the original artwork surface on pointer cancel without persisting', () => {
    const frameScheduler = createFrameScheduler();
    const {
      editor,
      onDecorationsChange,
      placement,
      surface,
    } = createDragEditor(frameScheduler);

    editor.handlePointerDown({ clientX: 100, clientY: 100 });
    editor.handlePointerMove({ clientX: 125, clientY: 130 });
    frameScheduler.flushLatest();
    expect(surface.userData.placement.position).toEqual({ x: 0.25, y: 0.3, z: 1 });

    expect(editor.handlePointerCancel()).toBe(true);
    expect(onDecorationsChange).not.toHaveBeenCalled();
    expect(surface.userData.placement).toEqual(placement);
    expect(editor.isEditing()).toBe(false);
  });

  it('handles a missing drag surface safely and cancels pending frames on dispose', () => {
    const frameScheduler = createFrameScheduler();
    const {
      decoration,
      editor,
      onDecorationsChange,
      surface,
    } = createDragEditor(frameScheduler);

    editor.handlePointerDown({ clientX: 100, clientY: 100 });
    editor.handlePointerMove({ clientX: 125, clientY: 130 });
    editor.surfaces.delete(decoration.id);

    expect(() => frameScheduler.flushLatest()).not.toThrow();
    expect(editor.handlePointerUp()).toBe(true);
    expect(onDecorationsChange).not.toHaveBeenCalled();

    editor.surfaces.set(decoration.id, surface);
    editor.handlePointerDown({ clientX: 100, clientY: 100 });
    editor.handlePointerMove({ clientX: 140, clientY: 145 });
    expect(frameScheduler.pendingCount()).toBe(1);

    editor.dispose();

    expect(frameScheduler.pendingCount()).toBe(0);
    expect(frameScheduler.cancelFrame).toHaveBeenCalledOnce();
    expect(onDecorationsChange).not.toHaveBeenCalled();
  });

  it('uses a four pixel threshold to distinguish a click from an artwork drag', () => {
    expect(hasExceededDecorationDragThreshold({ x: 100, y: 100 }, { clientX: 103, clientY: 102 })).toBe(false);
    expect(hasExceededDecorationDragThreshold({ x: 100, y: 100 }, { clientX: 105, clientY: 103 })).toBe(true);
  });

  it('keeps the originally grabbed point under the pointer while artwork is dragged', () => {
    const originalPlacement = {
      region: 'front',
      position: { x: 0.4, y: 0.2, z: 1 },
      normal: { x: 0, y: 0, z: 1 },
    };
    const pointerHit = new THREE.Vector3(0.58, 0.08, 1.03);
    const nextGarmentHit = {
      region: 'front',
      position: { x: -0.1, y: 0.55, z: 1 },
      normal: { x: 0, y: 0, z: 1 },
    };

    const offset = getDecorationGrabOffset(pointerHit, originalPlacement);
    const nextPlacement = applyDecorationGrabOffset(nextGarmentHit, offset);

    expect(offset).toEqual({ x: 0.18, y: -0.12, z: 0 });
    expect(nextPlacement.position).toEqual({ x: -0.28, y: 0.67, z: 1 });
  });

  it('keeps the same decal-local grab point when a drag crosses surfaces with different normals and rotation', () => {
    const originalPlacement = {
      region: 'front',
      position: { x: 0.4, y: 0.2, z: 1 },
      normal: { x: 0, y: 0, z: 1 },
    };
    const pointerHit = new THREE.Vector3(0.58, 0.08, 1.03);
    const nextGarmentHit = {
      region: 'right-sleeve',
      position: { x: 1.1, y: 0.55, z: 0.35 },
      normal: { x: 1, y: 0, z: 0 },
    };
    const rotation = 37;

    const offset = getDecorationGrabOffset(pointerHit, originalPlacement, rotation);
    const nextPlacement = applyDecorationGrabOffset(nextGarmentHit, offset, rotation);
    const orientation = new THREE.Quaternion()
      .setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(rotation)));
    const resolvedGrabPoint = new THREE.Vector3(
      nextPlacement.position.x,
      nextPlacement.position.y,
      nextPlacement.position.z,
    ).add(new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(orientation));

    expect(resolvedGrabPoint.distanceTo(new THREE.Vector3(
      nextGarmentHit.position.x,
      nextGarmentHit.position.y,
      nextGarmentHit.position.z,
    ))).toBeLessThan(0.0002);
  });

  it('preserves the grab offset when the first movement crosses the drag threshold', () => {
    const frameScheduler = createFrameScheduler();
    const { decoration, editor, onDecorationsChange } = createDragEditor(frameScheduler);
    decoration.placement = {
      region: 'front',
      position: { x: 0.2, y: 0.1, z: 1 },
      normal: { x: 0, y: 0, z: 1 },
    };
    decoration.rotation = 0;
    editor.decorations = [decoration];
    editor.pickDecoration = () => ({ decoration, point: new THREE.Vector3(0.35, 0.18, 1.02) });
    editor.pickGarment = () => ({
      point: new THREE.Vector3(0.7, 0.6, 1),
      face: { normal: new THREE.Vector3(0, 0, 1) },
      object: new THREE.Mesh(),
    });

    editor.handlePointerDown({ clientX: 100, clientY: 100 });
    editor.handlePointerMove({ clientX: 105, clientY: 100 });
    frameScheduler.flushLatest();
    editor.handlePointerUp();

    expect(onDecorationsChange).toHaveBeenCalledWith([expect.objectContaining({
      placement: expect.objectContaining({ position: { x: 0.55, y: 0.52, z: 1 } }),
    })]);
  });

  it('returns the stored world-facing decal normal for camera focus', () => {
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
    });
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    surface.userData.placement = { normal: { x: 0, y: 0, z: -3 } };
    editor.surfaces.set('back-badge', surface);

    expect(editor.getDecorationWorldNormal('back-badge')).toEqual(new THREE.Vector3(0, 0, -1));
    expect(editor.getDecorationWorldNormal('missing')).toBeNull();

    editor.dispose();
  });

  it('keeps selected artwork when a pointer starts outside the artwork', () => {
    const onSelectionChange = vi.fn();
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
      onSelectionChange,
    });
    editor.selectedId = 'crest';
    editor.pickDecoration = () => null;

    expect(editor.handlePointerDown({})).toBe(false);
    expect(editor.selectedId).toBe('crest');
    expect(onSelectionChange).not.toHaveBeenCalled();

    editor.dispose();
  });

  it('clears the selected artwork and restores its unselected material state', () => {
    const onSelectionChange = vi.fn();
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
      onSelectionChange,
    });
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    editor.surfaces.set('crest', surface);
    editor.selectedId = 'crest';

    editor.clearSelection();

    expect(editor.selectedId).toBeNull();
    expect(onSelectionChange).toHaveBeenCalledWith(null);
    expect(surface.material.opacity).toBe(0.92);
    expect(surface.material.color.getHexString()).toBe('e8e8e8');

    editor.dispose();
  });

  it('briefly flashes a newly synced artwork selection without persisting a transform', () => {
    vi.useFakeTimers();
    const onDecorationsChange = vi.fn();
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
      onDecorationsChange,
    });
    const decoration = {
      id: 'crest',
      kind: 'pattern',
      source: 'crest',
      label: 'Crest',
      region: 'front',
      x: 0.25,
      y: -0.2,
      scale: 1.2,
      rotation: 15,
      placement: { region: 'front', position: { x: 0, y: 0, z: 1 }, normal: { x: 0, y: 0, z: 1 } },
    };
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    editor.surfaces.set(decoration.id, surface);

    editor.update([decoration], decoration.id, []);

    expect(surface.material.color.getHexString()).toBe('ffd166');
    expect(surface.material.opacity).toBe(0.72);
    expect(onDecorationsChange).not.toHaveBeenCalled();
    expect(decoration).toMatchObject({ x: 0.25, y: -0.2, scale: 1.2, rotation: 15 });

    vi.advanceTimersByTime(200);

    expect(surface.material.color.getHexString()).toBe('ffffff');
    expect(surface.material.opacity).toBe(1);

    editor.dispose();
  });

  it('keeps a new canvas selection flashed when its active id is synced back immediately', () => {
    vi.useFakeTimers();
    const decoration = {
      id: 'crest',
      kind: 'pattern',
      source: 'crest',
      label: 'Crest',
      region: 'front',
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      placement: { region: 'front', position: { x: 0, y: 0, z: 1 }, normal: { x: 0, y: 0, z: 1 } },
    };
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
      onSelectionChange: vi.fn(),
    });
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    editor.surfaces.set(decoration.id, surface);
    editor.decorations = [decoration];
    editor.pickDecoration = () => decoration;

    editor.handlePointerDown({});
    editor.update([decoration], decoration.id, []);

    expect(surface.material.color.getHexString()).toBe('ffd166');
    expect(surface.material.opacity).toBe(0.72);

    vi.advanceTimersByTime(200);

    expect(surface.material.color.getHexString()).toBe('ffffff');
    expect(surface.material.opacity).toBe(1);

    editor.dispose();
  });

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

  it('creates artwork surfaces that participate in garment depth occlusion', () => {
    const surface = createRegionSurface(new THREE.Texture());

    expect(surface.isMesh).toBe(true);
    expect(surface.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(surface.material.depthTest).toBe(true);
    expect(surface.material.depthWrite).toBe(false);
    expect(surface.material.side).toBe(THREE.FrontSide);
  });

  it('derives a front artwork placement from the loaded garment mesh', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);

    expect(getDefaultDecorationPlacement([mesh], 'front')).toMatchObject({
      region: 'front',
      position: { x: 0, y: 0.42, z: 1 },
      normal: { x: 0, y: 0, z: 1 },
    });
  });

  it('uses an outward-facing hit for the default artwork placement', () => {
    const backFacingMesh = createPlane(0.8, { backFacing: true });
    const outwardMesh = createPlane(0.4);
    cleanupAfterTest(() => disposeMeshes([backFacingMesh, outwardMesh]));

    const placement = getDefaultDecorationPlacement(
      [backFacingMesh, outwardMesh],
      'front',
    );

    expect(placement).toMatchObject({
      region: 'front',
      position: { z: 0.4 },
      normal: { z: 1 },
    });
  });

  it('assigns a different default position when a front artwork slot is occupied', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const occupied = getDefaultDecorationPlacement([mesh], 'front');
    const next = getDefaultDecorationPlacement([mesh], 'front', [occupied]);

    expect(next.position).not.toEqual(occupied.position);
    expect(new THREE.Vector3(next.position.x, next.position.y, next.position.z)
      .distanceTo(new THREE.Vector3(occupied.position.x, occupied.position.y, occupied.position.z)))
      .toBeGreaterThan(0.2);
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
    expect(surface.material.side).toBe(THREE.FrontSide);
  });

  it('keeps only outward-facing triangles on a thin garment mesh', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 0.04),
      new THREE.MeshBasicMaterial(),
    );
    mesh.updateMatrixWorld(true);
    const outwardNormal = new THREE.Vector3(0, 0, 1);
    const surface = createDecalSurface(
      new THREE.Texture(),
      mesh,
      {
        region: 'front',
        position: { x: 0, y: 0, z: 0.02 },
        normal: { x: 0, y: 0, z: 1 },
      },
      { scale: 1, rotation: 0 },
    );
    const positions = surface.geometry.getAttribute('position');
    const outwardDots = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const edge = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();

    for (let index = 0; index + 2 < positions.count; index += 3) {
      a.fromBufferAttribute(positions, index);
      b.fromBufferAttribute(positions, index + 1);
      c.fromBufferAttribute(positions, index + 2);
      faceNormal.subVectors(b, a).cross(edge.subVectors(c, a));
      if (faceNormal.lengthSq() > 0) {
        outwardDots.push(faceNormal.normalize().dot(outwardNormal));
      }
    }

    expect(outwardDots.length).toBeGreaterThan(0);
    expect(Math.min(...outwardDots)).toBeGreaterThanOrEqual(0.08);
  });

  it('keeps the last valid placement when a drag ray misses the garment', () => {
    const previous = {
      region: 'front',
      position: { x: 0.1, y: 0.2, z: 0.3 },
      normal: { x: 0, y: 0, z: 1 },
    };

    expect(getPlacementFromIntersection(null, 'front', previous)).toEqual(previous);
  });

  it('migrates a legacy decoration to a mesh placement after the garment loads', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const changes = [];
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('canvas'),
      scene: new THREE.Scene(),
      onDecorationsChange: (decorations) => changes.push(decorations),
    });
    editor.setGarmentMeshes([mesh]);
    editor.update([{
      id: 'legacy-badge',
      kind: 'pattern',
      source: 'crest',
      label: 'Crest',
      region: 'front',
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    }], null, [{ source: 'crest', assetUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' }]);

    expect(changes[0][0].placement).toMatchObject({
      region: 'front',
      normal: { z: 1 },
    });

    editor.dispose();
  });

  it('restores a saved placement on the outward garment mesh', () => {
    const editor = createEditorFixture();
    const backFacingMesh = createPlane(0.02, { backFacing: true });
    const outwardMesh = createPlane(0);
    const decoration = {
      id: 'saved-badge',
      kind: 'pattern',
      source: 'crest',
      label: 'Crest',
      region: 'front',
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      placement: {
        region: 'front',
        position: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 1 },
      },
    };
    editor.setGarmentMeshes([backFacingMesh, outwardMesh]);
    cleanupAfterTest(() => disposeMeshes([backFacingMesh, outwardMesh]));

    editor.update(
      [decoration],
      null,
      [{ source: 'crest', assetUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' }],
    );

    expect(editor.surfaces.get(decoration.id)?.userData.garmentMesh).toBe(outwardMesh);
  });
});
