import gsap from 'gsap';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecorationEditor } from './decorationEditor.js';
import { getPrintItems, legacyFirstItemFields, patchPrintItem } from '../config/printItems.js';
import { createGarmentAppearanceCanvas } from './garmentAppearanceTexture.js';

const DEFAULT_PRINT_POSITION = { x: 0, y: 0.36, z: 0.5 };
const DECORATION_MESH_NAME_PATTERN = /cloth|fabric|body/i;
const MIN_PRINT_COPY_DISTANCE = 0.24;
const PRINT_DRAG_THRESHOLD = 4;

export function getPrintPointerDownAction({ hasPrintHit, handledDecoration }) {
  if (hasPrintHit) return 'select-print';
  if (handledDecoration) return 'decoration';
  return 'deselect-print';
}

export function shouldEnableOrbitControls({ isDraggingDecoration, isDraggingPrint }) {
  return !isDraggingDecoration && !isDraggingPrint;
}

export function hasExceededPrintDragThreshold(start, event) {
  return Math.hypot(event.clientX - start.x, event.clientY - start.y) > PRINT_DRAG_THRESHOLD;
}

export function selectDecorationMeshes(meshes) {
  const clothMeshes = meshes.filter((mesh) => DECORATION_MESH_NAME_PATTERN.test(mesh.name));
  return clothMeshes.length ? clothMeshes : meshes;
}

export function getNextPrintPlacement(candidates, occupiedPlacements) {
  return candidates.find((candidate) => occupiedPlacements.every((occupied) => (
    distanceBetweenPlacements(candidate, occupied) >= MIN_PRINT_COPY_DISTANCE
  ))) ?? null;
}

export function getPrintSelectionRect(projectedCorners, { width, height }) {
  if (projectedCorners.length !== 4) return { visible: false };
  return getProjectedSelectionRect(projectedCorners, { width, height });
}

function getProjectedSelectionRect(projectedCorners, { width, height }) {
  if (!width || !height || projectedCorners.some((corner) => (
    corner.x < -1 || corner.x > 1 || corner.y < -1 || corner.y > 1 || corner.z < -1 || corner.z > 1
  ))) return { visible: false };

  const points = projectedCorners.map((corner) => ({
    x: Math.round((corner.x * 0.5 + 0.5) * width),
    y: Math.round((-corner.y * 0.5 + 0.5) * height),
  }));
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  if (right <= left || bottom <= top) return { visible: false };
  return { visible: true, left, top, width: right - left, height: bottom - top };
}

export function hasPrintSelectionRectChanged(previous, next) {
  return !previous
    || previous.visible !== next.visible
    || previous.left !== next.left
    || previous.top !== next.top
    || previous.width !== next.width
    || previous.height !== next.height;
}

export class GarmentRenderer {
  constructor(host, options = {}) {
    this.host = host;
    this.onStatePatch = options.onStatePatch;
    this.onPrintAnchorChange = options.onPrintAnchorChange;
    this.onPrintSelectionChange = options.onPrintSelectionChange;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f3f1ec');
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 1.8, 5.4);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('contextmenu', preventContextMenu);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 9;
    this.controls.minPolarAngle = Math.PI * 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.78;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.58;
    this.controls.panSpeed = 0.72;
    this.controls.enablePan = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.loader = new GLTFLoader();
    this.root = new THREE.Group();
    this.modelGroup = new THREE.Group();
    this.root.add(this.modelGroup);
    this.scene.add(this.root);
    this.modelMaterials = [];
    this.appearanceTexture = null;
    this.appearanceTextureKey = null;
    this.modelMeshes = [];
    this.decorationMeshes = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.printLayers = new Map();
    this.activePrintId = null;
    this.lastPrintAnchor = null;
    this.isDraggingPrint = false;
    this.pendingPrintDrag = null;
    this.pendingDecorationDeselect = null;
    this.printColor = '#20242a';
    this.decorationEditor = new DecorationEditor({
      camera: this.camera,
      domElement: this.renderer.domElement,
      scene: this.scene,
      onDecorationsChange: (decorations) => this.onStatePatch?.({ overrides: { decorations } }),
      onSelectionChange: (activeDecorationId) => this.onStatePatch?.({ overrides: { activeDecorationId } }),
    });

    this.addLights();
    this.addFloor();
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.animate();
  }

  get printPlane() {
    return this.printLayers.get(this.activePrintId)?.plane
      ?? this.printLayers.values().next().value?.plane
      ?? null;
  }

  setActivePrintId(id) {
    if (this.activePrintId === id) return;
    this.activePrintId = id;
    this.syncPrintAnchor();
  }

  update(product, state, selected) {
    if (!selected) return;
    this.product = product;
    this.state = state;
    this.selected = selected;

    const modelUrl = product.model?.glbUrl;
    if (modelUrl && modelUrl !== this.currentModelUrl) {
      this.currentModelUrl = modelUrl;
      this.loadModel(modelUrl);
    }

    this.applyAppearance(selected.appearance);
    this.applyMaterial(selected.material.material);
    this.updatePrintLayer();
    this.decorationEditor.update(
      state.overrides?.decorations ?? [],
      state.overrides?.activeDecorationId,
      product.decorationPresets ?? [],
    );
    this.controls.enabled = shouldEnableOrbitControls({
      isDraggingDecoration: this.decorationEditor.isEditing(),
      isDraggingPrint: this.isDraggingPrint,
    });
  }

  setView(view) {
    const targets = {
      orbit: { position: { x: 0, y: 1.8, z: 5.4 }, target: { x: 0, y: 0.7, z: 0 } },
      top: { position: { x: 0, y: 5.4, z: 0.05 }, target: { x: 0, y: 0.4, z: 0 } },
      detail: { position: { x: 0.85, y: 1.35, z: 2.35 }, target: { x: 0, y: 0.78, z: 0 } },
    };
    const next = targets[view] ?? targets.orbit;
    gsap.to(this.camera.position, {
      ...next.position,
      duration: 0.55,
      ease: 'power2.out',
      onUpdate: () => this.camera.lookAt(this.controls.target),
    });
    gsap.to(this.controls.target, {
      ...next.target,
      duration: 0.55,
      ease: 'power2.out',
    });
  }

  focusDecoration(id) {
    const center = this.decorationEditor?.getDecorationWorldCenter(id);
    if (!center) return false;

    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(
      offset.length(),
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    const normal = this.decorationEditor?.getDecorationWorldNormal(id);
    const direction = normal?.lengthSq() > 0
      ? normal.clone().normalize()
      : (offset.lengthSq() > 0 ? offset.normalize() : new THREE.Vector3(0, 0, 1));
    const position = center.clone().addScaledVector(direction, distance);

    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    gsap.to(this.camera.position, {
      x: position.x,
      y: position.y,
      z: position.z,
      duration: 0.4,
      ease: 'power2.out',
      onUpdate: () => this.camera.lookAt(this.controls.target),
    });
    gsap.to(this.controls.target, {
      x: center.x,
      y: center.y,
      z: center.z,
      duration: 0.4,
      ease: 'power2.out',
    });
    return true;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.loadToken = Symbol('disposed');
    this.pendingDecorationDeselect = null;
    gsap.killTweensOf(this.camera?.position);
    gsap.killTweensOf(this.controls?.target);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.domElement.removeEventListener('contextmenu', preventContextMenu);
    this.renderer?.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer?.domElement.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerCancel);
    this.disposeAppearanceTexture();
    this.disposeGroup(this.root);
    this.disposePrintLayer();
    this.decorationEditor?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  async loadModel(modelUrl) {
    const loadToken = Symbol(modelUrl);
    this.loadToken = loadToken;
    try {
      const gltf = await this.loader.loadAsync(modelUrl);
      if (this.loadToken !== loadToken) {
        disposeModelResources(gltf.scene);
        return;
      }

      this.disposeAppearanceTexture();
      this.disposeGroup(this.modelGroup);
      this.modelGroup.clear();
      this.modelMaterials = [];
      this.modelMeshes = [];
      this.decorationMeshes = [];
      const model = gltf.scene;
      model.traverse((item) => {
        if (!item.isMesh) return;
        item.castShadow = true;
        item.receiveShadow = true;
        item.material = cloneMaterials(item.material);
        setGarmentMaterialDefaults(item.material);
        collectMaterials(item.material, this.modelMaterials);
        this.modelMeshes.push(item);
      });

      this.decorationMeshes = selectDecorationMeshes(this.modelMeshes);

      this.modelGroup.add(model);
      this.fitModel(model);
      this.modelGroup.updateMatrixWorld(true);
      this.decorationEditor.setGarmentMeshes(this.decorationMeshes);
      this.decorationEditor.update(
        this.state?.overrides?.decorations ?? [],
        this.state?.overrides?.activeDecorationId,
        this.product?.decorationPresets ?? [],
      );
      this.applyAppearance(this.selected?.appearance);
      this.applyMaterial(this.selected?.material?.material);
      this.updatePrintLayer();
      gsap.fromTo(model.scale, { x: model.scale.x * 0.94, y: model.scale.y * 0.94, z: model.scale.z * 0.94 }, {
        x: model.scale.x,
        y: model.scale.y,
        z: model.scale.z,
        duration: 0.55,
        ease: 'power2.out',
      });
    } catch (error) {
      console.error(`Unable to load garment model: ${modelUrl}`, error);
    }
  }

  fitModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDimension = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.35 / maxDimension;
    model.scale.setScalar(scale);
    model.position.set(
      -center.x * scale,
      -center.y * scale,
      -center.z * scale,
    );

    const fittedBox = new THREE.Box3().setFromObject(model);
    const fittedSize = new THREE.Vector3();
    fittedBox.getSize(fittedSize);
    this.controls.target.set(0, 0.06, 0);
    this.camera.position.set(0, fittedSize.y * 0.12 + 0.72, Math.max(5.2, fittedSize.z + 4.8));
    this.camera.lookAt(this.controls.target);
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#7f766c', 2.4));

    const key = new THREE.DirectionalLight('#fff4e8', 3.4);
    key.position.set(3.5, 5.8, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#b9d7ff', 1.7);
    rim.position.set(-4.5, 2.8, -3.2);
    this.scene.add(rim);
  }

  addFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.3, 72),
      new THREE.MeshStandardMaterial({ color: '#dedbd4', roughness: 0.76, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.58;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  applyAppearance(appearance) {
    if (!appearance) return;
    const appearanceKey = getAppearanceTextureKey(appearance);
    if (this.appearanceTexture && this.appearanceTextureKey === appearanceKey) return;
    const replacedBaseColorMaps = new Set(this.modelMaterials
      .map((material) => material.map)
      .filter((map) => map && map !== this.appearanceTexture));
    const texture = new THREE.CanvasTexture(createGarmentAppearanceCanvas(2048, appearance));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    this.disposeAppearanceTexture();
    this.appearanceTexture = texture;
    this.appearanceTextureKey = appearanceKey;
    this.modelMaterials.forEach((material) => {
      material.map = texture;
      material.needsUpdate = true;
    });
    replacedBaseColorMaps.forEach((map) => map.dispose());
    this.printColor = appearance.colors.number;
    this.redrawPrintTexture();
  }

  disposeAppearanceTexture() {
    if (!this.appearanceTexture) return;
    this.modelMaterials.forEach((material) => {
      if (material.map === this.appearanceTexture) material.map = null;
    });
    this.appearanceTexture.dispose();
    this.appearanceTexture = null;
    this.appearanceTextureKey = null;
  }

  applyMaterial(materialOptions) {
    if (!materialOptions) return;
    this.modelMaterials.forEach((material) => {
      if ('roughness' in material) {
        gsap.to(material, {
          roughness: materialOptions.roughness,
          metalness: materialOptions.metalness,
          duration: 0.45,
          ease: 'power2.out',
          overwrite: 'auto',
        });
      }
    });
  }

  resize() {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.syncPrintAnchor();
    this.renderer.render(this.scene, this.camera);
  };

  syncPrintAnchor() {
    const plane = this.printPlane;
    const anchor = plane
      ? getPrintSelectionRect(getPlaneProjectedCorners(plane, this.camera), this.host.getBoundingClientRect())
      : { visible: false };
    if (!hasPrintSelectionRectChanged(this.lastPrintAnchor, anchor)) return;
    this.lastPrintAnchor = anchor;
    this.onPrintAnchorChange?.(anchor);
  }

  disposeGroup(group) {
    disposeModelResources(group);
  }

  updatePrintLayer() {
    const printItems = this.state?.lighting && this.state.lighting !== 'none'
      ? getPrintItems(this.state?.overrides)
      : [];
    if (!printItems.length) {
      this.disposePrintLayer();
      return;
    }

    const ids = new Set(printItems.map((item) => item.id));
    this.printLayers.forEach((layer, id) => {
      if (ids.has(id)) return;
      this.disposePrintLayerEntry(layer);
      this.printLayers.delete(id);
    });
    printItems.forEach((item) => this.updatePrintLayerEntry(item));
  }

  updatePrintLayerEntry(item) {
    let layer = this.printLayers.get(item.id);
    if (!layer) {
      const texture = new THREE.CanvasTexture(makePrintCanvas(this.getPrintOptions(item)));
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.42), material);
      plane.renderOrder = 4;
      plane.userData.printId = item.id;
      this.scene.add(plane);
      layer = { material, plane, texture };
      this.printLayers.set(item.id, layer);
    }
    layer.texture.image = makePrintCanvas(this.getPrintOptions(item));
    layer.texture.needsUpdate = true;
    this.applyStoredPrintPlacement(layer.plane, item);
  }

  redrawPrintTexture() {
    getPrintItems(this.state?.overrides).forEach((item) => this.updatePrintLayerEntry(item));
  }

  getPrintOptions(item) {
    return {
      name: sanitizePrintText(item.name ?? 'PLAYER'),
      number: sanitizePrintText(item.number ?? '16'),
      color: this.printColor,
      raised: this.state?.lighting === 'raised-print',
    };
  }

  applyStoredPrintPlacement(plane, item) {
    const stored = item.placement ?? DEFAULT_PRINT_POSITION;
    plane.position.set(stored.x, stored.y, stored.z);
    if (stored.normal) {
      plane.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(stored.normal.x, stored.normal.y, stored.normal.z).normalize(),
      );
    } else {
      plane.quaternion.identity();
    }
    plane.rotateZ(THREE.MathUtils.degToRad(item.rotation ?? 0));
    plane.scale.setScalar(item.scale ?? 1);
  }

  disposePrintLayer() {
    this.printLayers.forEach((layer) => this.disposePrintLayerEntry(layer));
    this.printLayers.clear();
    this.activePrintId = null;
    this.isDraggingPrint = false;
    this.pendingPrintDrag = null;
    this.pendingDecorationDeselect = null;
    this.syncPrintAnchor();
  }

  disposePrintLayerEntry(layer) {
    this.scene.remove(layer.plane);
    layer.plane.geometry.dispose();
    layer.material.dispose();
    layer.texture.dispose();
  }

  handlePointerDown = (event) => {
    const printHit = this.pickPrint(event);
    const handledDecoration = !printHit && this.decorationEditor?.handlePointerDown(event);
    const action = getPrintPointerDownAction({ hasPrintHit: Boolean(printHit), handledDecoration: Boolean(handledDecoration) });
    if (action === 'select-print') {
      this.pendingDecorationDeselect = null;
      this.activePrintId = printHit.object.userData.printId;
      this.onPrintSelectionChange?.(this.activePrintId);
      this.syncPrintAnchor();
      if (this.isPrintEditable()) {
        this.pendingPrintDrag = { x: event.clientX, y: event.clientY };
      }
      event.preventDefault();
      return;
    }
    if (action === 'decoration') {
      this.pendingDecorationDeselect = null;
      this.controls.enabled = false;
      event.preventDefault();
      return;
    }
    this.pendingPrintDrag = null;
    this.onPrintSelectionChange?.(null);
    this.pendingDecorationDeselect = this.decorationEditor?.selectedId
      ? { x: event.clientX, y: event.clientY }
      : null;
    if (!this.pendingDecorationDeselect) this.decorationEditor?.clearSelection();
    this.lastPrintAnchor = null;
    this.onPrintAnchorChange?.({ visible: false });
  };

  handlePointerMove = (event) => {
    if (this.decorationEditor?.handlePointerMove(event)) {
      event.preventDefault();
      return;
    }
    if (this.pendingDecorationDeselect
      && hasExceededPrintDragThreshold(this.pendingDecorationDeselect, event)) {
      this.pendingDecorationDeselect = null;
    }
    if (!this.isDraggingPrint && this.pendingPrintDrag) {
      if (!hasExceededPrintDragThreshold(this.pendingPrintDrag, event)) return;
      this.pendingPrintDrag = null;
      this.isDraggingPrint = true;
      this.controls.enabled = false;
    }
    if (!this.isDraggingPrint || !this.printPlane) return;
    const hit = this.pickJersey(event);
    if (!hit) return;
    event.preventDefault();
    this.placePrintAtIntersection(hit, false);
  };

  handlePointerUp = () => {
    if (this.decorationEditor?.handlePointerUp()) {
      this.pendingDecorationDeselect = null;
      this.controls.enabled = shouldEnableOrbitControls({
        isDraggingDecoration: this.decorationEditor.isEditing(),
        isDraggingPrint: this.isDraggingPrint,
      });
      return;
    }
    const shouldDeselectDecoration = Boolean(this.pendingDecorationDeselect);
    this.pendingDecorationDeselect = null;
    if (shouldDeselectDecoration) this.decorationEditor?.clearSelection();
    this.pendingPrintDrag = null;
    if (!this.isDraggingPrint) return;
    this.isDraggingPrint = false;
    this.controls.enabled = true;
    this.emitPrintPlacement();
  };

  handlePointerCancel = () => {
    this.decorationEditor?.handlePointerUp();
    this.pendingDecorationDeselect = null;
    this.pendingPrintDrag = null;
    this.isDraggingPrint = false;
    this.controls.enabled = shouldEnableOrbitControls({
      isDraggingDecoration: this.decorationEditor?.isEditing(),
      isDraggingPrint: this.isDraggingPrint,
    });
  };

  isPrintEditable() {
    return this.state?.lighting && this.state.lighting !== 'none' && this.decorationMeshes.length > 0;
  }

  pickJersey(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.decorationMeshes, false)[0] ?? null;
  }

  pickPrint(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects([...this.printLayers.values()].map((layer) => layer.plane), false)[0] ?? null;
  }

  placePrintAtIntersection(hit, animate = false) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    const position = hit.point.clone().addScaledVector(normal, 0.018);
    const nextQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    if (animate) {
      gsap.to(this.printPlane.position, {
        x: position.x,
        y: position.y,
        z: position.z,
        duration: 0.16,
        ease: 'power2.out',
      });
    } else {
      this.printPlane.position.copy(position);
    }
    this.printPlane.quaternion.copy(nextQuaternion);
  }

  emitPrintPlacement() {
    if (!this.printPlane || !this.onStatePatch) return;
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.printPlane.quaternion).normalize();
    const placement = {
      x: roundPlacement(this.printPlane.position.x),
      y: roundPlacement(this.printPlane.position.y),
      z: roundPlacement(this.printPlane.position.z),
      normal: {
        x: roundPlacement(normal.x),
        y: roundPlacement(normal.y),
        z: roundPlacement(normal.z),
      },
    };
    const printItems = getPrintItems(this.state?.overrides);
    const activePrintId = this.activePrintId ?? printItems[0]?.id;
    const nextItems = activePrintId
      ? patchPrintItem(printItems, activePrintId, { placement })
      : printItems;
    this.onStatePatch({
      overrides: {
        printItems: nextItems,
        ...legacyFirstItemFields(nextItems),
      },
    });
  }

  patchSelectedDecoration(patch) {
    const changed = this.decorationEditor?.patchSelected(patch);
    if (changed) this.controls.enabled = false;
    return changed;
  }
}

function preventContextMenu(event) {
  event.preventDefault();
}

function cloneMaterials(material) {
  if (Array.isArray(material)) {
    return material.map((item) => item.clone());
  }
  return material?.clone();
}

function setGarmentMaterialDefaults(material) {
  if (Array.isArray(material)) {
    material.forEach(setGarmentMaterialDefaults);
    return;
  }
  if (!material) return;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.opacity = 1;
  material.needsUpdate = true;
}

function collectMaterials(material, materials) {
  if (Array.isArray(material)) {
    material.forEach((item) => collectMaterials(item, materials));
    return;
  }
  if (material) materials.push(material);
}

function disposeMaterials(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterials);
    return;
  }
  material.map?.dispose();
  material.normalMap?.dispose();
  material.roughnessMap?.dispose();
  material.metalnessMap?.dispose();
  material.dispose();
}

function makePrintCanvas({ color, name, number, raised }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 420;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  if (raised) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 5;
  }
  ctx.font = '900 96px Arial, sans-serif';
  ctx.fillText(name || 'PLAYER', canvas.width / 2, 95);
  ctx.font = '900 210px Arial, sans-serif';
  ctx.fillText(number || '16', canvas.width / 2, 260);
  return canvas;
}

function sanitizePrintText(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9 .-]/g, '').slice(0, 14);
}

function roundPlacement(value) {
  return Math.round(value * 10000) / 10000;
}

function getPlaneProjectedCorners(plane, camera) {
  plane.geometry.computeBoundingBox();
  const bounds = plane.geometry.boundingBox;
  if (!bounds) return [];

  return [
    new THREE.Vector3(bounds.min.x, bounds.min.y, 0),
    new THREE.Vector3(bounds.max.x, bounds.min.y, 0),
    new THREE.Vector3(bounds.min.x, bounds.max.y, 0),
    new THREE.Vector3(bounds.max.x, bounds.max.y, 0),
  ].map((corner) => plane.localToWorld(corner).project(camera));
}

function distanceBetweenPlacements(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function disposeModelResources(group) {
  group.traverse((item) => {
    if (item.geometry) item.geometry.dispose();
    if (item.material) disposeMaterials(item.material);
  });
}

function getAppearanceTextureKey(appearance) {
  return JSON.stringify({
    template: appearance.template,
    colors: Object.entries(appearance.colors ?? {}).sort(([first], [second]) => first.localeCompare(second)),
  });
}
