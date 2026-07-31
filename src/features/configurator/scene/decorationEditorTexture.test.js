import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecorationEditor } from './decorationEditor.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4AWL6z8DwH4SZGKAAAAAA//8qMqaOAAAABklEQVQDADYSBAFv606fAAAAAElFTkSuQmCC';
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z';
const PRESET_DATA_URL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 140"%3E%3Cpath fill="%23000" d="M0 0h120v140H0z"/%3E%3C/svg%3E';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('decoration artwork textures', () => {
  it.each([
    {
      expectedSource: PNG_DATA_URL,
      height: 689,
      kind: 'upload',
      label: 'PNG upload',
      presets: [],
      source: PNG_DATA_URL,
      width: 977,
    },
    {
      expectedSource: JPEG_DATA_URL,
      height: 428,
      kind: 'upload',
      label: 'JPEG upload',
      presets: [],
      source: JPEG_DATA_URL,
      width: 571,
    },
    {
      expectedSource: PRESET_DATA_URL,
      height: 140,
      kind: 'badge',
      label: 'preset',
      presets: [{ source: 'crest-badge', assetUrl: PRESET_DATA_URL }],
      source: 'crest-badge',
      width: 120,
    },
  ])('draws a decoded $label into the existing GPU-sized canvas', async ({
    expectedSource,
    height,
    kind,
    presets,
    source,
    width,
  }) => {
    const drawImage = vi.fn();
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue({ drawImage });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => (
      tagName === 'canvas' ? canvas : createElement(tagName, options)
    ));
    let decodedImage;
    vi.stubGlobal('Image', class {
      naturalHeight = height;

      naturalWidth = width;

      set src(value) {
        this.currentSrc = value;
        decodedImage = this;
        queueMicrotask(() => this.onload?.());
      }
    });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    mesh.updateMatrixWorld(true);
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('div'),
      scene: new THREE.Scene(),
    });
    const decoration = {
      id: `${kind}-texture`,
      kind,
      label: `${kind} texture`,
      placement: {
        normal: { x: 0, y: 0, z: 1 },
        position: { x: 0, y: 0.42, z: 1 },
        region: 'front',
      },
      region: 'front',
      rotation: 0,
      scale: 1,
      source,
      x: 0,
      y: 0,
    };

    editor.setGarmentMeshes([mesh]);
    editor.update([decoration], decoration.id, presets);
    await editor.waitForTextures();

    const surface = editor.surfaces.get(decoration.id);
    expect(decodedImage.currentSrc).toBe(expectedSource);
    expect(surface.material.map.image).toBe(canvas);
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(256);
    expect(drawImage).toHaveBeenCalledWith(decodedImage, 0, 0, 256, 256);
    expect(surface.material.map.version).toBeGreaterThanOrEqual(2);
    expect(surface.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(editor.getProductionLayers()).toEqual([
      expect.objectContaining({
        garmentMesh: mesh,
        geometry: surface.geometry,
        id: decoration.id,
        kind: 'artwork',
        label: decoration.label,
        renderOrder: surface.renderOrder,
        surface,
        textureSource: canvas,
      }),
    ]);

    editor.dispose();
  });

  it('rejects production readiness when artwork decoding fails', async () => {
    vi.stubGlobal('Image', class {
      set src(_value) {
        queueMicrotask(() => this.onerror?.());
      }
    });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    mesh.updateMatrixWorld(true);
    const editor = new DecorationEditor({
      camera: new THREE.PerspectiveCamera(),
      domElement: document.createElement('div'),
      scene: new THREE.Scene(),
    });
    editor.setGarmentMeshes([mesh]);
    editor.update([{
      id: 'broken-upload',
      kind: 'upload',
      label: 'Broken upload',
      placement: {
        normal: { x: 0, y: 0, z: 1 },
        position: { x: 0, y: 0.42, z: 1 },
        region: 'front',
      },
      region: 'front',
      rotation: 0,
      scale: 1,
      source: 'data:image/png;base64,broken',
    }], null, []);

    await expect(editor.waitForTextures())
      .rejects.toThrow('图案 "Broken upload" 加载失败。');

    editor.dispose();
  });
});
