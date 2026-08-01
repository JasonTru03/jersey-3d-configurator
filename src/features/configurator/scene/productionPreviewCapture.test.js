import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRODUCTION_PREVIEW_SIZE,
  captureProductionPreviews,
} from './productionPreviewCapture.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('production preview capture', () => {
  it('captures fixed front and back PNGs and restores all render state', async () => {
    const harness = createHarness();
    const before = snapshotHarness(harness);

    const result = await captureProductionPreviews({
      ...harness,
      height: 2,
      width: 4,
    });

    expect(PRODUCTION_PREVIEW_SIZE).toBe(1600);
    expect(result).toMatchObject({
      front: {
        blob: expect.objectContaining({ type: 'image/png' }),
        height: 2,
        width: 4,
      },
      back: {
        blob: expect.objectContaining({ type: 'image/png' }),
        height: 2,
        width: 4,
      },
    });
    expect(harness.renderer.render).toHaveBeenCalledTimes(2);
    expect(harness.setProductionCaptureMode.mock.calls).toEqual([[true], [false]]);
    expect(snapshotHarness(harness)).toEqual(before);
  });

  it('restores render state when pixel reading fails', async () => {
    const harness = createHarness();
    const before = snapshotHarness(harness);
    harness.renderer.readRenderTargetPixels.mockImplementation(() => {
      throw new Error('read failed');
    });

    await expect(captureProductionPreviews({
      ...harness,
      height: 2,
      width: 4,
    })).rejects.toThrow('read failed');

    expect(harness.setProductionCaptureMode.mock.calls).toEqual([[true], [false]]);
    expect(snapshotHarness(harness)).toEqual(before);
  });

  it('fails clearly when the front preview cannot be encoded', async () => {
    const harness = createHarness({ encodedBlob: null });

    await expect(captureProductionPreviews({
      ...harness,
      height: 2,
      width: 4,
    })).rejects.toThrow('无法编码正面预览 PNG。');
    expect(harness.setProductionCaptureMode).toHaveBeenLastCalledWith(false);
    expect(harness.canvases[0]).toMatchObject({ width: 0, height: 0 });
  });

  it('releases front and back canvases and preserves the original back encoding rejection', async () => {
    const rejection = new Error('back encoding failed');
    const harness = createHarness({ encodeErrorAt: 1, encodeRejection: rejection });

    await expect(captureProductionPreviews({
      ...harness,
      height: 2,
      width: 4,
    })).rejects.toBe(rejection);

    expect(harness.canvases).toHaveLength(2);
    expect(harness.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(harness.setProductionCaptureMode).toHaveBeenLastCalledWith(false);
  });
});

function createHarness({
  encodeErrorAt = -1,
  encodeRejection = null,
  encodedBlob = new Blob(['png'], { type: 'image/png' }),
} = {}) {
  const context = {
    createImageData: vi.fn((width, height) => ({
      data: new Uint8ClampedArray(width * height * 4),
      height,
      width,
    })),
    putImageData: vi.fn(),
  };
  const canvases = [];
  vi.spyOn(document, 'createElement').mockImplementation(() => {
    const index = canvases.length;
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback) => {
        if (index === encodeErrorAt) throw encodeRejection;
        callback(encodedBlob);
      }),
    };
    canvases.push(canvas);
    return canvas;
  });

  const camera = new THREE.PerspectiveCamera(34, 1.25, 0.1, 100);
  camera.position.set(2, 3, 4);
  camera.lookAt(0.5, 0.25, 0);
  camera.updateMatrixWorld(true);
  const controls = {
    enabled: false,
    target: new THREE.Vector3(0.5, 0.25, 0),
  };
  const originalTarget = { id: 'original-target' };
  const renderer = {
    getRenderTarget: vi.fn(() => originalTarget),
    readRenderTargetPixels: vi.fn((_target, _x, _y, width, height, pixels) => {
      pixels.fill(127, 0, width * height * 4);
    }),
    render: vi.fn(),
    setRenderTarget: vi.fn(),
  };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#123456');

  return {
    camera,
    canvases,
    controls,
    renderer,
    scene,
    setProductionCaptureMode: vi.fn(),
  };
}

function snapshotHarness({ camera, controls, renderer, scene }) {
  return {
    aspect: camera.aspect,
    background: scene.background?.getHexString(),
    controlsEnabled: controls.enabled,
    position: camera.position.toArray(),
    quaternion: camera.quaternion.toArray(),
    renderTarget: renderer.setRenderTarget.mock.calls.at(-1)?.[0] ?? renderer.getRenderTarget(),
    target: controls.target.toArray(),
  };
}
