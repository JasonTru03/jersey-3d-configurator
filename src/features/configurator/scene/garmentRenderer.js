import gsap from 'gsap';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecorationEditor } from './decorationEditor.js';
import { getPrintItems, legacyFirstItemFields, patchPrintItem } from '../config/printItems.js';
import { getCustomTextItems, patchCustomTextItem } from '../config/customTextItems.js';
import {
  findPersonalizationItem,
  getRenderablePersonalizationItems,
  getSelectablePersonalizationItems,
} from '../config/personalizationItems.js';
import { createGarmentAppearanceCanvas } from './garmentAppearanceTexture.js';
import { bakeBottomPatternAtlas } from './bottomPatternBaker.js';
import { bakeProductionAtlas } from './productionAtlasBaker.js';
import { captureProductionPreviews } from './productionPreviewCapture.js';
import { CUSTOM_TEXT_CANVAS_ASPECT, makeCustomTextCanvas } from './customTextTexture.js';
import { selectGarmentPatternMeshes } from './modelProjection.js';
import {
  findNearestFacingIntersection,
  findVisibleElementIntersection,
} from './surfaceVisibility.js';
import {
  fitPersonalizationDecalToSurface,
  getPersonalizationAlphaMask,
  getPersonalizationDecalOrientation,
  getPersonalizationSurfaceFromIntersection,
  projectPersonalizationCenterOntoSurface,
  resolvePersonalizationSurface,
  supportsPersonalizationDecalMesh,
} from './personalizationDecal.js';
import {
  canonicalizeProductionValue,
  normalizeProductionState,
} from '../designs/productionFingerprint.js';
import {
  MODEL_UV_LAYOUTS,
  getModelUvLayout,
  validateModelUvLayout,
} from '../config/modelUvLayouts.js';

const DEFAULT_PRINT_POSITION = { x: 0, y: 0.36, z: 0.5 };
const DEFAULT_PRINT_NORMAL = { x: 0, y: 0, z: 1 };
const DECORATION_MESH_NAME_PATTERN = /cloth|fabric|body/i;
const MIN_PRINT_COPY_DISTANCE = 0.24;
const PRINT_DRAG_THRESHOLD = 4;
const MIN_PERSONALIZATION_UV_COVERAGE = 0.985;
const MIN_PERSONALIZATION_SCALE = 0.55;

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
  if (projectedCorners.length < 3) return { visible: false };
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
    this.onStateNormalize = options.onStateNormalize;
    this.onPrintAnchorChange = options.onPrintAnchorChange;
    this.onPrintSelectionChange = options.onPrintSelectionChange;
    this.onError = options.onError;
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
    this.bottomPatternTexture = null;
    this.bottomPatternKey = null;
    this.bottomPatternRequest = Symbol('initial-bottom-pattern');
    this.bottomPatternPendingKey = null;
    this.modelReadiness = createModelReadiness();
    this.modelReadiness.reject(new Error('服装模型尚未开始加载。'));
    this.modelMeshes = [];
    this.decorationMeshes = [];
    this.patternMeshes = [];
    this.modelUvLayout = null;
    this.modelUvLayoutKey = null;
    this.textureLoader = new THREE.TextureLoader();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.printLayers = new Map();
    this.activePrintId = null;
    this.lastPrintAnchor = null;
    this.isDraggingPrint = false;
    this.pendingPrintDrag = null;
    this.activePrintDrag = null;
    this.rotationPreviewKey = null;
    this.pendingPersonalizationConstraints = new Map();
    this.personalizationNormalizationBatch = null;
    this.personalizationMutationDisabled = false;
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

  get printLayer() {
    if (this.activePrintId !== null) {
      return this.printLayers.get(this.activePrintId) ?? null;
    }
    return this.printLayers.values().next().value ?? null;
  }

  get printPlane() {
    return this.printLayer?.plane ?? null;
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
    const modelIdentity = modelUrl ? getModelLoadIdentity(product.model) : null;
    if (modelUrl && modelIdentity !== this.currentModelIdentity) {
      this.currentModelUrl = modelUrl;
      this.currentModelIdentity = modelIdentity;
      this.loadModel(modelUrl);
    }

    this.applyAppearance(selected.appearance);
    this.applyMaterial(selected.material.material);
    this.updateBottomPattern();
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
      front: { position: { x: 0, y: 1.8, z: 5.4 }, target: { x: 0, y: 0.7, z: 0 } },
      back: { position: { x: 0, y: 1.8, z: -5.4 }, target: { x: 0, y: 0.7, z: 0 } },
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
    this.modelReadiness?.reject(new Error('3D 渲染器已关闭。'));
    this.bottomPatternRequest = Symbol('disposed-bottom-pattern');
    this.bottomPatternPendingKey = null;
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
    this.disposeBottomPatternTexture();
    this.disposeGroup(this.root);
    this.disposePrintLayer();
    this.decorationEditor?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  async loadModel(modelUrl) {
    this.cancelPersonalizationRotationPreview();
    if (this.isDraggingPrint) {
      this.restorePrintLayerFromState(this.printLayers.get(this.activePrintId));
    }
    this.pendingPrintDrag = null;
    this.activePrintDrag = null;
    this.isDraggingPrint = false;
    this.controls.enabled = true;
    const loadToken = Symbol(modelUrl);
    this.loadToken = loadToken;
    this.modelReadiness?.reject(new Error('服装模型加载请求已被替换。'));
    const modelReadiness = createModelReadiness();
    this.modelReadiness = modelReadiness;
    this.bottomPatternRequest = Symbol('model-loading-bottom-pattern');
    this.bottomPatternPendingKey = null;
    const requestedModel = this.product?.model;
    let stagedAppearanceTexture = null;
    let stagedModel = null;
    try {
      const gltf = await this.loader.loadAsync(modelUrl);
      if (this.loadToken !== loadToken) {
        modelReadiness.reject(new Error('服装模型加载请求已被替换。'));
        disposeModelResources(gltf.scene);
        return;
      }

      stagedModel = gltf.scene;
      const stagedModelMaterials = [];
      const stagedModelMeshes = [];
      stagedModel.traverse((item) => {
        if (!item.isMesh) return;
        item.castShadow = true;
        item.receiveShadow = true;
        item.material = cloneMaterials(item.material);
        setGarmentMaterialDefaults(item.material);
        collectMaterials(item.material, stagedModelMaterials);
        stagedModelMeshes.push(item);
      });

      const stagedDecorationMeshes = selectDecorationMeshes(stagedModelMeshes);
      const stagedPatternMeshes = selectGarmentPatternMeshes(stagedModelMeshes);
      const stagedModelUvLayout = resolveModelUvLayout(requestedModel);
      validateModelUvLayout(stagedModelUvLayout, stagedPatternMeshes);
      const stagedModelUvLayoutKey = getModelUvLayoutIdentity(requestedModel, stagedModelUvLayout);
      const appearance = this.selected?.appearance;
      const stagedAppearanceTextureKey = appearance
        ? getAppearanceTextureKey(appearance, stagedModelUvLayoutKey)
        : null;
      const replacedBaseColorMaps = appearance
        ? new Set(stagedModelMaterials.map((material) => material.map).filter(Boolean))
        : new Set();
      if (appearance) {
        const canvas = createGarmentAppearanceCanvas(2048, appearance, {
          modelMeshes: stagedPatternMeshes,
          uvLayout: stagedModelUvLayout,
        });
        stagedAppearanceTexture = new THREE.CanvasTexture(canvas);
        stagedAppearanceTexture.colorSpace = THREE.SRGBColorSpace;
        stagedAppearanceTexture.flipY = false;
      }

      const previousModels = [...this.modelGroup.children];
      this.disposeBottomPatternTexture();
      this.disposeAppearanceTexture();
      this.modelGroup.clear();
      this.modelMaterials = stagedModelMaterials;
      this.modelMeshes = stagedModelMeshes;
      this.decorationMeshes = stagedDecorationMeshes;
      this.patternMeshes = stagedPatternMeshes;
      this.modelUvLayout = stagedModelUvLayout;
      this.modelUvLayoutKey = stagedModelUvLayoutKey;
      this.appearanceTexture = stagedAppearanceTexture;
      this.appearanceTextureKey = stagedAppearanceTextureKey;
      if (stagedAppearanceTexture) {
        stagedModelMaterials.forEach((material) => {
          material.map = stagedAppearanceTexture;
          material.needsUpdate = true;
        });
      }
      this.modelGroup.add(stagedModel);
      previousModels.forEach(disposeModelResources);
      replacedBaseColorMaps.forEach((map) => map.dispose());
      stagedAppearanceTexture = null;
      const model = stagedModel;
      stagedModel = null;

      this.fitModel(model);
      this.modelGroup.updateMatrixWorld(true);
      this.decorationEditor.setGarmentMeshes(this.decorationMeshes);
      this.decorationEditor.update(
        this.state?.overrides?.decorations ?? [],
        this.state?.overrides?.activeDecorationId,
        this.product?.decorationPresets ?? [],
      );
      if (appearance) {
        this.printColor = appearance.colors.number;
        this.redrawPrintTexture();
      }
      this.applyMaterial(this.selected?.material?.material);
      await this.updateBottomPattern();
      this.updatePrintLayer();
      modelReadiness.resolve();
      gsap.fromTo(model.scale, { x: model.scale.x * 0.94, y: model.scale.y * 0.94, z: model.scale.z * 0.94 }, {
        x: model.scale.x,
        y: model.scale.y,
        z: model.scale.z,
        duration: 0.55,
        ease: 'power2.out',
      });
    } catch (error) {
      stagedAppearanceTexture?.dispose();
      if (stagedModel) disposeModelResources(stagedModel);
      if (this.loadToken === loadToken) {
        const reportedError = new Error('服装模型加载失败。', { cause: error });
        modelReadiness.reject(reportedError);
        try {
          this.onError?.(reportedError);
        } catch (callbackError) {
          console.error('Unable to report garment model loading error.', callbackError);
        }
        console.error(`Unable to load garment model: ${modelUrl}`, error);
      }
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
    const appearanceKey = getAppearanceTextureKey(appearance, this.modelUvLayoutKey);
    if (this.appearanceTexture && this.appearanceTextureKey === appearanceKey) return;
    const replacedBaseColorMaps = new Set(this.modelMaterials
      .map((material) => material.map)
      .filter((map) => map && map !== this.appearanceTexture && map !== this.bottomPatternTexture));
    const texture = new THREE.CanvasTexture(createGarmentAppearanceCanvas(2048, appearance, {
      modelMeshes: this.patternMeshes,
      uvLayout: this.modelUvLayout,
    }));
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

  setPersonalizationMutationDisabled(disabled) {
    this.personalizationMutationDisabled = Boolean(disabled);
    if (!this.personalizationMutationDisabled) return;
    this.cancelPersonalizationRotationPreview();
    if (this.isDraggingPrint) {
      this.restorePrintLayerFromState(this.printLayers.get(this.activePrintId));
    }
    this.pendingPrintDrag = null;
    this.activePrintDrag = null;
    this.isDraggingPrint = false;
    this.controls.enabled = true;
  }

  async updateBottomPattern() {
    const pattern = this.state?.overrides?.bottomPattern;
    const sourceRef = pattern?.source?.assetRef;
    const key = getBottomPatternKey(pattern);
    if (!pattern?.enabled || !sourceRef || !this.patternMeshes.length) {
      this.bottomPatternRequest = Symbol('disabled-bottom-pattern');
      this.bottomPatternPendingKey = null;
      this.disposeBottomPatternTexture();
      return;
    }
    if (this.bottomPatternTexture && this.bottomPatternKey === key) {
      this.applyBottomPatternTexture(this.bottomPatternTexture);
      return;
    }
    if (this.bottomPatternPendingKey === key) return;

    const request = Symbol(key);
    this.bottomPatternRequest = request;
    this.bottomPatternPendingKey = key;
    try {
      const sourceTexture = await this.textureLoader.loadAsync(sourceRef);
      const texture = await this.createBottomPatternTexture(pattern, sourceTexture);
      if (this.bottomPatternRequest !== request) {
        texture.dispose();
        return;
      }
      this.disposeBottomPatternTexture();
      this.bottomPatternTexture = texture;
      this.bottomPatternKey = key;
      this.applyBottomPatternTexture(texture);
      const bakeMetadata = texture.userData?.bottomPatternBakeMetadata;
      if (bakeMetadata) this.onStatePatch?.({ overrides: { bottomPattern: { bakeMetadata } } });
    } catch (error) {
      if (this.bottomPatternRequest === request) console.error(`Unable to bake bottom pattern: ${sourceRef}`, error);
    } finally {
      if (this.bottomPatternRequest === request) this.bottomPatternPendingKey = null;
    }
  }

  async createBottomPatternTexture(pattern, sourceTexture) {
    const { blob, canvas, metadata } = await bakeBottomPatternAtlas({
      meshEntries: this.patternMeshes,
      pattern: {
        ...pattern,
        sourceHash: pattern.source?.assetRef,
        projectionId: pattern.modelProjectionId,
      },
      sourceTexture,
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.userData.bottomPatternBakeMetadata = metadata;
    texture.userData.bottomPatternBlob = blob;
    return texture;
  }

  async ensureLatestBottomPatternBake() {
    const pattern = this.state?.overrides?.bottomPattern;
    if (!pattern?.enabled) throw new Error('Enable a bottom pattern before adding this design to cart.');
    await this.updateBottomPattern();
    while (this.bottomPatternPendingKey) await new Promise((resolve) => setTimeout(resolve, 10));
    const texture = this.bottomPatternTexture;
    const metadata = texture?.userData?.bottomPatternBakeMetadata;
    const blob = texture?.userData?.bottomPatternBlob;
    if (!blob || !metadata) throw new Error('The latest UV atlas is not ready.');
    return { blob, metadata };
  }

  async waitForProductionReady() {
    await this.modelReadiness?.promise;
    await this.decorationEditor?.waitForTextures?.();
    await this.updateBottomPattern();
    while (this.bottomPatternPendingKey) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!this.appearanceTexture || !this.modelMeshes.length) {
      throw new Error('服装模型尚未准备完成。');
    }
  }

  async prepareProductionArtifacts({ model, stateSnapshot }) {
    await this.waitForProductionReady();
    this.assertProductionSnapshot(model, stateSnapshot);

    const appearanceCanvas = createGarmentAppearanceCanvas(
      model.uvAtlasSize,
      this.selected.appearance,
      { modelMeshes: this.patternMeshes, uvLayout: this.modelUvLayout },
    );
    const legacyPatternCanvas = this.state.overrides?.bottomPattern?.enabled
      ? this.bottomPatternTexture?.image
      : null;
    if (this.state.overrides?.bottomPattern?.enabled && !legacyPatternCanvas) {
      throw new Error('旧版连续底纹尚未准备完成。');
    }
    const atlas = await bakeProductionAtlas({
      appearanceCanvas,
      atlasSize: model.uvAtlasSize,
      garmentMeshes: this.decorationMeshes,
      layers: this.getProductionLayers(),
      legacyPatternCanvas,
    });
    const previews = await captureProductionPreviews({
      camera: this.camera,
      controls: this.controls,
      renderer: this.renderer,
      scene: this.scene,
      setProductionCaptureMode: (enabled) => this.setProductionCaptureMode(enabled),
    });

    this.assertProductionSnapshot(model, stateSnapshot);
    return {
      atlas,
      legacyBakeMetadata: this.bottomPatternTexture
        ?.userData?.bottomPatternBakeMetadata ?? null,
      previews,
    };
  }

  assertProductionSnapshot(model, stateSnapshot) {
    const currentModel = this.product?.model;
    const modelMatches = (
      model?.id === currentModel?.id
      && model?.version === currentModel?.version
      && model?.uvExportVersion === currentModel?.uvExportVersion
      && model?.uvAtlasSize === currentModel?.uvAtlasSize
      && getModelLayoutSnapshotIdentity(model) === getModelLayoutSnapshotIdentity(currentModel)
    );
    const stateMatches = canonicalizeProductionValue(
      normalizeProductionState(stateSnapshot),
    ) === canonicalizeProductionValue(
      normalizeProductionState(this.state),
    );
    if (!modelMatches || !stateMatches) {
      throw new Error('设计已发生变化，请重新保存。');
    }
  }

  setProductionCaptureMode(enabled) {
    this.printLayers.forEach((layer) => {
      const plane = layer.plane;
      if (enabled) {
        if (!Object.hasOwn(plane.userData, 'productionCaptureVisible')) {
          plane.userData.productionCaptureVisible = plane.visible;
        }
        plane.visible = false;
        return;
      }
      if (typeof plane.userData.productionCaptureVisible === 'boolean') {
        plane.visible = plane.userData.productionCaptureVisible;
      }
      delete plane.userData.productionCaptureVisible;
    });
    this.decorationEditor?.setProductionCaptureMode?.(enabled);
  }

  applyBottomPatternTexture(texture) {
    collectMeshMaterials(this.patternMeshes).forEach((material) => {
      material.map = texture;
      material.needsUpdate = true;
    });
  }

  disposeBottomPatternTexture() {
    if (!this.bottomPatternTexture) return;
    collectMeshMaterials(this.patternMeshes).forEach((material) => {
      if (material.map === this.bottomPatternTexture) {
        material.map = this.appearanceTexture;
        material.needsUpdate = true;
      }
    });
    this.bottomPatternTexture.dispose();
    this.bottomPatternTexture = null;
    this.bottomPatternKey = null;
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
    const layer = this.printLayer;
    const anchor = layer?.plane
      ? getPrintSelectionRect(
          getPersonalizationProjectedPoints(layer, this.camera),
          this.host.getBoundingClientRect(),
        )
      : { visible: false };
    if (!hasPrintSelectionRectChanged(this.lastPrintAnchor, anchor)) return;
    this.lastPrintAnchor = anchor;
    this.onPrintAnchorChange?.(anchor);
  }

  disposeGroup(group) {
    disposeModelResources(group);
  }

  updatePrintLayer() {
    const printItems = this.getRenderablePrintItems();
    const keys = new Set(printItems.map((item) => item.key));
    const selectableKeys = new Set(
      getSelectablePersonalizationItems(this.state).map((item) => item.key),
    );
    const activeLayerWasRemoved = this.activePrintId !== null && !keys.has(this.activePrintId);
    const activeLayerWillBeRestored = this.activePrintId !== null
      && keys.has(this.activePrintId)
      && !this.printLayers.has(this.activePrintId);
    this.printLayers.forEach((layer, key) => {
      if (keys.has(key)) return;
      this.disposePrintLayerEntry(layer);
      this.printLayers.delete(key);
      this.pendingPersonalizationConstraints.delete(key);
      if (this.rotationPreviewKey === key) this.rotationPreviewKey = null;
    });
    this.personalizationNormalizationBatch = new Map();
    printItems.forEach((item) => this.updatePrintLayerEntry(item));
    this.flushPersonalizationNormalizationBatch();
    if (activeLayerWasRemoved || !printItems.length) {
      this.isDraggingPrint = false;
      this.pendingPrintDrag = null;
      this.activePrintDrag = null;
      this.controls.enabled = true;
      this.syncPrintAnchor();
      if (activeLayerWasRemoved && !selectableKeys.has(this.activePrintId)) {
        this.activePrintId = null;
      }
    }
    if (activeLayerWillBeRestored) this.syncPrintAnchor();
  }

  updatePrintLayerEntry(item) {
    let layer = this.printLayers.get(item.key);
    const renderKey = this.getPrintRenderKey(item);
    if (!layer) {
      const canvas = item.itemKind === 'text'
        ? makeCustomTextCanvas(item)
        : makePrintCanvas(this.getPrintOptions(item));
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, side: THREE.FrontSide });
      const decalMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.FrontSide,
      });
      const planeHeight = item.itemKind === 'text' ? 1.05 / CUSTOM_TEXT_CANVAS_ASPECT : 0.42;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.05, planeHeight), material);
      const decal = new THREE.Mesh(new THREE.BufferGeometry(), decalMaterial);
      plane.renderOrder = 4;
      decal.renderOrder = 8;
      decal.visible = false;
      plane.userData.printId = item.key;
      plane.userData.personalizationKey = item.key;
      plane.userData.itemKind = item.itemKind;
      plane.userData.sourceId = item.sourceId;
      this.scene.add(plane);
      this.scene.add(decal);
      layer = {
        decal,
        decalFallback: false,
        decalKey: null,
        decalMaterial,
        height: planeHeight,
        itemKind: item.itemKind,
        alphaMask: getPersonalizationAlphaMask(canvas),
        material,
        plane,
        renderKey,
        texture,
        width: 1.05,
      };
      this.printLayers.set(item.key, layer);
    } else if (layer.renderKey !== renderKey) {
      if (item.itemKind === 'text') {
        makeCustomTextCanvas(item, layer.texture.image);
      } else {
        makePrintCanvas(this.getPrintOptions(item), layer.texture.image);
      }
      layer.renderKey = renderKey;
      layer.texture.needsUpdate = true;
      layer.alphaMask = getPersonalizationAlphaMask(layer.texture.image);
    }
    this.applyStoredPrintPlacement(layer.plane, item);
    if (this.rotationPreviewKey === item.key) {
      layer.plane.material.opacity = 1;
      layer.decal.visible = false;
      return;
    }
    this.syncPersonalizationDecal(layer, item);
  }

  redrawPrintTexture() {
    this.getRenderablePrintItems().forEach((item) => this.updatePrintLayerEntry(item));
  }

  getRenderablePrintItems() {
    return getRenderablePersonalizationItems(this.state);
  }

  getProductionLayers() {
    const personalizationLayers = [...this.printLayers.values()]
      .filter((layer) => (
        layer.decal?.visible
        && layer.decal.geometry?.attributes?.position?.count > 0
        && layer.decal.userData?.productionLayer
      ))
      .map((layer) => ({
        ...layer.decal.userData.productionLayer,
        geometry: layer.decal.geometry,
        renderOrder: layer.decal.renderOrder,
        surface: layer.decal,
        textureSource: layer.texture.image,
      }));
    const artworkLayers = this.decorationEditor?.getProductionLayers?.() ?? [];
    return [...personalizationLayers, ...artworkLayers]
      .map((layer, index) => ({ index, layer }))
      .sort((first, second) => (
        (first.layer.renderOrder ?? 0) - (second.layer.renderOrder ?? 0)
        || (first.layer.surface?.id ?? 0) - (second.layer.surface?.id ?? 0)
        || first.index - second.index
      ))
      .map(({ layer }) => layer);
  }

  getPrintRenderKey(item) {
    if (item.itemKind === 'text') {
      return JSON.stringify([
        item.text,
        item.fontPreset,
        item.fillColor,
        item.outlineEnabled,
        item.outlineColor,
        item.letterSpacing,
      ]);
    }
    const options = this.getPrintOptions(item);
    return JSON.stringify([options.name, options.number, options.color, options.raised]);
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
    plane.quaternion.copy(getPersonalizationDecalOrientation(
      stored.normal ?? DEFAULT_PRINT_NORMAL,
      item.rotation ?? 0,
    ));
    plane.scale.setScalar(item.scale ?? 1);
    plane.userData.rotation = item.rotation ?? 0;
  }

  syncPersonalizationDecal(
    layer,
    item,
    placement = item.placement ?? DEFAULT_PRINT_POSITION,
    preferredSurface = null,
    options = {},
  ) {
    if (!layer || !item) return false;
    const requestedScale = item.scale ?? 1;
    const rotation = item.rotation ?? 0;
    const surface = preferredSurface && supportsPersonalizationDecalMesh(preferredSurface.mesh)
      ? preferredSurface
      : resolvePersonalizationSurface(this.decorationMeshes, placement, {
          height: layer.height,
          rotation,
          scale: requestedScale,
          width: layer.width,
        });
    if (!surface) {
      if (options.allowDefault !== false && !placementsEqual(placement, DEFAULT_PRINT_POSITION)) {
        const defaultItem = {
          ...item,
          placement: structuredClone(DEFAULT_PRINT_POSITION),
        };
        this.applyStoredPrintPlacement(layer.plane, defaultItem);
        return this.syncPersonalizationDecal(
          layer,
          defaultItem,
          DEFAULT_PRINT_POSITION,
          null,
          {
            ...options,
            allowDefault: false,
            normalizationSource: options.normalizationSource ?? item,
          },
        );
      }
      layer.plane.material.opacity = 1;
      layer.decal.visible = false;
      layer.decalKey = null;
      layer.decalFallback = true;
      return false;
    }

    const fit = fitPersonalizationDecalToSurface({
      alphaMask: layer.alphaMask,
      height: layer.height,
      meshes: this.decorationMeshes,
      minimumCoverage: MIN_PERSONALIZATION_UV_COVERAGE,
      minimumScale: MIN_PERSONALIZATION_SCALE,
      placement,
      rotation,
      scale: requestedScale,
      width: layer.width,
    });
    if (!fit) {
      const previous = layer.lastValidItem;
      if (previous && (
        previous.scale !== requestedScale
        || JSON.stringify(previous.placement) !== JSON.stringify(placement)
      )) {
        this.applyStoredPrintPlacement(layer.plane, previous);
        return this.syncPersonalizationDecal(
          layer,
          previous,
          previous.placement ?? DEFAULT_PRINT_POSITION,
          null,
          {
            ...options,
            allowDefault: false,
            normalizationSource: options.normalizationSource ?? item,
          },
        );
      }
      if (options.allowDefault !== false && !placementsEqual(placement, DEFAULT_PRINT_POSITION)) {
        const defaultItem = {
          ...item,
          placement: structuredClone(DEFAULT_PRINT_POSITION),
        };
        this.applyStoredPrintPlacement(layer.plane, defaultItem);
        return this.syncPersonalizationDecal(
          layer,
          defaultItem,
          DEFAULT_PRINT_POSITION,
          null,
          {
            ...options,
            allowDefault: false,
            normalizationSource: options.normalizationSource ?? item,
          },
        );
      }
      layer.plane.material.opacity = 1;
      layer.decal.visible = false;
      layer.decalFallback = true;
      return false;
    }
    const constrainedItem = fit.scale < requestedScale - 0.000001
      ? { ...item, scale: fit.scale }
      : item;
    const normalizationSource = options.normalizationSource ?? item;
    const needsNormalization = (
      constrainedItem.scale !== normalizationSource.scale
      || !placementsEqual(constrainedItem.placement, normalizationSource.placement)
    );
    if (needsNormalization) {
      if (options.normalize !== false) {
        this.publishPersonalizationConstraint(normalizationSource, constrainedItem);
      }
      this.applyStoredPrintPlacement(layer.plane, constrainedItem);
    } else {
      this.clearSatisfiedPersonalizationConstraint(item);
    }
    const scale = constrainedItem.scale ?? 1;
    const decalKey = JSON.stringify([
      (fit.surface.surfaces ?? [fit.surface]).map((entry) => [
        entry.mesh.uuid,
        entry.point.x,
        entry.point.y,
        entry.point.z,
        entry.normal.x,
        entry.normal.y,
        entry.normal.z,
        entry.depth ?? null,
      ]),
      rotation,
      scale,
      layer.width,
      layer.height,
      layer.renderKey,
    ]);
    if (layer.decalKey === decalKey && layer.decalFallback) return false;
    if (layer.decalKey !== decalKey) {
      const geometry = fit.geometry;
      layer.decal.geometry.dispose();
      layer.decal.geometry = geometry;
      layer.decalKey = decalKey;
      layer.decalFallback = false;
    } else {
      fit.geometry.dispose();
    }
    layer.lastValidItem = {
      ...constrainedItem,
      placement: constrainedItem.placement ? structuredClone(constrainedItem.placement) : null,
    };
    const garmentMeshes = [...new Set(
      (fit.surface.surfaces ?? [fit.surface])
        .map((entry) => entry.mesh)
        .filter(Boolean),
    )];
    layer.decal.userData.productionLayer = {
      garmentMeshes,
      id: item.key,
      kind: item.itemKind,
      label: item.itemKind === 'text'
        ? (item.text || item.key)
        : `${item.name || 'PLAYER'} #${item.number || '16'}`,
    };
    layer.plane.material.opacity = 0;
    layer.decal.visible = true;
    return true;
  }

  publishPersonalizationConstraint(item, constrainedItem) {
    if (!this.personalizationNormalizationBatch) {
      this.personalizationNormalizationBatch = new Map();
      this.personalizationNormalizationBatch.set(item.key, { constrainedItem, item });
      this.flushPersonalizationNormalizationBatch();
      return;
    }
    this.personalizationNormalizationBatch.set(item.key, { constrainedItem, item });
  }

  flushPersonalizationNormalizationBatch() {
    const batch = this.personalizationNormalizationBatch;
    this.personalizationNormalizationBatch = null;
    if (!batch?.size || !this.onStateNormalize) return;

    let customTextItems = getCustomTextItems(this.state?.overrides);
    let printItems = getPrintItems(this.state?.overrides);
    let hasCustomText = false;
    let hasPrint = false;
    batch.forEach(({ constrainedItem, item }) => {
      const patch = {
        placement: constrainedItem.placement,
        scale: constrainedItem.scale,
      };
      if (item.itemKind === 'text') {
        customTextItems = patchCustomTextItem(customTextItems, item.sourceId, patch);
        hasCustomText = true;
      } else {
        printItems = patchPrintItem(printItems, item.sourceId, patch);
        hasPrint = true;
      }
    });

    const overrides = {};
    if (hasCustomText) overrides.customTextItems = customTextItems;
    if (hasPrint) Object.assign(overrides, {
      printItems,
      ...legacyFirstItemFields(printItems),
    });
    this.onStateNormalize({ overrides });
    batch.forEach(({ constrainedItem, item }) => {
      this.pendingPersonalizationConstraints.set(item.key, JSON.stringify([
        constrainedItem.scale,
        constrainedItem.placement ?? null,
      ]));
    });
  }

  clearSatisfiedPersonalizationConstraint(item) {
    const signature = JSON.stringify([item.scale, item.placement ?? null]);
    if (this.pendingPersonalizationConstraints.get(item.key) === signature) {
      this.pendingPersonalizationConstraints.delete(item.key);
    }
  }

  setPrintLayerDragging(layer, dragging, preferredSurface = null) {
    if (!layer) return;
    if (dragging) {
      layer.plane.material.opacity = 1;
      layer.decal.visible = false;
      return;
    }
    const item = findPersonalizationItem(
      getSelectablePersonalizationItems(this.state),
      layer.plane.userData.personalizationKey,
    );
    if (!item) return;
    this.syncPersonalizationDecal(
      layer,
      item,
      this.getPrintPlanePlacement(layer.plane),
      preferredSurface,
    );
  }

  restorePrintLayerFromState(layer) {
    if (!layer) return false;
    const item = findPersonalizationItem(
      getSelectablePersonalizationItems(this.state),
      layer.plane.userData.personalizationKey,
    );
    if (!item) return false;
    this.applyStoredPrintPlacement(layer.plane, item);
    return this.syncPersonalizationDecal(layer, item);
  }

  beginPersonalizationRotation(key) {
    if (this.personalizationMutationDisabled) return false;
    if (this.rotationPreviewKey && this.rotationPreviewKey !== key) {
      this.cancelPersonalizationRotationPreview();
    }
    const layer = this.printLayers.get(key);
    if (!layer) return false;
    this.rotationPreviewKey = key;
    layer.plane.material.opacity = 1;
    layer.decal.visible = false;
    return true;
  }

  previewPersonalizationRotation(key, rotation) {
    if (this.rotationPreviewKey !== key) return false;
    const layer = this.printLayers.get(key);
    const item = findPersonalizationItem(getSelectablePersonalizationItems(this.state), key);
    const previewRotation = Number(rotation);
    if (!layer || !item || !Number.isFinite(previewRotation)) return false;
    this.applyStoredPrintPlacement(layer.plane, {
      ...item,
      rotation: ((previewRotation % 360) + 360) % 360,
    });
    this.syncPrintAnchor();
    return true;
  }

  endPersonalizationRotation(key, rotation) {
    if (this.rotationPreviewKey !== key) return false;
    this.rotationPreviewKey = null;
    const layer = this.printLayers.get(key);
    const item = findPersonalizationItem(getSelectablePersonalizationItems(this.state), key);
    if (!layer || !item) return false;
    const finalRotation = Number(rotation);
    const finalItem = Number.isFinite(finalRotation)
      ? { ...item, rotation: ((finalRotation % 360) + 360) % 360 }
      : item;
    return this.constrainPersonalizationItem(key, finalItem);
  }

  cancelPersonalizationRotationPreview() {
    const key = this.rotationPreviewKey;
    if (!key) return false;
    this.rotationPreviewKey = null;
    return this.restorePrintLayerFromState(this.printLayers.get(key));
  }

  beginPersonalizationResize(key) {
    if (this.personalizationMutationDisabled) return false;
    const layer = this.printLayers.get(key);
    if (!layer) return false;
    layer.plane.material.opacity = 1;
    layer.decal.visible = false;
    return true;
  }

  previewPersonalizationScale(key, scale) {
    const layer = this.printLayers.get(key);
    const item = findPersonalizationItem(getSelectablePersonalizationItems(this.state), key);
    const previewScale = Number(scale);
    if (!layer || !item || !Number.isFinite(previewScale)) return false;
    this.applyStoredPrintPlacement(layer.plane, { ...item, scale: previewScale });
    this.syncPrintAnchor();
    return true;
  }

  endPersonalizationResize(key, scale) {
    const layer = this.printLayers.get(key);
    const item = findPersonalizationItem(getSelectablePersonalizationItems(this.state), key);
    const finalScale = Number(scale);
    if (!layer || !item || !Number.isFinite(finalScale)) return null;
    return this.constrainPersonalizationItem(key, { ...item, scale: finalScale });
  }

  cancelPersonalizationResizePreview(key) {
    return this.restorePrintLayerFromState(this.printLayers.get(key));
  }

  constrainPersonalizationItem(key, patch, preferredSurface = null) {
    const layer = this.printLayers.get(key);
    const item = findPersonalizationItem(getSelectablePersonalizationItems(this.state), key);
    if (!layer || !item) return null;
    return this.finalizePersonalizationItem(
      layer,
      { ...item, ...patch },
      preferredSurface,
    );
  }

  finalizePersonalizationItem(layer, item, preferredSurface = null) {
    if (!layer || !item) return null;
    this.applyStoredPrintPlacement(layer.plane, item);
    this.syncPersonalizationDecal(
      layer,
      item,
      item.placement ?? DEFAULT_PRINT_POSITION,
      preferredSurface,
      { normalize: false },
    );
    return layer.lastValidItem
      ? {
          ...layer.lastValidItem,
          placement: layer.lastValidItem.placement
            ? structuredClone(layer.lastValidItem.placement)
            : null,
        }
      : item;
  }

  getPrintPlanePlacement(plane) {
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(plane.quaternion).normalize();
    return {
      x: roundPlacement(plane.position.x),
      y: roundPlacement(plane.position.y),
      z: roundPlacement(plane.position.z),
      normal: {
        x: roundPlacement(normal.x),
        y: roundPlacement(normal.y),
        z: roundPlacement(normal.z),
      },
    };
  }

  disposePrintLayer() {
    this.printLayers.forEach((layer) => this.disposePrintLayerEntry(layer));
    this.printLayers.clear();
    this.activePrintId = null;
    this.isDraggingPrint = false;
    this.pendingPrintDrag = null;
    this.activePrintDrag = null;
    this.rotationPreviewKey = null;
    this.pendingDecorationDeselect = null;
    this.syncPrintAnchor();
  }

  disposePrintLayerEntry(layer) {
    this.scene.remove(layer.plane);
    this.scene.remove(layer.decal);
    layer.plane.geometry.dispose();
    layer.decal.geometry.dispose();
    layer.material.dispose();
    layer.decalMaterial.dispose();
    layer.texture.dispose();
  }

  handlePointerDown = (event) => {
    const printHit = this.personalizationMutationDisabled ? null : this.pickPrint(event);
    const handledDecoration = !printHit && this.decorationEditor?.handlePointerDown(event);
    const action = getPrintPointerDownAction({ hasPrintHit: Boolean(printHit), handledDecoration: Boolean(handledDecoration) });
    if (action === 'select-print') {
      this.pendingDecorationDeselect = null;
      this.activePrintId = printHit.object.userData.printId;
      this.onPrintSelectionChange?.(this.activePrintId);
      this.syncPrintAnchor();
      if (this.isPrintEditable()) {
        printHit.object.updateMatrixWorld(true);
        this.pendingPrintDrag = {
          x: event.clientX,
          y: event.clientY,
          grabOffset: printHit.object.worldToLocal(printHit.point.clone()),
          rotation: printHit.object.userData.rotation ?? 0,
        };
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
    this.activePrintDrag = null;
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
      this.activePrintDrag = this.pendingPrintDrag;
      this.pendingPrintDrag = null;
      this.isDraggingPrint = true;
      this.controls.enabled = false;
      this.setPrintLayerDragging(this.printLayers.get(this.activePrintId), true);
    }
    if (!this.isDraggingPrint || !this.printPlane) return;
    const hit = this.pickJersey(event);
    if (!hit) return;
    event.preventDefault();
    const latestSurface = getPersonalizationSurfaceFromIntersection(hit);
    if (latestSurface) {
      this.activePrintDrag = { ...this.activePrintDrag, latestSurface };
    }
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
    const activeLayer = this.printLayers.get(this.activePrintId);
    const finalSurface = projectPersonalizationCenterOntoSurface(
      this.activePrintDrag?.latestSurface,
      activeLayer?.plane.position,
    );
    const activeItem = findPersonalizationItem(
      getSelectablePersonalizationItems(this.state),
      this.activePrintId,
    );
    const placement = activeLayer ? this.getPrintPlanePlacement(activeLayer.plane) : null;
    const finalItem = activeItem && placement
      ? this.finalizePersonalizationItem(
          activeLayer,
          { ...activeItem, placement },
          finalSurface,
        )
      : null;
    if (finalItem) this.emitPersonalizationItem(finalItem);
    this.activePrintDrag = null;
  };

  handlePointerCancel = () => {
    this.decorationEditor?.handlePointerCancel?.();
    this.pendingDecorationDeselect = null;
    this.pendingPrintDrag = null;
    this.activePrintDrag = null;
    this.isDraggingPrint = false;
    this.restorePrintLayerFromState(this.printLayers.get(this.activePrintId));
    this.controls.enabled = shouldEnableOrbitControls({
      isDraggingDecoration: this.decorationEditor?.isEditing(),
      isDraggingPrint: this.isDraggingPrint,
    });
  };

  isPrintEditable() {
    return !this.personalizationMutationDisabled
      && this.getRenderablePrintItems().length > 0
      && this.decorationMeshes.length > 0;
  }

  pickJersey(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return findNearestFacingIntersection(this.raycaster, this.decorationMeshes);
  }

  pickPrint(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return findVisibleElementIntersection({
      elements: [...this.printLayers.values()].map((layer) => layer.plane),
      garmentMeshes: this.decorationMeshes,
      raycaster: this.raycaster,
    });
  }

  placePrintAtIntersection(hit, animate = false) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    const targetGrabPoint = hit.point.clone().addScaledVector(normal, 0.018);
    const rotation = this.activePrintDrag?.rotation ?? this.printPlane.userData.rotation ?? 0;
    const nextQuaternion = getPersonalizationDecalOrientation(normal, rotation);
    const grabOffset = this.activePrintDrag?.grabOffset ?? new THREE.Vector3();
    const position = targetGrabPoint.sub(
      grabOffset.clone().multiply(this.printPlane.scale).applyQuaternion(nextQuaternion),
    );

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

  emitPersonalizationItem(activeItem) {
    if (this.personalizationMutationDisabled) return;
    if (!activeItem || !this.onStatePatch) return;
    const patch = {
      placement: activeItem.placement,
      rotation: activeItem.rotation,
      scale: activeItem.scale,
    };
    if (activeItem.itemKind === 'text') {
      this.onStatePatch((latestState) => ({
        overrides: {
          customTextItems: patchCustomTextItem(
            getCustomTextItems(latestState?.overrides),
            activeItem.sourceId,
            patch,
          ),
        },
      }));
      return;
    }
    this.onStatePatch((latestState) => {
      const nextItems = patchPrintItem(
        getPrintItems(latestState?.overrides),
        activeItem.sourceId,
        patch,
      );
      return {
        overrides: {
          printItems: nextItems,
          ...legacyFirstItemFields(nextItems),
        },
      };
    });
  }

  emitPrintPlacement() {
    if (this.personalizationMutationDisabled) return;
    const layer = this.printLayers.get(this.activePrintId);
    const activeItem = findPersonalizationItem(
      getSelectablePersonalizationItems(this.state),
      this.activePrintId,
    );
    if (!layer || !activeItem) return;
    const finalItem = this.finalizePersonalizationItem(layer, {
      ...activeItem,
      placement: this.getPrintPlanePlacement(layer.plane),
    });
    if (finalItem) this.emitPersonalizationItem(finalItem);
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

function collectMeshMaterials(meshes) {
  const materials = [];
  meshes.forEach((mesh) => collectMaterials(mesh.material, materials));
  return [...new Set(materials)];
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

function makePrintCanvas({ color, name, number, raised }, canvas = document.createElement('canvas')) {
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

function placementsEqual(first, second) {
  return JSON.stringify(first ?? null) === JSON.stringify(second ?? null);
}

function createModelReadiness() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  promise.catch(() => {});
  return { promise, reject, resolve };
}

function getPersonalizationProjectedPoints(layer, camera) {
  if (layer.decal?.visible) {
    const bounds = normalizeTextureBounds(layer.alphaMask?.bounds);
    const projectionKey = JSON.stringify([
      layer.decal.geometry?.uuid ?? null,
      layer.renderKey ?? null,
      bounds.minU,
      bounds.maxU,
      bounds.minV,
      bounds.maxV,
    ]);
    if (layer.selectionProjectionKey !== projectionKey) {
      layer.selectionProjectionKey = projectionKey;
      layer.selectionLocalPoints = getDecalAlphaLocalPoints(layer.decal.geometry, bounds);
    }
    const decalPoints = (layer.selectionLocalPoints ?? []).map((point) => (
      layer.decal.localToWorld(point.clone()).project(camera)
    ));
    if (decalPoints.length) return decalPoints;
  }
  return getPlaneProjectedCorners(layer.plane, camera, layer.alphaMask?.bounds);
}

function getDecalAlphaLocalPoints(geometry, bounds) {
  const position = geometry?.getAttribute?.('position');
  const uv = geometry?.getAttribute?.('uv');
  if (!position?.count || !uv?.count || position.count !== uv.count) return [];

  const points = [];
  const index = geometry.getIndex?.();
  const vertexIndex = (offset) => index ? index.getX(offset) : offset;
  const vertexCount = index ? index.count : position.count;
  for (let offset = 0; offset + 2 < vertexCount; offset += 3) {
    let polygon = [0, 1, 2].map((corner) => {
      const attributeIndex = vertexIndex(offset + corner);
      return {
        position: new THREE.Vector3().fromBufferAttribute(position, attributeIndex),
        u: uv.getX(attributeIndex),
        v: uv.getY(attributeIndex),
      };
    });
    polygon = clipUvPolygon(polygon, 'u', bounds.minU, true);
    polygon = clipUvPolygon(polygon, 'u', bounds.maxU, false);
    polygon = clipUvPolygon(polygon, 'v', bounds.minV, true);
    polygon = clipUvPolygon(polygon, 'v', bounds.maxV, false);
    polygon.forEach((vertex) => points.push(vertex.position));
  }
  return points;
}

function clipUvPolygon(polygon, axis, boundary, keepGreater) {
  if (!polygon.length) return polygon;
  const clipped = [];
  const isInside = (vertex) => keepGreater
    ? vertex[axis] >= boundary - 0.000001
    : vertex[axis] <= boundary + 0.000001;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentInside = isInside(current);
    const previousInside = isInside(previous);
    if (currentInside !== previousInside) {
      const denominator = current[axis] - previous[axis];
      const ratio = Math.abs(denominator) < 0.0000001
        ? 0
        : (boundary - previous[axis]) / denominator;
      clipped.push({
        position: previous.position.clone().lerp(current.position, ratio),
        u: THREE.MathUtils.lerp(previous.u, current.u, ratio),
        v: THREE.MathUtils.lerp(previous.v, current.v, ratio),
      });
    }
    if (currentInside) clipped.push(current);
  }
  return clipped;
}

function normalizeTextureBounds(textureBounds) {
  return {
    minU: Number.isFinite(textureBounds?.minU) ? textureBounds.minU : 0,
    maxU: Number.isFinite(textureBounds?.maxU) ? textureBounds.maxU : 1,
    minV: Number.isFinite(textureBounds?.minV) ? textureBounds.minV : 0,
    maxV: Number.isFinite(textureBounds?.maxV) ? textureBounds.maxV : 1,
  };
}

function getPlaneProjectedCorners(plane, camera, textureBounds = null) {
  plane.geometry.computeBoundingBox();
  const bounds = plane.geometry.boundingBox;
  if (!bounds) return [];

  const width = bounds.max.x - bounds.min.x;
  const height = bounds.max.y - bounds.min.y;
  const minU = Number.isFinite(textureBounds?.minU) ? textureBounds.minU : 0;
  const maxU = Number.isFinite(textureBounds?.maxU) ? textureBounds.maxU : 1;
  const minV = Number.isFinite(textureBounds?.minV) ? textureBounds.minV : 0;
  const maxV = Number.isFinite(textureBounds?.maxV) ? textureBounds.maxV : 1;
  const minX = bounds.min.x + width * minU;
  const maxX = bounds.min.x + width * maxU;
  const minY = bounds.min.y + height * minV;
  const maxY = bounds.min.y + height * maxV;

  return [
    new THREE.Vector3(minX, minY, 0),
    new THREE.Vector3(maxX, minY, 0),
    new THREE.Vector3(minX, maxY, 0),
    new THREE.Vector3(maxX, maxY, 0),
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

function getAppearanceTextureKey(appearance, modelUvLayoutKey = null) {
  return JSON.stringify({
    template: appearance.template,
    colors: Object.entries(appearance.colors ?? {}).sort(([first], [second]) => first.localeCompare(second)),
    modelUvLayout: modelUvLayoutKey ?? 'legacy',
  });
}

function getModelUvLayoutIdentity(model, layout) {
  const identity = model?.uvExportLayoutId ?? `${model?.id}@${model?.version}`;
  return `${identity}:v${layout.version}`;
}

function resolveModelUvLayout(model) {
  if (!model?.uvExportLayoutId) return getModelUvLayout(model);
  const layout = MODEL_UV_LAYOUTS[model.uvExportLayoutId];
  if (!layout) throw new Error(`模型 "${model.uvExportLayoutId}" 缺少 UV 裁片配置。`);
  return layout;
}

function getModelLoadIdentity(model) {
  const layoutIdentity = getModelLayoutIdentity(model);
  return JSON.stringify({
    glbUrl: model?.glbUrl ?? null,
    id: model?.id ?? null,
    version: model?.version ?? null,
    uvExportLayoutId: model?.uvExportLayoutId ?? null,
    layoutVersion: layoutIdentity.layoutVersion,
  });
}

function getModelLayoutSnapshotIdentity(model) {
  return JSON.stringify(getModelLayoutIdentity(model));
}

function getModelLayoutIdentity(model) {
  const layoutId = model?.uvExportLayoutId ?? `${model?.id}@${model?.version}`;
  return {
    layoutId,
    layoutVersion: MODEL_UV_LAYOUTS[layoutId]?.version ?? null,
    uvExportLayoutId: model?.uvExportLayoutId ?? null,
  };
}

function getBottomPatternKey(pattern) {
  if (!pattern?.enabled) return null;
  return JSON.stringify({
    source: pattern.source,
    transform: pattern.transform,
    projectionVersion: pattern.projectionVersion,
    modelProjectionId: pattern.modelProjectionId,
  });
}
