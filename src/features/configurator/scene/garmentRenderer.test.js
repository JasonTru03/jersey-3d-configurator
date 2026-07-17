import { describe, expect, it, vi } from 'vitest';
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

describe('garment decoration mesh selection', () => {
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
});
