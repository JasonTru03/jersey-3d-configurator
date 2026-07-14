import * as THREE from 'three';
import { clampDecorationTransform, patchDecoration } from '../config/decorations.js';

const REGION_OFFSET = 0.026;
const REGION_POSITION_SCALE = 0.48;

const REGION_FRAMES = {
  front: {
    anchor: { x: 0, y: 0.42, z: 0.72 },
    horizontal: { x: 1, y: 0, z: 0 },
    vertical: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
  },
  back: {
    anchor: { x: 0, y: 0.42, z: -0.72 },
    horizontal: { x: -1, y: 0, z: 0 },
    vertical: { x: 0, y: 1, z: 0 },
    normal: { x: 0, y: 0, z: -1 },
  },
  'left-sleeve': {
    anchor: { x: -1.08, y: 0.42, z: 0.08 },
    horizontal: { x: 0, y: 0, z: 1 },
    vertical: { x: 0, y: 1, z: 0 },
    normal: { x: -1, y: 0, z: 0 },
  },
  'right-sleeve': {
    anchor: { x: 1.08, y: 0.42, z: 0.08 },
    horizontal: { x: 0, y: 0, z: -1 },
    vertical: { x: 0, y: 1, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
  },
};

export function getRegionAnchor(region) {
  return { ...getRegionFrame(region).anchor };
}

export function getRegionFrame(region) {
  const frame = REGION_FRAMES[region] ?? REGION_FRAMES.front;
  return {
    anchor: { ...frame.anchor },
    horizontal: { ...frame.horizontal },
    vertical: { ...frame.vertical },
    normal: { ...frame.normal },
  };
}

export function toRegionPosition(region, transform) {
  const frame = getRegionFrame(region);
  const clamped = toSpriteTransform(transform);
  return toVector(frame.anchor)
    .addScaledVector(toVector(frame.horizontal), clamped.x * REGION_POSITION_SCALE)
    .addScaledVector(toVector(frame.vertical), clamped.y * REGION_POSITION_SCALE)
    .addScaledVector(toVector(frame.normal), REGION_OFFSET);
}

export function toRegionTransform(region, position) {
  const frame = getRegionFrame(region);
  const relative = toVector(position).sub(toVector(frame.anchor));
  const clamped = toSpriteTransform({
    x: roundCoordinate(relative.dot(toVector(frame.horizontal)) / REGION_POSITION_SCALE),
    y: roundCoordinate(relative.dot(toVector(frame.vertical)) / REGION_POSITION_SCALE),
    scale: 1,
    rotation: 0,
  });
  return { x: clamped.x, y: clamped.y };
}

export function toSpriteTransform(transform) {
  return clampDecorationTransform(transform);
}

function toVector(value) {
  return value.isVector3 ? value.clone() : new THREE.Vector3(value.x, value.y, value.z);
}

function roundCoordinate(value) {
  return Math.round(value * 10000) / 10000;
}

export function resolveDecorationAsset(decoration, presets = []) {
  if (decoration.kind === 'upload') return decoration.source;
  return presets.find((preset) => preset.source === decoration.source)?.assetUrl ?? decoration.source;
}

export function createRegionSurface(texture) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  surface.renderOrder = 8;
  surface.userData.aspect = 1;
  surface.userData.rotation = 0;
  return surface;
}

export class DecorationEditor {
  constructor({ camera, domElement, scene, onDecorationsChange, onSelectionChange }) {
    this.camera = camera;
    this.domElement = domElement;
    this.onDecorationsChange = onDecorationsChange;
    this.onSelectionChange = onSelectionChange;
    this.group = new THREE.Group();
    this.scene = scene;
    this.scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane();
    this.intersection = new THREE.Vector3();
    this.surfaces = new Map();
    this.decorations = [];
    this.selectedId = null;
    this.dragging = false;
  }

  update(decorations = [], selectedId = null, presets = []) {
    this.decorations = decorations;
    this.presets = presets;
    const remaining = new Set(decorations.map((decoration) => decoration.id));
    this.surfaces.forEach((surface, id) => {
      if (remaining.has(id)) return;
      this.group.remove(surface);
      surface.geometry.dispose();
      surface.material.map?.dispose();
      surface.material.dispose();
      this.surfaces.delete(id);
    });

    decorations.forEach((decoration) => {
      const surface = this.surfaces.get(decoration.id) ?? this.createSurface(decoration);
      this.applyDecoration(surface, decoration);
    });

    this.selectedId = remaining.has(selectedId) ? selectedId : null;
    this.refreshSelection();
    this.updateCameraFacing();
  }

  createSurface(decoration) {
    const surface = createRegionSurface(this.createTexture(decoration));
    surface.userData.decorationId = decoration.id;
    this.group.add(surface);
    this.surfaces.set(decoration.id, surface);
    return surface;
  }

  resolveAssetUrl(decoration) {
    return resolveDecorationAsset(decoration, this.presets);
  }

  createTexture(decoration) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const image = new Image();
    image.onload = () => {
      const aspect = image.naturalWidth / image.naturalHeight || 1;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      texture.needsUpdate = true;
      const surface = this.surfaces.get(decoration.id);
      if (surface) {
        surface.userData.aspect = aspect;
        this.applyDecoration(surface, decoration);
      }
    };
    image.onerror = () => console.error(`Unable to load decoration artwork: ${decoration.label}`);
    image.src = this.resolveAssetUrl(decoration);
    return texture;
  }

  applyDecoration(surface, decoration) {
    const frame = getRegionFrame(decoration.region);
    const transform = toSpriteTransform(decoration);
    surface.position.copy(toRegionPosition(decoration.region, transform));
    surface.scale.set(0.6 * transform.scale * surface.userData.aspect, 0.6 * transform.scale, 1);
    surface.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      toVector(frame.horizontal),
      toVector(frame.vertical),
      toVector(frame.normal),
    ));
    surface.userData.rotation = THREE.MathUtils.degToRad(transform.rotation);
    surface.rotateZ(surface.userData.rotation);
    surface.material.opacity = decoration.id === this.selectedId ? 1 : 0.92;
  }

  handlePointerDown(event) {
    const decoration = this.pickDecoration(event);
    if (!decoration) {
      if (this.selectedId) {
        this.selectedId = null;
        this.onSelectionChange?.(null);
        this.refreshSelection();
        return true;
      }
      return false;
    }

    this.selectedId = decoration.id;
    this.onSelectionChange?.(decoration.id);
    this.dragging = true;
    this.refreshSelection();
    return true;
  }

  handlePointerMove(event) {
    if (!this.dragging || !this.selectedId) return false;
    const decoration = this.decorations.find((item) => item.id === this.selectedId);
    if (!decoration || !this.intersectRegion(event, decoration.region)) return false;
    this.emitPatch(decoration.id, toRegionTransform(decoration.region, this.intersection));
    return true;
  }

  handlePointerUp() {
    const wasDragging = this.dragging;
    this.dragging = false;
    return wasDragging;
  }

  patchSelected(transform) {
    if (!this.selectedId) return false;
    this.emitPatch(this.selectedId, transform);
    return true;
  }

  isEditing() {
    return Boolean(this.selectedId || this.dragging);
  }

  dispose() {
    this.surfaces.forEach((surface) => {
      surface.geometry.dispose();
      surface.material.map?.dispose();
      surface.material.dispose();
    });
    this.surfaces.clear();
    this.scene.remove(this.group);
  }

  pickDecoration(event) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.surfaces.values()];
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    return this.decorations.find((decoration) => decoration.id === hit.object.userData.decorationId) ?? null;
  }

  intersectRegion(event, region) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const frame = getRegionFrame(region);
    this.plane.setFromNormalAndCoplanarPoint(toVector(frame.normal), toVector(frame.anchor));
    return this.raycaster.ray.intersectPlane(this.plane, this.intersection);
  }

  updatePointer(event) {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  emitPatch(id, patch) {
    const next = this.decorations.map((decoration) => (
      decoration.id === id ? patchDecoration(decoration, patch) : decoration
    ));
    this.onDecorationsChange(next);
  }

  refreshSelection() {
    this.surfaces.forEach((surface, id) => {
      surface.material.opacity = id === this.selectedId ? 1 : 0.92;
      surface.material.color.set(id === this.selectedId ? '#ffffff' : '#e8e8e8');
    });
  }
}
