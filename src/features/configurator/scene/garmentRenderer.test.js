import { describe, expect, it, vi } from 'vitest';
const productionArtifactMocks = vi.hoisted(() => ({
  bakeProductionAtlas: vi.fn(),
  captureProductionPreviews: vi.fn(),
  createGarmentAppearanceCanvas: vi.fn(),
}));
vi.mock('gsap', () => ({
  default: {
    killTweensOf: vi.fn(),
    to: vi.fn(),
    fromTo: vi.fn(),
  },
}));
vi.mock('three', async () => {
  const actual = await vi.importActual('three');
  return {
    ...actual,
    WebGLRenderer: class {
      constructor() {
        this.domElement = document.createElement('canvas');
        this.shadowMap = {};
      }

      setPixelRatio() {}
      setSize() {}
      render() {}
      dispose() {}
    },
  };
});
vi.mock('./productionAtlasBaker.js', () => ({
  bakeProductionAtlas: productionArtifactMocks.bakeProductionAtlas,
}));
vi.mock('./productionPreviewCapture.js', () => ({
  captureProductionPreviews: productionArtifactMocks.captureProductionPreviews,
}));
vi.mock('./garmentAppearanceTexture.js', async () => {
  const actual = await vi.importActual('./garmentAppearanceTexture.js');
  return {
    ...actual,
    createGarmentAppearanceCanvas: productionArtifactMocks.createGarmentAppearanceCanvas,
  };
});
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
});
vi.stubGlobal('requestAnimationFrame', () => 1);

import * as THREE from 'three';
import gsap from 'gsap';
import { GarmentRenderer, getNextPrintPlacement, getPrintPointerDownAction, getPrintSelectionRect, hasExceededPrintDragThreshold, hasPrintSelectionRectChanged, selectDecorationMeshes, shouldEnableOrbitControls } from './garmentRenderer.js';
import { CUSTOM_TEXT_CANVAS_ASPECT } from './customTextTexture.js';
import { getPersonalizationDecalOrientation } from './personalizationDecal.js';

function createPointerRenderer({ selectedDecorationId = null, printHit = null, decorationHit = false } = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const renderer = new GarmentRenderer(host);
  renderer.pickPrint = vi.fn(() => printHit);
  renderer.decorationEditor = {
    selectedId: selectedDecorationId,
    handlePointerDown: vi.fn(() => decorationHit),
    handlePointerMove: vi.fn(() => false),
    handlePointerCancel: vi.fn(() => true),
    handlePointerUp: vi.fn(() => false),
    clearSelection: vi.fn(),
    isEditing: vi.fn(() => false),
    dispose: vi.fn(),
  };
  renderer.controls = { enabled: true, dispose: vi.fn() };
  renderer.isDraggingPrint = false;
  renderer.pendingPrintDrag = null;
  renderer.pendingDecorationDeselect = null;
  renderer.onPrintSelectionChange = vi.fn();
  renderer.onPrintAnchorChange = vi.fn();
  renderer.syncPrintAnchor = vi.fn();
  renderer.isPrintEditable = vi.fn(() => false);
  renderer.emitPrintPlacement = vi.fn();
  return renderer;
}

function pointerEvent(x, y) {
  return { clientX: x, clientY: y, preventDefault: vi.fn() };
}

function createRaycastPickerRenderer() {
  const renderer = Object.create(GarmentRenderer.prototype);
  const domElement = document.createElement('canvas');
  vi.spyOn(domElement, 'getBoundingClientRect').mockReturnValue({
    bottom: 100,
    height: 100,
    left: 0,
    right: 100,
    top: 0,
    width: 100,
    x: 0,
    y: 0,
    toJSON() {},
  });
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  renderer.renderer = { domElement };
  renderer.camera = camera;
  renderer.pointer = new THREE.Vector2();
  renderer.raycaster = new THREE.Raycaster();
  return renderer;
}

function makeModel(map) {
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map })));
  return model;
}

function makeConfiguredUvModel(map = null) {
  const model = new THREE.Group();
  ['Cloth_mesh_7', 'Cloth_mesh_4'].forEach((name) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ map }),
    );
    mesh.name = name;
    model.add(mesh);
  });
  return model;
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function enabledBottomPattern(id = 'pattern') {
  return {
    enabled: true,
    source: { kind: 'preset', id, assetRef: `${id}.png` },
    transform: { offset: { u: 0, v: 0 }, scale: 1, rotationDeg: 0, repeat: { u: 3, v: 4 } },
    projectionVersion: 1,
    modelProjectionId: 'chelsea-jersey-cylindrical-v1',
  };
}

function makeDisposableModel() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const map = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map });
  const model = new THREE.Group();
  model.add(new THREE.Mesh(geometry, material));
  return {
    model,
    geometryDispose: vi.spyOn(geometry, 'dispose'),
    materialDispose: vi.spyOn(material, 'dispose'),
    mapDispose: vi.spyOn(map, 'dispose'),
  };
}

function installTextCanvasContext() {
  const context = {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn((text) => ({ width: String(text).length * 40 })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  return context;
}

function resolveLastStatePatch(onStatePatch, state) {
  const patch = onStatePatch.mock.calls.at(-1)[0];
  return typeof patch === 'function' ? patch(state) : patch;
}

describe('garment decoration mesh selection', () => {
  it('disposes a stale model response after a newer model request wins', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const first = deferred();
    const second = deferred();
    const stale = makeDisposableModel();
    renderer.loader = { loadAsync: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };

    const firstLoad = renderer.loadModel('first.glb');
    const secondLoad = renderer.loadModel('second.glb');
    second.resolve({ scene: makeModel(new THREE.Texture()) });
    await secondLoad;
    first.resolve({ scene: stale.model });
    await firstLoad;

    expect(stale.geometryDispose).toHaveBeenCalledOnce();
    expect(stale.materialDispose).toHaveBeenCalledOnce();
    expect(stale.mapDispose).toHaveBeenCalledOnce();
    renderer.dispose();
  });

  it('disposes a model response that arrives after renderer disposal', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const pending = deferred();
    const stale = makeDisposableModel();
    renderer.loader = { loadAsync: vi.fn(() => pending.promise) };

    const load = renderer.loadModel('first.glb');
    renderer.dispose();
    pending.resolve({ scene: stale.model });
    await load;

    expect(stale.geometryDispose).toHaveBeenCalledOnce();
    expect(stale.materialDispose).toHaveBeenCalledOnce();
    expect(stale.mapDispose).toHaveBeenCalledOnce();
  });

  it('waits for the current model and artwork textures before production', async () => {
    const modelReady = deferred();
    const waitForTextures = vi.fn();
    const renderer = Object.create(GarmentRenderer.prototype);
    renderer.modelReadiness = { promise: modelReady.promise };
    renderer.decorationEditor = { waitForTextures };
    renderer.updateBottomPattern = vi.fn();
    renderer.bottomPatternPendingKey = null;
    renderer.appearanceTexture = {};
    renderer.modelMeshes = [{}];

    let settled = false;
    const ready = renderer.waitForProductionReady().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    modelReady.resolve();
    await ready;

    expect(waitForTextures).toHaveBeenCalledOnce();
    expect(renderer.updateBottomPattern).toHaveBeenCalledOnce();
  });

  it('rejects a production request for a stale design snapshot', async () => {
    const renderer = Object.create(GarmentRenderer.prototype);
    renderer.waitForProductionReady = vi.fn();
    renderer.product = {
      model: {
        id: 'chelsea-jersey',
        version: '1',
        uvExportVersion: '1',
        uvAtlasSize: 4096,
      },
    };
    renderer.state = {
      productId: 'fn8788-jersey',
      layout: 'm',
      overrides: { customTextItems: [], printItems: [] },
    };

    await expect(renderer.prepareProductionArtifacts({
      model: renderer.product.model,
      stateSnapshot: { ...renderer.state, layout: 'xl' },
    })).rejects.toThrow('设计已发生变化，请重新保存。');
  });

  it('captures production previews only after the asynchronous atlas bake finishes', async () => {
    let finishBake;
    const atlasPromise = new Promise((resolve) => {
      finishBake = resolve;
    });
    const atlas = { blob: new Blob(['atlas']) };
    const previews = { front: new Blob(['front']), back: new Blob(['back']) };
    productionArtifactMocks.bakeProductionAtlas.mockReset();
    productionArtifactMocks.captureProductionPreviews.mockReset();
    productionArtifactMocks.createGarmentAppearanceCanvas.mockReset();
    productionArtifactMocks.createGarmentAppearanceCanvas.mockReturnValue({});
    productionArtifactMocks.bakeProductionAtlas.mockReturnValue(atlasPromise);
    productionArtifactMocks.captureProductionPreviews.mockResolvedValue(previews);

    const renderer = Object.create(GarmentRenderer.prototype);
    renderer.waitForProductionReady = vi.fn();
    renderer.assertProductionSnapshot = vi.fn();
    renderer.selected = {
      appearance: { template: 'solid', colors: { body: '#F7F5EF' } },
    };
    renderer.state = { overrides: { bottomPattern: { enabled: false } } };
    renderer.decorationMeshes = [];
    renderer.patternMeshes = [{ name: 'front-mesh' }];
    renderer.modelUvLayout = { version: 3, pieceGroups: [] };
    renderer.getProductionLayers = vi.fn(() => []);
    renderer.camera = {};
    renderer.controls = {};
    renderer.renderer = {};
    renderer.scene = {};
    renderer.setProductionCaptureMode = vi.fn();

    const preparation = renderer.prepareProductionArtifacts({
      model: { uvAtlasSize: 64 },
      stateSnapshot: {},
    });
    await Promise.resolve();

    expect(productionArtifactMocks.bakeProductionAtlas).toHaveBeenCalledOnce();
    expect(productionArtifactMocks.createGarmentAppearanceCanvas).toHaveBeenCalledWith(
      64,
      renderer.selected.appearance,
      { modelMeshes: renderer.patternMeshes, uvLayout: renderer.modelUvLayout },
    );
    expect(productionArtifactMocks.captureProductionPreviews).not.toHaveBeenCalled();

    finishBake(atlas);
    await expect(preparation).resolves.toMatchObject({ atlas, previews });
    expect(productionArtifactMocks.captureProductionPreviews).toHaveBeenCalledOnce();
    expect(renderer.assertProductionSnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not treat derived bottom-pattern bake metadata as a design change', () => {
    const renderer = Object.create(GarmentRenderer.prototype);
    const model = {
      id: 'chelsea-jersey',
      version: '1',
      uvExportVersion: '1',
      uvAtlasSize: 4096,
    };
    renderer.product = { model };
    const stateSnapshot = {
      productId: 'fn8788-jersey',
      layout: 'm',
      overrides: {
        bottomPattern: {
          enabled: true,
          bakeMetadata: { atlasFilename: 'old.png', atlasSha256: 'sha256:old' },
        },
        customTextItems: [],
        printItems: [],
      },
    };
    renderer.state = structuredClone(stateSnapshot);
    renderer.state.overrides.bottomPattern.bakeMetadata = {
      atlasFilename: 'new.png',
      atlasSha256: 'sha256:new',
    };

    expect(() => renderer.assertProductionSnapshot(model, stateSnapshot)).not.toThrow();
  });

  it('temporarily hides print proxies and restores capture state', () => {
    const renderer = Object.create(GarmentRenderer.prototype);
    const visiblePlane = { userData: {}, visible: true };
    const hiddenPlane = { userData: {}, visible: false };
    renderer.printLayers = new Map([
      ['visible', { plane: visiblePlane }],
      ['hidden', { plane: hiddenPlane }],
    ]);
    renderer.decorationEditor = { setProductionCaptureMode: vi.fn() };

    renderer.setProductionCaptureMode(true);

    expect(visiblePlane.visible).toBe(false);
    expect(hiddenPlane.visible).toBe(false);
    expect(renderer.decorationEditor.setProductionCaptureMode).toHaveBeenCalledWith(true);

    renderer.setProductionCaptureMode(false);

    expect(visiblePlane.visible).toBe(true);
    expect(hiddenPlane.visible).toBe(false);
    expect(renderer.decorationEditor.setProductionCaptureMode).toHaveBeenLastCalledWith(false);
  });

  it('replaces garment appearance textures and synchronizes the name-set color', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    HTMLCanvasElement.prototype.getContext = () => ({
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, fill() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      set fillStyle(_) {},
    });
    renderer.modelMaterials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()];
    const product = { decorationPresets: [] };
    const state = { lighting: 'none', overrides: {} };
    const selected = {
      colorway: { swatches: {} },
      material: { material: { roughness: 0.7, metalness: 0 } },
      appearance: { template: 'vertical-stripes', colors: {
        body: '#F7F5EF', sleeves: '#1F5B4F', shoulderSide: '#20242A', collar: '#D1B05D', pattern: '#C84F3D', number: '#20242A',
      } },
    };

    renderer.update(product, state, selected);

    expect(renderer.appearanceTexture).toBeInstanceOf(THREE.CanvasTexture);
    expect(renderer.appearanceTexture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.appearanceTexture.flipY).toBe(false);
    expect(renderer.modelMaterials.every((material) => material.map === renderer.appearanceTexture)).toBe(true);
    const previousTexture = renderer.appearanceTexture;
    const dispose = vi.spyOn(previousTexture, 'dispose');

    renderer.update(product, state, {
      ...selected,
      appearance: { ...selected.appearance, colors: { ...selected.appearance.colors, number: '#FFCC00' } },
    });

    expect(dispose).toHaveBeenCalledOnce();
    expect(renderer.printColor).toBe('#FFCC00');
    const currentDispose = vi.spyOn(renderer.appearanceTexture, 'dispose');
    renderer.dispose();
    expect(currentDispose).toHaveBeenCalledOnce();
  });

  it('passes loaded UV layout and pattern meshes to appearance rendering and rebuilds a legacy texture', async () => {
    productionArtifactMocks.createGarmentAppearanceCanvas.mockClear();
    productionArtifactMocks.createGarmentAppearanceCanvas.mockReturnValue({});
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const appearance = { template: 'solid', colors: {
      body: '#F7F5EF', sleeves: '#1F5B4F', shoulderSide: '#20242A', collar: '#D1B05D', pattern: '#C84F3D', number: '#20242A',
    } };
    renderer.selected = {
      appearance,
      material: { material: { roughness: 0.7, metalness: 0 } },
    };
    renderer.state = { lighting: 'none', overrides: {} };
    renderer.product = {
      decorationPresets: [],
      model: {
        id: 'chelsea-jersey',
        version: '1',
        uvExportLayoutId: 'chelsea-jersey@1',
      },
    };

    renderer.applyAppearance(appearance);
    const legacyTexture = renderer.appearanceTexture;
    const legacyDispose = vi.spyOn(legacyTexture, 'dispose');
    renderer.loader = { loadAsync: vi.fn().mockResolvedValue({ scene: makeConfiguredUvModel() }) };

    await renderer.loadModel('/models/chelsea-jersey.glb');

    expect(renderer.modelUvLayout).toMatchObject({ version: 1 });
    expect(renderer.modelUvLayoutKey).toBe('chelsea-jersey@1:v1');
    expect(productionArtifactMocks.createGarmentAppearanceCanvas).toHaveBeenLastCalledWith(
      2048,
      appearance,
      { modelMeshes: renderer.patternMeshes, uvLayout: renderer.modelUvLayout },
    );
    expect(legacyDispose).toHaveBeenCalledOnce();
    expect(renderer.appearanceTexture).not.toBe(legacyTexture);
    renderer.dispose();
  });

  it('resolves an explicit UV export layout independently from the model catalog id', async () => {
    productionArtifactMocks.createGarmentAppearanceCanvas.mockReturnValue({});
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.selected = {
      appearance: { template: 'solid', colors: { body: '#F7F5EF', number: '#20242A' } },
      material: { material: { roughness: 0.7, metalness: 0 } },
    };
    renderer.state = { lighting: 'none', overrides: {} };
    renderer.product = {
      decorationPresets: [],
      model: {
        id: 'catalog-alias',
        version: '99',
        uvExportLayoutId: 'chelsea-jersey@1',
      },
    };
    renderer.loader = { loadAsync: vi.fn().mockResolvedValue({ scene: makeConfiguredUvModel() }) };

    await renderer.loadModel('/models/shared.glb');

    expect(renderer.modelUvLayout).toMatchObject({ version: 1 });
    expect(renderer.modelUvLayoutKey).toBe('chelsea-jersey@1:v1');
    renderer.dispose();
  });

  it('includes the model UV layout identity in the appearance cache key', () => {
    productionArtifactMocks.createGarmentAppearanceCanvas.mockClear();
    productionArtifactMocks.createGarmentAppearanceCanvas.mockReturnValue({});
    const renderer = Object.create(GarmentRenderer.prototype);
    const material = new THREE.MeshStandardMaterial();
    const appearance = { template: 'solid', colors: { body: '#F7F5EF', number: '#20242A' } };
    renderer.modelMaterials = [material];
    renderer.patternMeshes = [{ name: 'front-mesh' }];
    renderer.modelUvLayout = { version: 1, pieceGroups: [] };
    renderer.modelUvLayoutKey = 'layout-a:v1';
    renderer.appearanceTexture = null;
    renderer.appearanceTextureKey = null;
    renderer.bottomPatternTexture = null;
    renderer.redrawPrintTexture = vi.fn();

    renderer.applyAppearance(appearance);
    const firstTexture = renderer.appearanceTexture;
    const firstDispose = vi.spyOn(firstTexture, 'dispose');
    renderer.modelUvLayoutKey = 'layout-b:v1';
    renderer.applyAppearance(appearance);

    expect(productionArtifactMocks.createGarmentAppearanceCanvas).toHaveBeenCalledTimes(2);
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(renderer.appearanceTexture).not.toBe(firstTexture);
    renderer.disposeAppearanceTexture();
    material.dispose();
  });

  it('keeps the scene background fixed while updating the body appearance color', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    HTMLCanvasElement.prototype.getContext = () => ({
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, fill() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      set fillStyle(_) {},
    });
    renderer.modelMaterials = [new THREE.MeshStandardMaterial()];
    const product = { decorationPresets: [] };
    const state = { lighting: 'none', overrides: {} };
    const selected = {
      colorway: { swatches: {} },
      material: { material: { roughness: 0.7, metalness: 0 } },
      appearance: { template: 'solid', colors: {
        body: '#F7F5EF', sleeves: '#1F5B4F', shoulderSide: '#20242A', collar: '#D1B05D', pattern: '#C84F3D', number: '#20242A',
      } },
    };

    renderer.scene.background.set('#f3f1ec');
    renderer.update(product, state, selected);
    const firstTexture = renderer.appearanceTexture;
    renderer.update(product, state, {
      ...selected,
      appearance: { ...selected.appearance, colors: { ...selected.appearance.colors, body: '#123456' } },
    });

    expect(renderer.scene.background.getHexString()).toBe('f3f1ec');
    expect(renderer.appearanceTexture).not.toBe(firstTexture);
    expect(renderer.modelMaterials[0].map).toBe(renderer.appearanceTexture);
    renderer.dispose();
  });

  it('keeps the garment appearance texture during state-only updates', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    HTMLCanvasElement.prototype.getContext = () => ({
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, fill() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      set fillStyle(_) {},
    });
    renderer.modelMaterials = [new THREE.MeshStandardMaterial()];
    const product = { decorationPresets: [] };
    const selected = {
      colorway: { swatches: {} },
      material: { material: { roughness: 0.7, metalness: 0 } },
      appearance: { template: 'solid', colors: {
        body: '#F7F5EF', sleeves: '#1F5B4F', shoulderSide: '#20242A', collar: '#D1B05D', pattern: '#C84F3D', number: '#20242A',
      } },
    };

    renderer.update(product, { lighting: 'none', overrides: {} }, selected);
    const texture = renderer.appearanceTexture;
    const dispose = vi.spyOn(texture, 'dispose');
    renderer.update(product, { lighting: 'none', overrides: { decorations: [{ id: 'crest' }] } }, selected);

    expect(renderer.appearanceTexture).toBe(texture);
    expect(dispose).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it('uses a baked bottom-pattern texture for garment meshes and restores the appearance map when disabled', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const material = new THREE.MeshStandardMaterial();
    const garmentMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    const appearanceTexture = new THREE.Texture();
    const bakedTexture = new THREE.Texture();
    const bakedDispose = vi.spyOn(bakedTexture, 'dispose');
    renderer.modelMaterials = [material];
    renderer.patternMeshes = [garmentMesh];
    renderer.appearanceTexture = appearanceTexture;
    material.map = appearanceTexture;
    renderer.textureLoader = { loadAsync: vi.fn().mockResolvedValue({ image: { width: 16, height: 16 } }) };
    renderer.createBottomPatternTexture = vi.fn().mockResolvedValue(bakedTexture);
    renderer.state = { overrides: { bottomPattern: enabledBottomPattern() } };

    await renderer.updateBottomPattern();

    expect(renderer.createBottomPatternTexture).toHaveBeenCalledOnce();
    expect(material.map).toBe(bakedTexture);

    renderer.state = { overrides: { bottomPattern: { enabled: false } } };
    await renderer.updateBottomPattern();

    expect(material.map).toBe(appearanceTexture);
    expect(bakedDispose).toHaveBeenCalledOnce();
    renderer.dispose();
  });

  it('records the completed bottom-pattern bake metadata in configurator state', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const material = new THREE.MeshStandardMaterial();
    const texture = new THREE.Texture();
    texture.userData = { bottomPatternBakeMetadata: { key: 'bottom-pattern-atlas:latest', mimeType: 'image/png', width: 2048 } };
    renderer.patternMeshes = [new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)];
    renderer.textureLoader = { loadAsync: vi.fn().mockResolvedValue({ image: { width: 16, height: 16 } }) };
    renderer.createBottomPatternTexture = vi.fn().mockResolvedValue(texture);
    renderer.onStatePatch = vi.fn();
    renderer.state = { overrides: { bottomPattern: enabledBottomPattern() } };

    await renderer.updateBottomPattern();

    expect(renderer.onStatePatch).toHaveBeenCalledWith({
      overrides: { bottomPattern: { bakeMetadata: texture.userData.bottomPatternBakeMetadata } },
    });
    renderer.dispose();
  });

  it('does not let a stale bottom-pattern bake replace a newer pattern texture', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const material = new THREE.MeshStandardMaterial();
    renderer.modelMaterials = [material];
    renderer.patternMeshes = [new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material)];
    renderer.appearanceTexture = new THREE.Texture();
    material.map = renderer.appearanceTexture;
    const first = deferred();
    const second = deferred();
    const firstTexture = new THREE.Texture();
    const secondTexture = new THREE.Texture();
    const firstDispose = vi.spyOn(firstTexture, 'dispose');
    renderer.textureLoader = { loadAsync: vi.fn().mockResolvedValue({ image: { width: 16, height: 16 } }) };
    renderer.createBottomPatternTexture = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    renderer.state = { overrides: { bottomPattern: enabledBottomPattern('first') } };
    const firstUpdate = renderer.updateBottomPattern();
    renderer.state = { overrides: { bottomPattern: enabledBottomPattern('second') } };
    const secondUpdate = renderer.updateBottomPattern();
    second.resolve(secondTexture);
    await secondUpdate;
    first.resolve(firstTexture);
    await firstUpdate;

    expect(material.map).toBe(secondTexture);
    expect(firstDispose).toHaveBeenCalledOnce();
    renderer.dispose();
  });

  it('disposes a shared replaced base-color map once', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    HTMLCanvasElement.prototype.getContext = () => ({
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, fill() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      set fillStyle(_) {},
    });
    const baseColorMap = new THREE.Texture();
    const dispose = vi.spyOn(baseColorMap, 'dispose');
    renderer.modelMaterials = [
      new THREE.MeshStandardMaterial({ map: baseColorMap }),
      new THREE.MeshStandardMaterial({ map: baseColorMap }),
    ];
    const selected = {
      colorway: { swatches: {} },
      material: { material: { roughness: 0.7, metalness: 0 } },
      appearance: { template: 'solid', colors: {
        body: '#F7F5EF', sleeves: '#1F5B4F', shoulderSide: '#20242A', collar: '#D1B05D', pattern: '#C84F3D', number: '#20242A',
      } },
    };

    renderer.update({ decorationPresets: [] }, { lighting: 'none', overrides: {} }, selected);

    expect(dispose).toHaveBeenCalledOnce();
    renderer.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('releases each model base-color map once across model replacement', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    HTMLCanvasElement.prototype.getContext = () => ({
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, fill() {}, fillRect() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      set fillStyle(_) {},
    });
    const firstMap = new THREE.Texture();
    const secondMap = new THREE.Texture();
    const firstDispose = vi.spyOn(firstMap, 'dispose');
    const secondDispose = vi.spyOn(secondMap, 'dispose');
    const selected = {
      material: { material: { roughness: 0.7, metalness: 0 } },
      appearance: { template: 'solid', colors: {
        body: '#F7F5EF', sleeves: '#1F5B4F', shoulderSide: '#20242A', collar: '#D1B05D', pattern: '#C84F3D', number: '#20242A',
      } },
    };
    renderer.selected = selected;
    renderer.state = { lighting: 'none', overrides: {} };
    renderer.product = {
      decorationPresets: [],
      model: { id: 'chelsea-jersey', version: '1', uvExportLayoutId: 'chelsea-jersey@1' },
    };
    renderer.loader = {
      loadAsync: vi.fn()
        .mockResolvedValueOnce({ scene: makeConfiguredUvModel(firstMap) })
        .mockResolvedValueOnce({ scene: makeConfiguredUvModel(secondMap) }),
    };

    await renderer.loadModel('first.glb');
    await renderer.loadModel('second.glb');

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
    renderer.dispose();
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
  });

  it('focuses a decoration from its outward decal normal with clamped distance and no state mutation', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const center = new THREE.Vector3(1, 2, 3);
    renderer.camera.position.set(0, 0, 20);
    renderer.controls.target.set(0, 0, 0);
    const distance = renderer.controls.maxDistance;
    renderer.decorationEditor = {
      getDecorationWorldCenter: vi.fn(() => center),
      getDecorationWorldNormal: vi.fn(() => new THREE.Vector3(0, 0, -1)),
      dispose: vi.fn(),
    };
    renderer.state = { overrides: { decorations: [] } };
    renderer.onStatePatch = vi.fn();
    const controlsEnabled = renderer.controls.enabled;
    gsap.to.mockClear();
    gsap.killTweensOf.mockClear();

    expect(renderer.focusDecoration('crest')).toBe(true);
    expect(gsap.killTweensOf).toHaveBeenCalledWith(renderer.camera.position);
    expect(gsap.killTweensOf).toHaveBeenCalledWith(renderer.controls.target);
    expect(gsap.to).toHaveBeenCalledTimes(2);
    expect(gsap.to).toHaveBeenNthCalledWith(1, renderer.camera.position, expect.objectContaining({
      x: center.x,
      y: center.y,
      z: center.z - distance,
      duration: 0.4,
      ease: 'power2.out',
    }));
    expect(gsap.to).toHaveBeenNthCalledWith(2, renderer.controls.target, expect.objectContaining({
      x: 1,
      y: 2,
      z: 3,
      duration: 0.4,
      ease: 'power2.out',
    }));
    expect(renderer.onStatePatch).not.toHaveBeenCalled();
    expect(renderer.state).toEqual({ overrides: { decorations: [] } });
    expect(renderer.controls.enabled).toBe(controlsEnabled);

    renderer.dispose();
  });

  it('moves to the visible side of front and back artwork instead of retaining the current view direction', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.controls.minDistance = 2;
    renderer.controls.maxDistance = 8;
    renderer.camera.position.set(0, 1, -5);
    renderer.controls.target.set(0, 0, 0);
    const center = new THREE.Vector3(0.5, 1, 0);
    renderer.decorationEditor = {
      getDecorationWorldCenter: vi.fn(() => center),
      getDecorationWorldNormal: vi.fn()
        .mockReturnValueOnce(new THREE.Vector3(0, 0, 1))
        .mockReturnValueOnce(new THREE.Vector3(0, 0, -1)),
      dispose: vi.fn(),
    };
    gsap.to.mockClear();

    renderer.focusDecoration('front-crest');
    renderer.focusDecoration('back-crest');

    expect(gsap.to).toHaveBeenNthCalledWith(1, renderer.camera.position, expect.objectContaining({ z: Math.sqrt(26) }));
    expect(gsap.to).toHaveBeenNthCalledWith(3, renderer.camera.position, expect.objectContaining({ z: -Math.sqrt(26) }));

    renderer.dispose();
  });

  it.each([
    ['front', { x: 0, y: 1.8, z: 5.4 }],
    ['back', { x: 0, y: 1.8, z: -5.4 }],
  ])('uses the %s camera preset requested by ProductStage', (view, position) => {
    const renderer = Object.create(GarmentRenderer.prototype);
    renderer.camera = {
      position: new THREE.Vector3(),
      lookAt: vi.fn(),
    };
    renderer.controls = { target: new THREE.Vector3() };
    gsap.to.mockClear();

    renderer.setView(view);

    expect(gsap.to).toHaveBeenNthCalledWith(1, renderer.camera.position, expect.objectContaining({
      ...position,
      duration: 0.55,
      ease: 'power2.out',
    }));
    expect(gsap.to).toHaveBeenNthCalledWith(2, renderer.controls.target, expect.objectContaining({
      x: 0,
      y: 0.7,
      z: 0,
      duration: 0.55,
      ease: 'power2.out',
    }));
    const cameraTween = gsap.to.mock.calls[0][1];
    cameraTween.onUpdate();
    expect(renderer.camera.lookAt).toHaveBeenCalledWith(renderer.controls.target);
  });

  it('keeps an unknown view on the orbit fallback preset', () => {
    const renderer = Object.create(GarmentRenderer.prototype);
    renderer.camera = { position: new THREE.Vector3(), lookAt: vi.fn() };
    renderer.controls = { target: new THREE.Vector3() };
    gsap.to.mockClear();

    renderer.setView('unknown');

    expect(gsap.to).toHaveBeenNthCalledWith(1, renderer.camera.position, expect.objectContaining({
      x: 0,
      y: 1.8,
      z: 5.4,
    }));
    expect(gsap.to).toHaveBeenNthCalledWith(2, renderer.controls.target, expect.objectContaining({
      x: 0,
      y: 0.7,
      z: 0,
    }));
  });

  it('does not start a focus tween when the decoration has no center', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.decorationEditor = { getDecorationWorldCenter: vi.fn(() => null), getDecorationWorldNormal: vi.fn(), dispose: vi.fn() };
    gsap.to.mockClear();
    gsap.killTweensOf.mockClear();

    expect(renderer.focusDecoration('missing')).toBe(false);
    expect(gsap.to).not.toHaveBeenCalled();
    expect(gsap.killTweensOf).not.toHaveBeenCalled();

    renderer.dispose();
  });

  it('uses a forward camera offset when focus starts at its target and cancels tweens on disposal', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.camera.position.set(0, 0, 0);
    renderer.controls.target.set(0, 0, 0);
    renderer.controls.minDistance = 2;
    renderer.controls.maxDistance = 8;
    renderer.decorationEditor = {
      getDecorationWorldCenter: vi.fn(() => new THREE.Vector3(4, 5, 6)),
      getDecorationWorldNormal: vi.fn(() => new THREE.Vector3(0, 0, 1)),
      dispose: vi.fn(),
    };
    gsap.to.mockClear();
    gsap.killTweensOf.mockClear();

    renderer.focusDecoration('crest');

    expect(gsap.to).toHaveBeenNthCalledWith(1, renderer.camera.position, expect.objectContaining({ x: 4, y: 5, z: 8 }));
    gsap.killTweensOf.mockClear();
    renderer.dispose();
    expect(gsap.killTweensOf).toHaveBeenCalledWith(renderer.camera.position);
    expect(gsap.killTweensOf).toHaveBeenCalledWith(renderer.controls.target);
  });

  it('enables orbit controls only when no artwork or print drag is active', () => {
    expect(shouldEnableOrbitControls({ isDraggingDecoration: false, isDraggingPrint: false })).toBe(true);
    expect(shouldEnableOrbitControls({ isDraggingDecoration: true, isDraggingPrint: false })).toBe(false);
    expect(shouldEnableOrbitControls({ isDraggingDecoration: false, isDraggingPrint: true })).toBe(false);
  });

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

  it('does not pick a print hidden behind the outward garment surface', () => {
    const renderer = createRaycastPickerRenderer();
    const garment = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    const print = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    print.position.z = -1;
    garment.updateMatrixWorld(true);
    print.updateMatrixWorld(true);
    renderer.decorationMeshes = [garment];
    renderer.printLayers = new Map([['text:hidden', { plane: print }]]);

    expect(renderer.pickPrint(pointerEvent(50, 50))).toBeNull();
  });

  it('picks a print slightly outside the outward garment surface', () => {
    const renderer = createRaycastPickerRenderer();
    const garment = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    const print = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    print.position.z = 0.02;
    garment.updateMatrixWorld(true);
    print.updateMatrixWorld(true);
    const intersectObjects = vi.spyOn(renderer.raycaster, 'intersectObjects');
    renderer.decorationMeshes = [garment];
    renderer.printLayers = new Map([['text:visible', { plane: print }]]);

    expect(renderer.pickPrint(pointerEvent(50, 50))?.object).toBe(print);
    expect(intersectObjects).toHaveBeenCalledWith(renderer.decorationMeshes, false);
  });

  it('uses the next outward-facing garment hit for print dragging', () => {
    const renderer = createRaycastPickerRenderer();
    const backFacingMesh = new THREE.Mesh();
    const outwardMesh = new THREE.Mesh();
    backFacingMesh.updateMatrixWorld(true);
    outwardMesh.updateMatrixWorld(true);
    const backFacingHit = {
      distance: 1,
      face: { normal: new THREE.Vector3(0, 0, -1) },
      object: backFacingMesh,
    };
    const outwardHit = {
      distance: 2,
      face: { normal: new THREE.Vector3(0, 0, 1) },
      object: outwardMesh,
    };
    const intersectObjects = vi.fn(() => [backFacingHit, outwardHit]);
    const setFromCamera = vi.fn();
    renderer.camera = {};
    renderer.raycaster = {
      intersectObjects,
      ray: { direction: new THREE.Vector3(0, 0, -1) },
      setFromCamera,
    };
    renderer.decorationMeshes = [backFacingMesh, outwardMesh];

    expect(renderer.pickJersey(pointerEvent(50, 50))).toBe(outwardHit);
    expect(setFromCamera).toHaveBeenCalledWith(renderer.pointer, renderer.camera);
    expect(intersectObjects).toHaveBeenCalledWith(renderer.decorationMeshes, false);
  });

  it('chooses a copy placement away from existing print placements', () => {
    const selected = getNextPrintPlacement(
      [{ x: 0, y: 0.36, z: 0.5 }, { x: 0.3, y: 0.36, z: 0.5 }],
      [{ x: 0, y: 0.36, z: 0.5 }],
    );

    expect(selected).toEqual({ x: 0.3, y: 0.36, z: 0.5 });
  });

  it('converts four visible plane corners into a stage-relative selection rectangle', () => {
    expect(getPrintSelectionRect([
      { x: -0.2, y: 0.3, z: 0 },
      { x: 0.2, y: 0.3, z: 0 },
      { x: -0.2, y: -0.3, z: 0 },
      { x: 0.2, y: -0.3, z: 0 },
    ], { width: 500, height: 400 })).toEqual({
      visible: true,
      left: 200,
      top: 140,
      width: 100,
      height: 120,
    });
  });

  it('projects the visible texture bounds instead of the full personalization plane', () => {
    const renderer = Object.create(GarmentRenderer.prototype);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 1));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    renderer.host = { getBoundingClientRect: () => ({ width: 200, height: 200 }) };
    renderer.camera = camera;
    renderer.activePrintId = 'text:text-1';
    renderer.printLayers = new Map([['text:text-1', {
      alphaMask: {
        bounds: { minU: 0.25, maxU: 0.75, minV: 0.25, maxV: 0.75 },
      },
      plane,
    }]]);
    renderer.lastPrintAnchor = null;
    renderer.onPrintAnchorChange = vi.fn();

    renderer.syncPrintAnchor();

    expect(renderer.onPrintAnchorChange).toHaveBeenCalledWith({
      visible: true,
      left: 50,
      top: 75,
      width: 100,
      height: 50,
    });
  });

  it('projects visible decal pixels after the print conforms to the jersey surface', () => {
    const renderer = Object.create(GarmentRenderer.prototype);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 1));
    const decalGeometry = new THREE.BufferGeometry();
    decalGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,
      1.5, -0.5, 0,
      -0.5, 0.5, 0,
      -0.5, 0.5, 0,
      1.5, -0.5, 0,
      1.5, 0.5, 0,
    ], 3));
    decalGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      0, 1,
      0, 1,
      1, 0,
      1, 1,
    ], 2));
    const decal = new THREE.Mesh(decalGeometry);
    decal.visible = true;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    renderer.host = { getBoundingClientRect: () => ({ width: 200, height: 200 }) };
    renderer.camera = camera;
    renderer.activePrintId = 'text:text-1';
    renderer.printLayers = new Map([['text:text-1', {
      alphaMask: {
        bounds: { minU: 0.25, maxU: 0.75, minV: 0.25, maxV: 0.75 },
      },
      decal,
      plane,
    }]]);
    renderer.lastPrintAnchor = null;
    renderer.onPrintAnchorChange = vi.fn();

    renderer.syncPrintAnchor();

    expect(renderer.onPrintAnchorChange).toHaveBeenCalledWith({
      visible: true,
      left: 100,
      top: 75,
      width: 100,
      height: 50,
    });
  });

  it('hides a selection rectangle when a plane corner is outside the camera view', () => {
    expect(getPrintSelectionRect([
      { x: -0.2, y: 0.3, z: 0 },
      { x: 0.2, y: 0.3, z: 0 },
      { x: -0.2, y: -0.3, z: 0 },
      { x: 0.2, y: -0.3, z: 1.1 },
    ], { width: 500, height: 400 })).toEqual({ visible: false });
  });

  it('does not retain artwork projection or anchor synchronization APIs', () => {
    expect(GarmentRenderer.prototype.syncDecorationAnchor).toBeUndefined();
    expect(GarmentRenderer.prototype.getObjectProjectedCorners).toBeUndefined();
  });

  it('does not notify React when the projected selection rectangle has not changed', () => {
    const selectionRect = { visible: true, left: 200, top: 140, width: 100, height: 120 };

    expect(hasPrintSelectionRectChanged(selectionRect, selectionRect)).toBe(false);
    expect(hasPrintSelectionRectChanged(selectionRect, { ...selectionRect, width: 101 })).toBe(true);
    expect(hasPrintSelectionRectChanged(selectionRect, { visible: false })).toBe(true);
  });

  it('renders billable custom text layers and skips blank text', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [
          { id: 'text-1', text: 'MASON' },
          { id: 'text-2', text: '   ' },
        ],
      },
    };

    renderer.updatePrintLayer();

    expect([...renderer.printLayers.keys()]).toEqual(['text:text-1']);
    const layer = renderer.printLayers.get('text:text-1');
    expect(layer.plane.userData).toMatchObject({ printId: 'text:text-1', itemKind: 'text', sourceId: 'text-1' });
    expect(layer.plane.geometry.parameters).toMatchObject({
      width: 1.05,
      height: 1.05 / CUSTOM_TEXT_CANVAS_ASPECT,
    });
    renderer.dispose();
  });

  it('renders new print proxy and decal materials on their outward side only', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{ id: 'text-1', text: 'MASON' }],
      },
    };

    renderer.updatePrintLayer();

    const layer = renderer.printLayers.get('text:text-1');
    expect(layer.plane.material.side).toBe(THREE.FrontSide);
    expect(layer.decal.material.side).toBe(THREE.FrontSide);
    renderer.dispose();
  });

  it('keeps player print geometry and marks its layer kind', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.state = {
      lighting: 'name-number',
      overrides: { printItems: [{ id: 'player-id', name: 'PLAYER', number: '16' }] },
    };

    renderer.updatePrintLayer();

    const layer = renderer.printLayers.get('player:player-id');
    expect(layer.plane.userData).toMatchObject({ printId: 'player:player-id', itemKind: 'player', sourceId: 'player-id' });
    expect(layer.plane.geometry.parameters).toMatchObject({ width: 1.05, height: 0.42 });
    renderer.dispose();
  });

  it('keeps custom text canvas and texture stable while rasterizing only style changes', () => {
    const context = installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'MASON',
          fontPreset: 'athletic',
          fillColor: '#20242A',
          outlineEnabled: true,
          outlineColor: '#F7F5EF',
          letterSpacing: 0,
        }],
      },
    };
    renderer.updatePrintLayer();
    const layer = renderer.printLayers.get('text:text-1');
    const canvas = layer.texture.image;
    const texture = layer.texture;
    const initialRenderKey = layer.renderKey;
    const initialClearCount = context.clearRect.mock.calls.length;

    renderer.state.overrides.customTextItems[0].placement = { x: 0.2, y: 0.4, z: 0.5 };
    renderer.state.overrides.customTextItems[0].scale = 1.2;
    renderer.state.overrides.customTextItems[0].rotation = 45;
    renderer.updatePrintLayer();

    expect(layer.texture).toBe(texture);
    expect(layer.texture.image).toBe(canvas);
    expect(layer.renderKey).toBe(initialRenderKey);
    expect(context.clearRect).toHaveBeenCalledTimes(initialClearCount);

    const stylePatches = [
      { text: 'MASON 2' },
      { fontPreset: 'block' },
      { fillColor: '#CC0000' },
      { outlineEnabled: false },
      { outlineColor: '#00CC00' },
      { letterSpacing: 4 },
    ];
    stylePatches.forEach((patch, index) => {
      Object.assign(renderer.state.overrides.customTextItems[0], patch);
      const previousRenderKey = layer.renderKey;
      renderer.updatePrintLayer();

      expect(layer.texture).toBe(texture);
      expect(layer.texture.image).toBe(canvas);
      expect(layer.renderKey).not.toBe(previousRenderKey);
      expect(context.clearRect).toHaveBeenCalledTimes(initialClearCount + index + 1);
    });
    renderer.dispose();
  });

  it('emits placement patches to the custom text collection for a custom active id', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onStatePatch });
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON' }] },
    };
    renderer.updatePrintLayer();
    renderer.setActivePrintId('text:custom-id');
    renderer.printPlane.position.set(0.25, 0.5, 0.75);

    renderer.emitPrintPlacement();

    expect(resolveLastStatePatch(onStatePatch, renderer.state)).toEqual({
      overrides: {
        customTextItems: [expect.objectContaining({
          id: 'custom-id',
          placement: expect.objectContaining({ x: 0.25, y: 0.5, z: 0.75 }),
        })],
      },
    });
    renderer.dispose();
  });

  it('applies a custom text placement to the latest queued state', () => {
    const onStatePatch = vi.fn();
    const renderer = Object.create(GarmentRenderer.prototype);
    renderer.onStatePatch = onStatePatch;
    renderer.personalizationMutationDisabled = false;
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'custom-id', text: 'OLD TEXT' }] },
    };

    renderer.emitPersonalizationItem({
      itemKind: 'text',
      sourceId: 'custom-id',
      placement: { x: 0.25, y: 0.5, z: 0.75 },
      rotation: 15,
      scale: 1.2,
    });

    const queuedPatch = onStatePatch.mock.calls[0][0];
    expect(queuedPatch).toEqual(expect.any(Function));
    expect(queuedPatch({
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'custom-id', text: 'LATEST TEXT' }] },
    })).toEqual({
      overrides: {
        customTextItems: [expect.objectContaining({
          id: 'custom-id',
          text: 'LATEST TEXT',
          placement: { x: 0.25, y: 0.5, z: 0.75 },
          rotation: 15,
          scale: 1.2,
        })],
      },
    });
  });

  it('applies a player placement to the latest queued state and legacy fields', () => {
    const onStatePatch = vi.fn();
    const renderer = Object.create(GarmentRenderer.prototype);
    renderer.onStatePatch = onStatePatch;
    renderer.personalizationMutationDisabled = false;
    renderer.state = {
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'player-id', name: 'OLD', number: '1' }],
      },
    };

    renderer.emitPersonalizationItem({
      itemKind: 'player',
      sourceId: 'player-id',
      placement: { x: 0.4, y: 0.5, z: 0.6 },
      rotation: 30,
      scale: 1.1,
    });

    const queuedPatch = onStatePatch.mock.calls[0][0];
    expect(queuedPatch).toEqual(expect.any(Function));
    expect(queuedPatch({
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'player-id', name: 'LATEST', number: '99' }],
      },
    })).toEqual({
      overrides: {
        printItems: [expect.objectContaining({
          id: 'player-id',
          name: 'LATEST',
          number: '99',
          placement: { x: 0.4, y: 0.5, z: 0.6 },
          rotation: 30,
          scale: 1.1,
        })],
        printName: 'LATEST',
        printNumber: '99',
        printPlacement: { x: 0.4, y: 0.5, z: 0.6 },
      },
    });
  });

  it('keeps custom text editable when player lighting is none', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'text-1', text: 'MASON' }] },
    };
    renderer.decorationMeshes = [new THREE.Mesh()];
    renderer.updatePrintLayer();

    expect(renderer.isPrintEditable()).toBe(true);
    renderer.dispose();
  });

  it('cancels personalization gestures and blocks placement writes while mutations are disabled', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onStatePatch });
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'text-1', text: 'MASON' }] },
    };
    renderer.decorationMeshes = [new THREE.Mesh()];
    renderer.updatePrintLayer();
    renderer.setActivePrintId('text:text-1');
    renderer.pendingPrintDrag = { x: 1, y: 1 };
    renderer.activePrintDrag = { x: 1, y: 1 };
    renderer.isDraggingPrint = true;
    renderer.controls.enabled = false;

    renderer.setPersonalizationMutationDisabled(true);
    renderer.emitPrintPlacement();

    expect(renderer.pendingPrintDrag).toBeNull();
    expect(renderer.activePrintDrag).toBeNull();
    expect(renderer.isDraggingPrint).toBe(false);
    expect(renderer.controls.enabled).toBe(true);
    expect(renderer.isPrintEditable()).toBe(false);
    expect(onStatePatch).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it('restores the projected decal when a pending mutation cancels an active drag', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const jersey = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'MASON',
          placement: {
            x: 0,
            y: 0,
            z: 0.5,
            normal: { x: 0, y: 0, z: 1 },
          },
        }],
      },
    };
    renderer.updatePrintLayer();
    renderer.setActivePrintId('text:text-1');
    const layer = renderer.printLayers.get('text:text-1');
    renderer.isDraggingPrint = true;
    renderer.activePrintDrag = { grabOffset: new THREE.Vector3(), rotation: 0 };
    renderer.setPrintLayerDragging(layer, true);

    renderer.setPersonalizationMutationDisabled(true);

    expect(layer.plane.material.opacity).toBe(0);
    expect(layer.decal.visible).toBe(true);
    renderer.dispose();
  });

  it('keeps orbit interaction available instead of picking prints while mutations are disabled', () => {
    const renderer = createPointerRenderer({
      printHit: { object: { userData: { printId: 'text:text-1' } } },
    });
    renderer.setPersonalizationMutationDisabled(true);

    renderer.handlePointerDown(pointerEvent(100, 100));

    expect(renderer.pickPrint).not.toHaveBeenCalled();
    expect(renderer.controls.enabled).toBe(true);
  });

  it('disposes a custom text layer after its text becomes blank', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'text-1', text: 'MASON' }] },
    };
    renderer.updatePrintLayer();
    const layer = renderer.printLayers.get('text:text-1');
    const geometryDispose = vi.spyOn(layer.plane.geometry, 'dispose');
    const materialDispose = vi.spyOn(layer.material, 'dispose');
    const textureDispose = vi.spyOn(layer.texture, 'dispose');

    renderer.state.overrides.customTextItems[0].text = '   ';
    renderer.updatePrintLayer();

    expect(renderer.printLayers.size).toBe(0);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    renderer.dispose();
  });

  it('uses a transparent proxy and a projected decal when the garment surface resolves', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const jersey = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'MASON',
          placement: {
            x: 0,
            y: 0,
            z: 0.5,
            normal: { x: 0, y: 0, z: 1 },
          },
        }],
      },
    };

    renderer.updatePrintLayer();

    const layer = renderer.printLayers.get('text:text-1');
    expect(layer.plane.material.opacity).toBe(0);
    expect(layer.decal.visible).toBe(true);
    expect(layer.decal.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(layer.decal.userData.productionLayer).toMatchObject({
      garmentMeshes: [jersey],
      id: 'text:text-1',
      kind: 'text',
      label: 'MASON',
    });
    expect(layer.decal.material).toMatchObject({
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    expect(renderer.pickPrint).toBeTypeOf('function');
    renderer.dispose();
  });

  it('exposes only visible final decals in deterministic render order', () => {
    const renderer = Object.create(GarmentRenderer.prototype);
    const personalizationGeometry = new THREE.BufferGeometry();
    personalizationGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const firstSurface = new THREE.Mesh(
      personalizationGeometry,
      new THREE.MeshBasicMaterial({ map: new THREE.Texture() }),
    );
    firstSurface.visible = true;
    firstSurface.renderOrder = 9;
    firstSurface.userData.productionLayer = {
      garmentMeshes: [{ name: 'Body' }],
      id: 'player:first',
      kind: 'player',
      label: 'PLAYER #16',
    };
    const hiddenSurface = firstSurface.clone();
    hiddenSurface.visible = false;
    hiddenSurface.userData.productionLayer = {
      garmentMeshes: [{ name: 'Body' }],
      id: 'player:hidden',
      kind: 'player',
      label: 'HIDDEN #1',
    };
    const personalizationTextureSource = { width: 16, height: 16 };
    renderer.printLayers = new Map([
      ['player:first', { decal: firstSurface, texture: { image: personalizationTextureSource } }],
      ['player:hidden', { decal: hiddenSurface, texture: { image: { width: 16, height: 16 } } }],
    ]);
    renderer.decorationEditor = {
      getProductionLayers: () => [{
        garmentMesh: { name: 'Sleeve' },
        geometry: new THREE.BufferGeometry(),
        id: 'crest',
        kind: 'artwork',
        label: 'Crest',
        renderOrder: 8,
        surface: { id: 1 },
        textureSource: { width: 16, height: 16 },
      }],
    };

    expect(renderer.getProductionLayers().map((layer) => layer.id)).toEqual([
      'crest',
      'player:first',
    ]);
    expect(renderer.getProductionLayers()[1]).toMatchObject({
      garmentMeshes: [{ name: 'Body' }],
      geometry: firstSurface.geometry,
      surface: firstSurface,
      textureSource: personalizationTextureSource,
    });
  });

  it('keeps the textured proxy visible as a fallback when no garment surface resolves', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.decorationMeshes = [];
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'text-1', text: 'MASON' }] },
    };

    renderer.updatePrintLayer();

    const layer = renderer.printLayers.get('text:text-1');
    expect(layer.plane.material.opacity).toBe(1);
    expect(layer.plane.material.map).toBe(layer.texture);
    expect(layer.decal.visible).toBe(false);
    renderer.dispose();
  });

  it('combines adjacent garment pieces into one owned decal geometry', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const left = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    const right = left.clone();
    left.position.x = -0.4;
    right.position.x = 0.4;
    left.updateMatrixWorld(true);
    right.updateMatrixWorld(true);
    renderer.decorationMeshes = [left, right];
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'MASON',
          placement: {
            x: 0,
            y: 0,
            z: 0.2,
            normal: { x: 0, y: 0, z: 1 },
          },
        }],
      },
    };

    renderer.updatePrintLayer();

    const layer = renderer.printLayers.get('text:text-1');
    expect(layer.decal.geometry.userData.surfaceCount).toBe(2);
    expect(layer.decal.visible).toBe(true);
    expect(layer.plane.material.opacity).toBe(0);
    renderer.dispose();
  });

  it('clamps a loaded oversized personalization to a complete decal and syncs state once', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStateNormalize = vi.fn();
    const renderer = new GarmentRenderer(host, { onStateNormalize });
    const jersey = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    jersey.updateMatrixWorld(true);
    const item = {
      id: 'text-1',
      text: 'A WIDE NAME',
      placement: {
        x: 0,
        y: 0,
        z: 0.2,
        normal: { x: 0, y: 0, z: 1 },
      },
      rotation: 0,
      scale: 1.8,
    };
    renderer.decorationMeshes = [jersey];
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [item] },
    };
    renderer.updatePrintLayer();
    const layer = renderer.printLayers.get('text:text-1');
    layer.alphaMask = { samples: [new THREE.Vector2(0.05, 0.5)] };
    renderer.state = {
      ...renderer.state,
      overrides: { customTextItems: [{ ...item, rotation: 1 }] },
    };
    renderer.updatePrintLayer();

    expect(layer.decal.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(layer.decal.visible).toBe(true);
    expect(layer.plane.material.opacity).toBe(0);
    expect(layer.plane.scale.x).toBeLessThan(1.8);
    expect(onStateNormalize).toHaveBeenCalledOnce();
    expect(onStateNormalize.mock.calls[0][0].overrides.customTextItems[0].scale)
      .toBeCloseTo(layer.plane.scale.x, 6);

    renderer.state = {
      ...renderer.state,
      overrides: onStateNormalize.mock.calls[0][0].overrides,
    };
    renderer.updatePrintLayer();
    expect(onStateNormalize).toHaveBeenCalledOnce();
    expect(renderer.pendingPersonalizationConstraints.size).toBe(0);
    renderer.dispose();
  });

  it('normalizes an invalid legacy placement to the default front and keeps the decal visible', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStateNormalize = vi.fn();
    const renderer = new GarmentRenderer(host, { onStateNormalize });
    const jersey = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    jersey.position.z = 0.5;
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'legacy',
          text: 'MASON',
          placement: { x: 99, y: 99, z: 99 },
          rotation: 0,
          scale: 1.8,
        }],
      },
    };

    renderer.updatePrintLayer();

    const layer = renderer.printLayers.get('text:legacy');
    expect(layer.decal.visible || layer.plane.material.opacity > 0).toBe(true);
    expect(onStateNormalize).toHaveBeenCalledOnce();
    expect(onStateNormalize.mock.calls[0][0].overrides.customTextItems[0]).toEqual(
      expect.objectContaining({
        placement: expect.objectContaining({ x: 0, y: 0.36, z: 0.5 }),
        scale: expect.any(Number),
      }),
    );
    renderer.dispose();
  });

  it('batches every invalid player and text item from one render pass into one patch', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStateNormalize = vi.fn();
    const renderer = new GarmentRenderer(host, { onStateNormalize });
    const jersey = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    jersey.position.z = 0.5;
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    const invalidPlacement = { x: 99, y: 99, z: 99 };
    renderer.state = {
      lighting: 'name-number',
      overrides: {
        printItems: [{
          id: 'player',
          name: 'PLAYER',
          number: '16',
          placement: invalidPlacement,
          scale: 1.8,
          rotation: 0,
        }],
        customTextItems: [
          { id: 'first', text: 'FIRST', placement: invalidPlacement, scale: 1.8 },
          { id: 'second', text: 'SECOND', placement: invalidPlacement, scale: 1.8 },
        ],
      },
    };

    renderer.updatePrintLayer();

    expect(onStateNormalize).toHaveBeenCalledOnce();
    const { overrides } = onStateNormalize.mock.calls[0][0];
    expect(overrides.customTextItems).toHaveLength(2);
    expect(overrides.customTextItems.every((item) => (
      item.placement.x === 0 && item.placement.y === 0.36 && item.placement.z === 0.5
    ))).toBe(true);
    expect(overrides.printItems).toHaveLength(1);
    expect(overrides.printItems[0].placement).toEqual(
      expect.objectContaining({ x: 0, y: 0.36, z: 0.5 }),
    );
    expect(overrides.printPlacement).toEqual(overrides.printItems[0].placement);
    expect(renderer.pendingPersonalizationConstraints.size).toBe(3);

    renderer.state = { ...renderer.state, overrides };
    renderer.updatePrintLayer();
    expect(onStateNormalize).toHaveBeenCalledOnce();
    expect(renderer.pendingPersonalizationConstraints.size).toBe(0);
    renderer.dispose();
  });

  it('rebuilds only the decal whose rotation changes and disposes its old geometry', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const jersey = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    const placement = {
      x: 0,
      y: 0,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    };
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [
          { id: 'first', text: 'FIRST', placement, rotation: 0 },
          { id: 'second', text: 'SECOND', placement: { ...placement, x: 0.4 }, rotation: 0 },
        ],
      },
    };
    renderer.updatePrintLayer();
    const first = renderer.printLayers.get('text:first');
    const second = renderer.printLayers.get('text:second');
    const oldFirstGeometry = first.decal.geometry;
    const oldSecondGeometry = second.decal.geometry;
    const dispose = vi.spyOn(oldFirstGeometry, 'dispose');

    renderer.state.overrides.customTextItems[0].rotation = 45;
    renderer.updatePrintLayer();

    expect(first.decal.geometry).not.toBe(oldFirstGeometry);
    expect(dispose).toHaveBeenCalledOnce();
    expect(second.decal.geometry).toBe(oldSecondGeometry);
    renderer.dispose();
  });

  it('uses the proxy during continuous rotation and rebuilds one final decal', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const jersey = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    const makeState = (rotation) => ({
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'MASON',
          placement: {
            x: 0,
            y: 0,
            z: 0.218,
            normal: { x: 0, y: 0, z: 1 },
          },
          rotation,
          scale: 1,
        }],
      },
    });
    renderer.state = makeState(0);
    renderer.updatePrintLayer();
    const layer = renderer.printLayers.get('text:text-1');
    const initialGeometry = layer.decal.geometry;
    const initialDispose = vi.spyOn(initialGeometry, 'dispose');

    renderer.beginPersonalizationRotation('text:text-1');
    for (const rotation of [15, 30, 45]) {
      renderer.previewPersonalizationRotation('text:text-1', rotation);
    }

    expect(renderer.state.overrides.customTextItems[0].rotation).toBe(0);
    expect(layer.plane.userData.rotation).toBe(45);
    expect(layer.decal.geometry).toBe(initialGeometry);
    expect(initialDispose).not.toHaveBeenCalled();
    expect(layer.plane.material.opacity).toBe(1);
    expect(layer.decal.visible).toBe(false);

    renderer.endPersonalizationRotation('text:text-1', 70);

    const finalGeometry = layer.decal.geometry;
    expect(finalGeometry).not.toBe(initialGeometry);
    expect(initialDispose).toHaveBeenCalledOnce();
    expect(layer.plane.userData.rotation).toBe(70);
    expect(layer.plane.material.opacity).toBe(0);
    expect(layer.decal.visible).toBe(true);

    renderer.state = makeState(70);
    renderer.updatePrintLayer();
    expect(layer.decal.geometry).toBe(finalGeometry);
    renderer.dispose();
  });

  it('restores the last published rotation and clears preview state when mutations lock', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const jersey = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    jersey.updateMatrixWorld(true);
    const makeState = (rotation) => ({
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'MASON',
          placement: {
            x: 0,
            y: 0,
            z: 0.218,
            normal: { x: 0, y: 0, z: 1 },
          },
          rotation,
          scale: 1,
        }],
      },
    });
    renderer.decorationMeshes = [jersey];
    renderer.state = makeState(0);
    renderer.updatePrintLayer();
    const layer = renderer.printLayers.get('text:text-1');
    renderer.beginPersonalizationRotation('text:text-1');
    renderer.state = makeState(45);
    renderer.updatePrintLayer();
    expect(layer.decal.visible).toBe(false);

    renderer.setPersonalizationMutationDisabled(true);

    expect(renderer.rotationPreviewKey).toBeNull();
    expect(layer.plane.userData.rotation).toBe(45);
    expect(layer.plane.material.opacity).toBe(0);
    expect(layer.decal.visible).toBe(true);
    renderer.dispose();
  });

  it('rebuilds one decal for a discrete keyboard rotation update', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const jersey = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    const item = {
      id: 'text-1',
      text: 'MASON',
      placement: {
        x: 0,
        y: 0,
        z: 0.218,
        normal: { x: 0, y: 0, z: 1 },
      },
      rotation: 0,
      scale: 1,
    };
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [item] },
    };
    renderer.updatePrintLayer();
    const layer = renderer.printLayers.get('text:text-1');
    const initialGeometry = layer.decal.geometry;
    const dispose = vi.spyOn(initialGeometry, 'dispose');

    renderer.state = {
      ...renderer.state,
      overrides: {
        customTextItems: [{ ...item, rotation: 5 }],
      },
    };
    renderer.updatePrintLayer();

    expect(layer.decal.geometry).not.toBe(initialGeometry);
    expect(dispose).toHaveBeenCalledOnce();
    renderer.dispose();
  });

  it('shows the proxy during drag and rebuilds the final decal before publishing placement', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onStatePatch });
    const jersey = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'MASON',
          placement: {
            x: 0,
            y: 0,
            z: 0.5,
            normal: { x: 0, y: 0, z: 1 },
          },
        }],
      },
    };
    renderer.updatePrintLayer();
    renderer.setActivePrintId('text:text-1');
    const layer = renderer.printLayers.get('text:text-1');
    const oldGeometry = layer.decal.geometry;
    renderer.pickPrint = vi.fn(() => ({
      object: layer.plane,
      point: layer.plane.localToWorld(new THREE.Vector3()),
    }));
    renderer.pickJersey = vi.fn(() => ({
      object: jersey,
      face: { normal: new THREE.Vector3(0, 0, 1) },
      point: new THREE.Vector3(0.4, 0.2, 0.2),
    }));

    renderer.handlePointerDown(pointerEvent(100, 100));
    renderer.handlePointerMove(pointerEvent(110, 100));

    expect(layer.plane.material.opacity).toBe(1);
    expect(layer.decal.visible).toBe(false);

    renderer.handlePointerUp();

    expect(layer.decal.geometry).not.toBe(oldGeometry);
    expect(layer.plane.material.opacity).toBe(0);
    expect(layer.decal.visible).toBe(true);
    expect(onStatePatch).toHaveBeenCalledOnce();
    renderer.dispose();
  });

  it('rebuilds from the cloned final garment hit when the dragged proxy center misses the mesh', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onStatePatch });
    const jersey = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'A WIDE NAME',
          placement: {
            x: 0,
            y: 0,
            z: 0.018,
            normal: { x: 0, y: 0, z: 1 },
          },
        }],
      },
    };
    renderer.updatePrintLayer();
    renderer.setActivePrintId('text:text-1');
    const layer = renderer.printLayers.get('text:text-1');
    layer.plane.updateMatrixWorld(true);
    const grabPoint = layer.plane.localToWorld(new THREE.Vector3(-0.5, 0, 0));
    const finalHit = {
      object: jersey,
      face: { normal: new THREE.Vector3(0, 0, 1) },
      point: new THREE.Vector3(0.2, 0, 0),
    };
    renderer.pickPrint = vi.fn(() => ({ object: layer.plane, point: grabPoint }));
    renderer.pickJersey = vi.fn(() => finalHit);

    renderer.handlePointerDown(pointerEvent(100, 100));
    renderer.handlePointerMove(pointerEvent(110, 100));

    expect(layer.plane.position.x).toBeCloseTo(0.7, 6);
    expect(renderer.activePrintDrag.latestSurface.point).not.toBe(finalHit.point);
    expect(renderer.activePrintDrag.latestSurface.normal).not.toBe(finalHit.face.normal);
    finalHit.point.set(99, 99, 99);
    finalHit.face.normal.set(1, 0, 0);
    expect(renderer.activePrintDrag.latestSurface.point.toArray()).toEqual([0.2, 0, 0]);
    expect(renderer.activePrintDrag.latestSurface.normal.toArray()).toEqual([0, 0, 1]);

    renderer.handlePointerUp();

    const positions = layer.decal.geometry.getAttribute('position');
    expect(layer.decal.visible).toBe(true);
    expect(layer.plane.material.opacity).toBe(0);
    expect(positions.count).toBeGreaterThan(0);
    expect([...positions.array].every(Number.isFinite)).toBe(true);
    expect(onStatePatch).toHaveBeenCalledOnce();
    renderer.dispose();
  });

  it('restores a center-miss decal after state writeback and a JSON design roundtrip', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onStatePatch });
    const jersey = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'A WIDE NAME',
          placement: {
            x: 0,
            y: 0,
            z: 0.018,
            normal: { x: 0, y: 0, z: 1 },
          },
        }],
      },
    };
    renderer.updatePrintLayer();
    renderer.setActivePrintId('text:text-1');
    const layer = renderer.printLayers.get('text:text-1');
    layer.plane.updateMatrixWorld(true);
    renderer.pickPrint = vi.fn(() => ({
      object: layer.plane,
      point: layer.plane.localToWorld(new THREE.Vector3(-0.5, 0, 0)),
    }));
    renderer.pickJersey = vi.fn(() => ({
      object: jersey,
      face: { normal: new THREE.Vector3(0, 0, 1) },
      point: new THREE.Vector3(0.2, 0, 0),
    }));

    renderer.handlePointerDown(pointerEvent(100, 100));
    renderer.handlePointerMove(pointerEvent(110, 100));
    renderer.handlePointerUp();
    const savedItems = resolveLastStatePatch(onStatePatch, renderer.state)
      .overrides.customTextItems;
    renderer.state = {
      ...renderer.state,
      overrides: { ...renderer.state.overrides, customTextItems: savedItems },
    };
    renderer.updatePrintLayer();

    expect(savedItems[0].placement.x).toBeCloseTo(0.7, 6);
    expect(layer.decal.visible).toBe(true);
    expect(layer.decal.geometry.getAttribute('position').count).toBeGreaterThan(0);

    const reopenedHost = document.createElement('div');
    document.body.append(reopenedHost);
    const reopened = new GarmentRenderer(reopenedHost);
    reopened.decorationMeshes = [jersey];
    reopened.state = JSON.parse(JSON.stringify(renderer.state));
    reopened.updatePrintLayer();
    const reopenedLayer = reopened.printLayers.get('text:text-1');
    expect(reopenedLayer.decal.visible).toBe(true);
    expect(reopenedLayer.decal.geometry.getAttribute('position').count).toBeGreaterThan(0);
    reopened.dispose();
    renderer.dispose();
  });

  it.each([
    {
      label: 'pointer cancellation',
      interrupt(renderer) {
        renderer.handlePointerCancel();
      },
    },
    {
      label: 'mutation lock',
      interrupt(renderer) {
        renderer.setPersonalizationMutationDisabled(true);
      },
    },
  ])('rolls an interrupted drag back to state on $label without emitting', ({ interrupt }) => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onStatePatch });
    const jersey = new THREE.Mesh(
      new THREE.BoxGeometry(3, 3, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    jersey.updateMatrixWorld(true);
    const item = {
      id: 'text-1',
      text: 'MASON',
      placement: {
        x: 0.1,
        y: 0.2,
        z: 0.218,
        normal: { x: 0, y: 0, z: 1 },
      },
      rotation: 30,
      scale: 1.2,
    };
    renderer.decorationMeshes = [jersey];
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [item] },
    };
    renderer.updatePrintLayer();
    renderer.setActivePrintId('text:text-1');
    const layer = renderer.printLayers.get('text:text-1');
    layer.plane.updateMatrixWorld(true);
    renderer.pickPrint = vi.fn(() => ({
      object: layer.plane,
      point: layer.plane.localToWorld(new THREE.Vector3()),
    }));
    renderer.pickJersey = vi.fn(() => ({
      object: jersey,
      face: { normal: new THREE.Vector3(1, 0, 0) },
      point: new THREE.Vector3(0.2, 0.8, 0.7),
    }));

    renderer.handlePointerDown(pointerEvent(100, 100));
    renderer.handlePointerMove(pointerEvent(110, 100));
    expect(layer.plane.position.distanceTo(new THREE.Vector3(
      item.placement.x,
      item.placement.y,
      item.placement.z,
    ))).toBeGreaterThan(0.5);

    interrupt(renderer);

    expect(layer.plane.position.toArray()).toEqual([
      item.placement.x,
      item.placement.y,
      item.placement.z,
    ]);
    expect(layer.plane.scale.toArray()).toEqual([item.scale, item.scale, item.scale]);
    expect(layer.plane.userData.rotation).toBe(item.rotation);
    expect(layer.plane.material.opacity).toBe(0);
    expect(layer.decal.visible).toBe(true);
    expect(renderer.activePrintDrag).toBeNull();
    expect(onStatePatch).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it('clears the latest garment hit as soon as a model switch starts', async () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'text-1', text: 'MASON' }] },
    };
    renderer.updatePrintLayer();
    renderer.setActivePrintId('text:text-1');
    renderer.isDraggingPrint = true;
    renderer.activePrintDrag = {
      latestSurface: {
        mesh: new THREE.Mesh(),
        normal: new THREE.Vector3(0, 0, 1),
        point: new THREE.Vector3(),
      },
    };
    const pending = deferred();
    renderer.loader = { loadAsync: vi.fn(() => pending.promise) };

    const load = renderer.loadModel('next.glb');

    expect(renderer.activePrintDrag).toBeNull();
    expect(renderer.isDraggingPrint).toBe(false);
    renderer.dispose();
    pending.resolve({ scene: new THREE.Group() });
    await load;
  });

  it('disposes proxy and decal resources without disposing the shared texture twice', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    const jersey = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 0.4),
      new THREE.MeshBasicMaterial(),
    );
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'text-1',
          text: 'MASON',
          placement: {
            x: 0,
            y: 0,
            z: 0.5,
            normal: { x: 0, y: 0, z: 1 },
          },
        }],
      },
    };
    renderer.updatePrintLayer();
    const layer = renderer.printLayers.get('text:text-1');
    const proxyGeometryDispose = vi.spyOn(layer.plane.geometry, 'dispose');
    const decalGeometryDispose = vi.spyOn(layer.decal.geometry, 'dispose');
    const proxyMaterialDispose = vi.spyOn(layer.material, 'dispose');
    const decalMaterialDispose = vi.spyOn(layer.decalMaterial, 'dispose');
    const textureDispose = vi.spyOn(layer.texture, 'dispose');

    renderer.state.overrides.customTextItems[0].text = ' ';
    renderer.updatePrintLayer();

    expect(proxyGeometryDispose).toHaveBeenCalledOnce();
    expect(decalGeometryDispose).toHaveBeenCalledOnce();
    expect(proxyMaterialDispose).toHaveBeenCalledOnce();
    expect(decalMaterialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
    renderer.dispose();
  });

  it('renders player and text layers independently when their raw ids match', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.state = {
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'same-id', name: 'PLAYER', number: '16' }],
        customTextItems: [{ id: 'same-id', text: 'MASON' }],
      },
    };

    renderer.updatePrintLayer();

    expect([...renderer.printLayers.keys()]).toEqual(['player:same-id', 'text:same-id']);
    expect(renderer.printLayers.get('player:same-id').plane.userData)
      .toMatchObject({ printId: 'player:same-id', itemKind: 'player', sourceId: 'same-id' });
    expect(renderer.printLayers.get('text:same-id').plane.userData)
      .toMatchObject({ printId: 'text:same-id', itemKind: 'text', sourceId: 'same-id' });
    renderer.dispose();
  });

  it('renders duplicate raw player ids as independent normalized layers', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const renderer = new GarmentRenderer(host);
    renderer.state = {
      lighting: 'name-number',
      overrides: {
        printItems: [
          { id: 'same-id', name: 'FIRST', number: '10' },
          { id: 'same-id', name: 'SECOND', number: '20' },
        ],
      },
    };

    renderer.updatePrintLayer();

    expect([...renderer.printLayers.keys()]).toEqual(['player:same-id', 'player:print-2']);
    expect(renderer.printLayers.get('player:same-id').plane.userData.sourceId).toBe('same-id');
    expect(renderer.printLayers.get('player:print-2').plane.userData.sourceId).toBe('print-2');
    renderer.dispose();
  });

  it('mutates only the selected normalized player when duplicate raw ids are supplied', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onStatePatch });
    renderer.state = {
      lighting: 'name-number',
      overrides: {
        printItems: [
          { id: 'same-id', name: 'FIRST', number: '10' },
          { id: 'same-id', name: 'SECOND', number: '20' },
        ],
      },
    };
    renderer.updatePrintLayer();
    renderer.setActivePrintId('player:print-2');
    renderer.printPlane.position.set(0.4, 0.5, 0.6);

    renderer.emitPrintPlacement();

    expect(resolveLastStatePatch(onStatePatch, renderer.state)).toEqual({
      overrides: {
        printItems: [
          expect.objectContaining({ id: 'same-id', name: 'FIRST', placement: null }),
          expect.objectContaining({
            id: 'print-2',
            name: 'SECOND',
            placement: expect.objectContaining({ x: 0.4, y: 0.5, z: 0.6 }),
          }),
        ],
        printName: 'FIRST',
        printNumber: '10',
        printPlacement: null,
      },
    });
    renderer.dispose();
  });

  it('emits placement to the exact composite-key source when raw ids match', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onStatePatch });
    renderer.state = {
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'same-id', name: 'PLAYER', number: '16' }],
        customTextItems: [{ id: 'same-id', text: 'MASON' }],
      },
    };
    renderer.updatePrintLayer();

    renderer.setActivePrintId('text:same-id');
    renderer.printPlane.position.set(0.1, 0.2, 0.3);
    renderer.emitPrintPlacement();
    expect(resolveLastStatePatch(onStatePatch, renderer.state)).toEqual({
      overrides: {
        customTextItems: [expect.objectContaining({
          id: 'same-id',
          placement: expect.objectContaining({ x: 0.1, y: 0.2, z: 0.3 }),
        })],
      },
    });

    renderer.setActivePrintId('player:same-id');
    renderer.printPlane.position.set(0.4, 0.5, 0.6);
    renderer.emitPrintPlacement();
    expect(resolveLastStatePatch(onStatePatch, renderer.state)).toEqual({
      overrides: {
        printItems: [expect.objectContaining({
          id: 'same-id',
          placement: expect.objectContaining({ x: 0.4, y: 0.5, z: 0.6 }),
        })],
        printName: 'PLAYER',
        printNumber: '16',
        printPlacement: expect.objectContaining({ x: 0.4, y: 0.5, z: 0.6 }),
      },
    });
    renderer.dispose();
  });

  it('keeps a rotated edge grab under the pointer while dragging across surfaces', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const onPrintSelectionChange = vi.fn();
    const renderer = new GarmentRenderer(host, { onPrintSelectionChange, onStatePatch });
    renderer.state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'custom-id',
          text: 'MASON',
          rotation: 45,
          placement: { x: 0, y: 0.36, z: 0.5 },
        }],
      },
    };
    const jersey = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    jersey.updateMatrixWorld(true);
    renderer.decorationMeshes = [jersey];
    renderer.updatePrintLayer();
    const plane = renderer.printLayers.get('text:custom-id').plane;
    plane.updateMatrixWorld(true);
    const localGrab = new THREE.Vector3(0.4, 0.05, 0);
    const worldGrab = plane.localToWorld(localGrab.clone());
    renderer.pickPrint = vi.fn(() => ({ object: plane, point: worldGrab }));
    const surfaceHit = {
      object: jersey,
      face: { normal: new THREE.Vector3(1, 0, 0) },
      point: new THREE.Vector3(2, 3, 4),
    };
    renderer.pickJersey = vi.fn(() => surfaceHit);
    renderer.syncPrintAnchor = vi.fn();

    renderer.handlePointerDown(pointerEvent(100, 100));
    renderer.handlePointerMove(pointerEvent(110, 100));

    const normal = new THREE.Vector3(1, 0, 0);
    const expectedQuaternion = getPersonalizationDecalOrientation(normal, 45);
    const expectedGrabPoint = surfaceHit.point.clone().addScaledVector(normal, 0.018);
    const expectedCenter = expectedGrabPoint.clone().sub(
      localGrab.clone().multiply(plane.scale).applyQuaternion(expectedQuaternion),
    );

    expect(onPrintSelectionChange).toHaveBeenCalledWith('text:custom-id');
    expect(plane.position.distanceTo(expectedCenter)).toBeLessThan(0.000001);
    expect(Math.abs(plane.quaternion.dot(expectedQuaternion))).toBeCloseTo(1, 6);

    renderer.handlePointerUp();

    expect(resolveLastStatePatch(onStatePatch, renderer.state)).toEqual({
      overrides: {
        customTextItems: [expect.objectContaining({ id: 'custom-id', rotation: 45 })],
      },
    });
    renderer.dispose();
  });

  it('keeps text upright while dragging across a curved back surface', () => {
    const renderer = Object.create(GarmentRenderer.prototype);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    renderer.activePrintId = 'text:custom-id';
    renderer.activePrintDrag = {
      grabOffset: new THREE.Vector3(),
      rotation: 0,
    };
    renderer.printLayers = new Map([['text:custom-id', { plane }]]);
    const normal = new THREE.Vector3(0, 0.02, -0.9998).normalize();
    const jersey = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    jersey.updateMatrixWorld(true);

    renderer.placePrintAtIntersection({
      face: { normal },
      object: jersey,
      point: new THREE.Vector3(0, 0.3, -0.5),
    });

    const garmentUp = new THREE.Vector3(0, 1, 0);
    const actualUp = garmentUp.clone().applyQuaternion(plane.quaternion);
    const expectedUp = garmentUp.clone()
      .addScaledVector(normal, -garmentUp.dot(normal))
      .normalize();
    expect(actualUp.dot(expectedUp)).toBeGreaterThan(0.999999);
    expect(renderer.activePrintDrag.rotation).toBe(0);
  });

  it('does not fall back to another layer for an explicitly missing active key', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onStatePatch });
    renderer.state = {
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'other-id', text: 'OTHER' }] },
    };
    renderer.updatePrintLayer();

    renderer.setActivePrintId('text:missing');

    expect(renderer.printPlane).toBeNull();
    renderer.emitPrintPlacement();
    expect(onStatePatch).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it.each([
    {
      name: 'custom text becomes blank',
      initialState: {
        lighting: 'none',
        overrides: { customTextItems: [{ id: 'active', text: 'MASON' }] },
      },
      activeKey: 'text:active',
      nextState: {
        lighting: 'none',
        overrides: { customTextItems: [{ id: 'active', text: '   ' }] },
      },
      expectedActiveKey: 'text:active',
      remainingKeys: [],
    },
    {
      name: 'player lighting is hidden while text remains',
      initialState: {
        lighting: 'name-number',
        overrides: {
          printItems: [{ id: 'active', name: 'PLAYER', number: '16' }],
          customTextItems: [{ id: 'other', text: 'OTHER' }],
        },
      },
      activeKey: 'player:active',
      nextState: {
        lighting: 'none',
        overrides: {
          printItems: [{ id: 'active', name: 'PLAYER', number: '16' }],
          customTextItems: [{ id: 'other', text: 'OTHER' }],
        },
      },
      expectedActiveKey: null,
      remainingKeys: ['text:other'],
    },
    {
      name: 'active item is deleted while another layer remains',
      initialState: {
        lighting: 'none',
        overrides: {
          customTextItems: [
            { id: 'active', text: 'MASON' },
            { id: 'other', text: 'OTHER' },
          ],
        },
      },
      activeKey: 'text:active',
      nextState: {
        lighting: 'none',
        overrides: { customTextItems: [{ id: 'other', text: 'OTHER' }] },
      },
      expectedActiveKey: null,
      remainingKeys: ['text:other'],
    },
  ])('cancels an active drag without writing when $name', ({
    activeKey,
    expectedActiveKey,
    initialState,
    nextState,
    remainingKeys,
  }) => {
    installTextCanvasContext();
    const host = document.createElement('div');
    document.body.append(host);
    const onPrintAnchorChange = vi.fn();
    const onStatePatch = vi.fn();
    const renderer = new GarmentRenderer(host, { onPrintAnchorChange, onStatePatch });
    renderer.state = initialState;
    renderer.updatePrintLayer();
    renderer.setActivePrintId(activeKey);
    renderer.pendingPrintDrag = { x: 1, y: 1 };
    renderer.activePrintDrag = { grabOffset: new THREE.Vector3(), rotation: 0 };
    renderer.isDraggingPrint = true;
    renderer.controls.enabled = false;
    renderer.lastPrintAnchor = { visible: true, left: 1, top: 1, width: 1, height: 1 };

    renderer.state = nextState;
    renderer.updatePrintLayer();
    renderer.handlePointerUp();

    expect([...renderer.printLayers.keys()]).toEqual(remainingKeys);
    expect(renderer.activePrintId).toBe(expectedActiveKey);
    expect(renderer.pendingPrintDrag).toBeNull();
    expect(renderer.activePrintDrag).toBeNull();
    expect(renderer.isDraggingPrint).toBe(false);
    expect(renderer.controls.enabled).toBe(true);
    expect(onPrintAnchorChange).toHaveBeenLastCalledWith({ visible: false });
    expect(onStatePatch).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it('restores a blanked active text layer without switching to another rendered item', () => {
    installTextCanvasContext();
    const host = document.createElement('div');
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
      x: 0,
      y: 0,
      toJSON() {},
    });
    document.body.append(host);
    const onPrintAnchorChange = vi.fn();
    const renderer = new GarmentRenderer(host, { onPrintAnchorChange });
    const makeState = (text) => ({
      lighting: 'name-number',
      overrides: {
        printItems: [{
          id: 'player',
          name: 'PLAYER',
          number: '16',
          placement: { x: -0.45, y: 0.36, z: 0.5 },
        }],
        customTextItems: [{
          id: 'active',
          text,
          placement: { x: 0.45, y: 0.36, z: 0.5 },
        }],
      },
    });
    renderer.state = makeState('MASON');
    renderer.updatePrintLayer();
    renderer.setActivePrintId('text:active');
    const originalTextPlane = renderer.printPlane;

    renderer.pendingPrintDrag = { x: 1, y: 1 };
    renderer.isDraggingPrint = true;
    renderer.controls.enabled = false;
    renderer.state = makeState('   ');
    renderer.updatePrintLayer();

    expect([...renderer.printLayers.keys()]).toEqual(['player:player']);
    expect(renderer.activePrintId).toBe('text:active');
    expect(renderer.printPlane).toBeNull();
    expect(renderer.isDraggingPrint).toBe(false);
    expect(renderer.controls.enabled).toBe(true);
    expect(onPrintAnchorChange).toHaveBeenLastCalledWith({ visible: false });

    renderer.state = makeState('MASON AGAIN');
    renderer.updatePrintLayer();

    const restoredTextPlane = renderer.printLayers.get('text:active').plane;
    expect(restoredTextPlane).not.toBe(originalTextPlane);
    expect(renderer.activePrintId).toBe('text:active');
    expect(renderer.printPlane).toBe(restoredTextPlane);
    expect(renderer.printPlane).not.toBe(renderer.printLayers.get('player:player').plane);
    expect(renderer.lastPrintAnchor).toMatchObject({ visible: true });
    expect(onPrintAnchorChange).toHaveBeenLastCalledWith(renderer.lastPrintAnchor);
    renderer.dispose();
  });

  it('clears selection instead of placing a print when a pointer misses a print and decoration', () => {
    expect(getPrintPointerDownAction({ hasPrintHit: false, handledDecoration: false })).toBe('deselect-print');
  });

  it('does not start a drag until the pointer has moved more than four pixels', () => {
    expect(hasExceededPrintDragThreshold({ x: 100, y: 100 }, { clientX: 103, clientY: 102 })).toBe(false);
    expect(hasExceededPrintDragThreshold({ x: 100, y: 100 }, { clientX: 105, clientY: 103 })).toBe(true);
  });

  it('clears selected artwork after a short blank-canvas click', () => {
    const renderer = createPointerRenderer({ selectedDecorationId: 'crest' });
    const event = pointerEvent(100, 100);

    renderer.handlePointerDown(event);
    expect(renderer.decorationEditor.clearSelection).not.toHaveBeenCalled();
    expect(renderer.pendingDecorationDeselect).toEqual({ x: 100, y: 100 });
    renderer.handlePointerUp();

    expect(renderer.decorationEditor.clearSelection).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(renderer.pendingDecorationDeselect).toBeNull();
  });

  it('keeps selected artwork and orbit controls enabled after dragging from blank canvas', () => {
    const renderer = createPointerRenderer({ selectedDecorationId: 'crest' });
    const event = pointerEvent(100, 100);

    renderer.handlePointerDown(event);
    renderer.handlePointerMove(pointerEvent(106, 100));
    renderer.handlePointerUp();

    expect(renderer.decorationEditor.clearSelection).not.toHaveBeenCalled();
    expect(renderer.controls.enabled).toBe(true);
    expect(renderer.pendingDecorationDeselect).toBeNull();
  });

  it('does not queue artwork deselection for artwork or print hits', () => {
    const artworkRenderer = createPointerRenderer({ selectedDecorationId: 'crest', decorationHit: true });
    const artworkEvent = pointerEvent(100, 100);
    artworkRenderer.handlePointerDown(artworkEvent);

    const printRenderer = createPointerRenderer({
      selectedDecorationId: 'crest',
      printHit: { object: { userData: { printId: 'number-1' } } },
    });
    const printEvent = pointerEvent(100, 100);
    printRenderer.handlePointerDown(printEvent);

    expect(artworkRenderer.pendingDecorationDeselect).toBeNull();
    expect(artworkEvent.preventDefault).toHaveBeenCalledOnce();
    expect(artworkRenderer.decorationEditor.clearSelection).not.toHaveBeenCalled();
    expect(printRenderer.pendingDecorationDeselect).toBeNull();
    expect(printEvent.preventDefault).toHaveBeenCalledOnce();
    expect(printRenderer.decorationEditor.clearSelection).not.toHaveBeenCalled();
  });

  it('clears a pending artwork deselection when print layers are disposed', () => {
    const renderer = createPointerRenderer();
    renderer.printLayers = new Map();
    renderer.activePrintId = 'number-1';
    renderer.pendingDecorationDeselect = { x: 100, y: 100 };

    renderer.disposePrintLayer();

    expect(renderer.pendingDecorationDeselect).toBeNull();
  });

  it('clears a pending artwork deselection during renderer disposal', () => {
    const renderer = createPointerRenderer();
    renderer.pendingDecorationDeselect = { x: 100, y: 100 };

    renderer.dispose();

    expect(renderer.pendingDecorationDeselect).toBeNull();
  });

  it('clears pending pointer gestures when the browser cancels the pointer', () => {
    const renderer = createPointerRenderer();
    renderer.pendingDecorationDeselect = { x: 100, y: 100 };
    renderer.pendingPrintDrag = { x: 100, y: 100 };
    renderer.isDraggingPrint = true;
    renderer.controls.enabled = false;

    renderer.handlePointerCancel();

    expect(renderer.pendingDecorationDeselect).toBeNull();
    expect(renderer.pendingPrintDrag).toBeNull();
    expect(renderer.isDraggingPrint).toBe(false);
    expect(renderer.controls.enabled).toBe(true);
    expect(renderer.decorationEditor.clearSelection).not.toHaveBeenCalled();
    expect(renderer.emitPrintPlacement).not.toHaveBeenCalled();
  });

  it('cancels an artwork preview without routing it through pointer-up commit', () => {
    const renderer = createPointerRenderer({ decorationHit: true });

    renderer.handlePointerDown(pointerEvent(100, 100));
    renderer.handlePointerCancel();

    expect(renderer.decorationEditor.handlePointerCancel).toHaveBeenCalledOnce();
    expect(renderer.decorationEditor.handlePointerUp).not.toHaveBeenCalled();
    expect(renderer.controls.enabled).toBe(true);
  });
});
