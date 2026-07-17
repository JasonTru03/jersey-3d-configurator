import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { clampDecorationTransform, patchDecoration } from '../config/decorations.js';

const REGION_OFFSET = 0.026;
const REGION_POSITION_SCALE = 0.48;
const DECORATION_MIN_DISTANCE = 0.24;
const LEGACY_PATTERN_ASSET_URLS = {
  'golden-stripe': 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"%3E%3Cpath fill="%23d1b05d" d="M0 84 240 0v36L0 120z"/%3E%3C/svg%3E',
  'night-grid': 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"%3E%3Cg fill="none" stroke="%2320242a" stroke-width="10" opacity=".85"%3E%3Cpath d="M0 25h240M0 60h240M0 95h240M35 0v120M95 0v120M155 0v120M215 0v120"/%3E%3C/g%3E%3C/svg%3E',
};
const DEFAULT_PLACEMENT_OFFSETS = [
  { horizontal: 0, vertical: 0 },
  { horizontal: -0.58, vertical: 0.32 },
  { horizontal: 0.58, vertical: 0.32 },
  { horizontal: -0.58, vertical: -0.04 },
  { horizontal: 0.58, vertical: -0.04 },
  { horizontal: -0.5, vertical: -0.34 },
  { horizontal: 0.5, vertical: -0.34 },
  { horizontal: 0, vertical: 0.38 },
  { horizontal: 0, vertical: -0.4 },
];

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

const REGION_DIRECTIONS = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  'left-sleeve': new THREE.Vector3(-1, 0, 0),
  'right-sleeve': new THREE.Vector3(1, 0, 0),
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
  return presets.find((preset) => preset.source === decoration.source)?.assetUrl
    ?? LEGACY_PATTERN_ASSET_URLS[decoration.source]
    ?? decoration.source;
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

export function getDefaultDecorationPlacement(meshes, region, occupiedPlacements = []) {
  if (!meshes.length) return null;
  const bounds = new THREE.Box3();
  meshes.forEach((mesh) => bounds.expandByObject(mesh));
  if (bounds.isEmpty()) return null;

  const direction = (REGION_DIRECTIONS[region] ?? REGION_DIRECTIONS.front).clone();
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const distance = Math.max(size.length(), 1);
  const horizontal = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
  const horizontalSpan = Math.max(Math.abs(horizontal.x) * size.x + Math.abs(horizontal.z) * size.z, 0.6);
  const verticalSpan = Math.max(size.y, 0.8);
  const candidates = DEFAULT_PLACEMENT_OFFSETS
    .map((offset) => {
      const origin = center.clone()
        .addScaledVector(horizontal, offset.horizontal * horizontalSpan * 0.42)
        .addScaledVector(new THREE.Vector3(0, 1, 0), offset.vertical * verticalSpan * 0.42)
        .addScaledVector(direction, distance * 2);
      const hit = new THREE.Raycaster(origin, direction.clone().negate()).intersectObjects(meshes, false)[0];
      return hit ? placementFromIntersection(hit, region) : null;
    })
    .filter(Boolean);

  return candidates.find((placement) => !isPlacementOccupied(placement, occupiedPlacements)) ?? candidates[0] ?? null;
}

function isPlacementOccupied(placement, occupiedPlacements) {
  const position = toVector(placement.position);
  return occupiedPlacements.some((occupied) => (
    occupied?.region === placement.region
    && position.distanceTo(toVector(occupied.position)) < DECORATION_MIN_DISTANCE
  ));
}

export function createDecalSurface(texture, mesh, placement, transform) {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  const surface = new THREE.Mesh(createDecalGeometry(mesh, placement, transform), material);
  surface.renderOrder = 8;
  surface.userData.aspect = 1;
  surface.userData.rotation = transform.rotation ?? 0;
  return surface;
}

function createDecalGeometry(mesh, placement, transform, aspect = 1) {
  const normal = toVector(placement.normal).normalize();
  const orientation = new THREE.Quaternion()
    .setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    .multiply(new THREE.Quaternion().setFromAxisAngle(normal, THREE.MathUtils.degToRad(transform.rotation ?? 0)));
  const size = 0.6 * toSpriteTransform(transform).scale;
  return new DecalGeometry(
    mesh,
    toVector(placement.position),
    new THREE.Euler().setFromQuaternion(orientation),
    new THREE.Vector3(size * aspect, size, 0.12),
  );
}

function placementFromIntersection(hit, region) {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
  return {
    region,
    position: toPlainVector(hit.point),
    normal: toPlainVector(normal),
  };
}

export function getPlacementFromIntersection(hit, region, fallback = null) {
  return hit ? placementFromIntersection(hit, region) : fallback;
}

function findGarmentMeshForPlacement(meshes, placement) {
  if (!placement || !meshes.length) return null;
  const normal = toVector(placement.normal).normalize();
  const raycaster = new THREE.Raycaster(
    toVector(placement.position).addScaledVector(normal, 0.04),
    normal.negate(),
  );
  return raycaster.intersectObjects(meshes, false)[0]?.object ?? null;
}

function toPlainVector(vector) {
  return {
    x: roundCoordinate(vector.x),
    y: roundCoordinate(vector.y),
    z: roundCoordinate(vector.z),
  };
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
    this.garmentMeshes = [];
    this.decorations = [];
    this.selectedId = null;
    this.dragging = false;
    this.migratedDecorationIds = new Set();
  }

  get selectedSurface() {
    return this.selectedId ? this.surfaces.get(this.selectedId) ?? null : null;
  }

  setGarmentMeshes(meshes = []) {
    this.garmentMeshes = meshes;
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

    const migrated = [];
    const generatedPlacements = [];
    decorations.forEach((decoration) => {
      const requiresPlacement = !decoration.placement || decoration.placement.region !== decoration.region;
      const occupiedPlacements = decorations
        .filter((item) => item.id !== decoration.id && item.region === decoration.region && item.placement)
        .map((item) => item.placement)
        .concat(generatedPlacements.filter((placement) => placement.region === decoration.region));
      const placement = requiresPlacement
        ? getDefaultDecorationPlacement(this.garmentMeshes, decoration.region, occupiedPlacements)
        : decoration.placement;
      if (!placement) return;
      generatedPlacements.push(placement);
      const migrationKey = `${decoration.id}:${decoration.region}`;
      if (requiresPlacement && !this.migratedDecorationIds.has(migrationKey)) {
        this.migratedDecorationIds.add(migrationKey);
        migrated.push(patchDecoration(decoration, { placement }));
      }
      const surface = this.surfaces.get(decoration.id) ?? this.createSurface(decoration, placement);
      if (surface) this.applyDecoration(surface, decoration, placement);
    });

    if (migrated.length) {
      const byId = new Map(migrated.map((decoration) => [decoration.id, decoration]));
      this.onDecorationsChange?.(decorations.map((decoration) => byId.get(decoration.id) ?? decoration));
    }

    this.selectedId = remaining.has(selectedId) ? selectedId : null;
    this.refreshSelection();
  }

  createSurface(decoration, placement) {
    const mesh = findGarmentMeshForPlacement(this.garmentMeshes, placement);
    if (!mesh) return null;
    const surface = createDecalSurface(this.createTexture(decoration), mesh, placement, decoration);
    surface.userData.decorationId = decoration.id;
    surface.userData.garmentMesh = mesh;
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
        const placement = surface.userData.placement ?? decoration.placement;
        if (placement) this.applyDecoration(surface, decoration, placement);
      }
    };
    image.onerror = () => console.error(`Unable to load decoration artwork: ${decoration.label}`);
    image.src = this.resolveAssetUrl(decoration);
    return texture;
  }

  applyDecoration(surface, decoration, placement) {
    const mesh = findGarmentMeshForPlacement(this.garmentMeshes, placement);
    if (!mesh) return;
    surface.geometry.dispose();
    surface.geometry = createDecalGeometry(mesh, placement, decoration, surface.userData.aspect);
    surface.userData.placement = placement;
    surface.userData.garmentMesh = mesh;
    surface.userData.rotation = decoration.rotation;
    surface.material.opacity = decoration.id === this.selectedId ? 1 : 0.92;
  }

  handlePointerDown(event) {
    const decoration = this.pickDecoration(event);
    if (!decoration) return false;

    this.selectedId = decoration.id;
    this.onSelectionChange?.(decoration.id);
    this.dragging = true;
    this.refreshSelection();
    return true;
  }

  handlePointerMove(event) {
    if (!this.dragging || !this.selectedId) return false;
    const decoration = this.decorations.find((item) => item.id === this.selectedId);
    if (!decoration) return false;
    const placement = getPlacementFromIntersection(this.pickGarment(event), decoration.region, null);
    if (!placement) return false;
    this.emitPatch(decoration.id, { placement });
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
    return this.dragging;
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

  pickGarment(event) {
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.garmentMeshes, false)[0] ?? null;
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
