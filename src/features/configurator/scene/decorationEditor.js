import * as THREE from 'three';
import { clampDecorationTransform, patchDecoration } from '../config/decorations.js';

const REGION_ANCHORS = {
  front: { x: 0, y: 0.42, z: 0.72 },
  back: { x: 0, y: 0.42, z: -0.72 },
  'left-sleeve': { x: -1.08, y: 0.42, z: 0.08 },
  'right-sleeve': { x: 1.08, y: 0.42, z: 0.08 },
};

export function getRegionAnchor(region) {
  return { ...(REGION_ANCHORS[region] ?? REGION_ANCHORS.front) };
}

export function toSpriteTransform(transform) {
  return clampDecorationTransform(transform);
}

export class DecorationEditor {
  constructor({ camera, domElement, scene, onDecorationsChange }) {
    this.camera = camera;
    this.domElement = domElement;
    this.onDecorationsChange = onDecorationsChange;
    this.group = new THREE.Group();
    this.scene = scene;
    this.scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane();
    this.intersection = new THREE.Vector3();
    this.sprites = new Map();
    this.decorations = [];
    this.selectedId = null;
    this.dragging = false;
  }

  update(decorations = [], selectedId = null, presets = []) {
    this.decorations = decorations;
    this.presets = presets;
    const remaining = new Set(decorations.map((decoration) => decoration.id));
    this.sprites.forEach((sprite, id) => {
      if (remaining.has(id)) return;
      this.group.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
      this.sprites.delete(id);
    });

    decorations.forEach((decoration) => {
      const sprite = this.sprites.get(decoration.id) ?? this.createSprite(decoration);
      this.applyDecoration(sprite, decoration);
    });

    this.selectedId = remaining.has(selectedId) ? selectedId : null;
    this.refreshSelection();
  }

  createSprite(decoration) {
    const texture = new THREE.TextureLoader().load(this.resolveAssetUrl(decoration));
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 8;
    sprite.userData.decorationId = decoration.id;
    this.group.add(sprite);
    this.sprites.set(decoration.id, sprite);
    return sprite;
  }

  resolveAssetUrl(decoration) {
    if (decoration.kind !== 'preset') return decoration.source;
    return this.presets.find((preset) => preset.source === decoration.source)?.assetUrl ?? decoration.source;
  }

  applyDecoration(sprite, decoration) {
    const anchor = getRegionAnchor(decoration.region);
    const transform = toSpriteTransform(decoration);
    sprite.position.set(anchor.x + transform.x * 0.48, anchor.y + transform.y * 0.48, anchor.z);
    sprite.scale.set(0.6 * transform.scale, 0.6 * transform.scale, 1);
    sprite.material.rotation = THREE.MathUtils.degToRad(transform.rotation);
    sprite.material.opacity = decoration.id === this.selectedId ? 1 : 0.92;
  }

  handlePointerDown(event) {
    const decoration = this.pickDecoration(event);
    if (!decoration) {
      if (this.selectedId) {
        this.selectedId = null;
        this.refreshSelection();
        return true;
      }
      return false;
    }

    this.selectedId = decoration.id;
    this.dragging = true;
    this.refreshSelection();
    return true;
  }

  handlePointerMove(event) {
    if (!this.dragging || !this.selectedId) return false;
    const decoration = this.decorations.find((item) => item.id === this.selectedId);
    if (!decoration || !this.intersectRegion(event, decoration.region)) return false;
    const anchor = getRegionAnchor(decoration.region);
    this.emitPatch(decoration.id, {
      x: (this.intersection.x - anchor.x) / 0.48,
      y: (this.intersection.y - anchor.y) / 0.48,
    });
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
    this.sprites.forEach((sprite) => {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    });
    this.sprites.clear();
    this.scene.remove(this.group);
  }

  pickDecoration(event) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.sprites.values()];
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    return this.decorations.find((decoration) => decoration.id === hit.object.userData.decorationId) ?? null;
  }

  intersectRegion(event, region) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const anchor = getRegionAnchor(region);
    this.plane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(anchor.x, anchor.y, anchor.z));
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
    this.sprites.forEach((sprite, id) => {
      sprite.material.opacity = id === this.selectedId ? 1 : 0.92;
      sprite.material.color.set(id === this.selectedId ? '#ffffff' : '#e8e8e8');
    });
  }
}
