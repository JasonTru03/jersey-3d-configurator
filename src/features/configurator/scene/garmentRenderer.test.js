import { describe, expect, it, vi } from 'vitest';
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
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
});
vi.stubGlobal('requestAnimationFrame', () => 1);

import * as THREE from 'three';
import gsap from 'gsap';
import { GarmentRenderer, getNextPrintPlacement, getPrintPointerDownAction, getPrintSelectionRect, hasExceededPrintDragThreshold, hasPrintSelectionRectChanged, selectDecorationMeshes, shouldEnableOrbitControls } from './garmentRenderer.js';

function createPointerRenderer({ selectedDecorationId = null, printHit = null, decorationHit = false } = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const renderer = new GarmentRenderer(host);
  renderer.pickPrint = vi.fn(() => printHit);
  renderer.decorationEditor = {
    selectedId: selectedDecorationId,
    handlePointerDown: vi.fn(() => decorationHit),
    handlePointerMove: vi.fn(() => false),
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

function makeModel(map) {
  const model = new THREE.Group();
  model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map })));
  return model;
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
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
    renderer.product = { decorationPresets: [] };
    renderer.loader = {
      loadAsync: vi.fn()
        .mockResolvedValueOnce({ scene: makeModel(firstMap) })
        .mockResolvedValueOnce({ scene: makeModel(secondMap) }),
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
});
