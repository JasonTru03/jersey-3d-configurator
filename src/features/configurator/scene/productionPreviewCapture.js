import * as THREE from 'three';

export const PRODUCTION_PREVIEW_SIZE = 1600;

const VIEW_PRESETS = Object.freeze({
  front: {
    position: [0, 1.8, 5.4],
    target: [0, 0.7, 0],
  },
  back: {
    position: [0, 1.8, -5.4],
    target: [0, 0.7, 0],
  },
});

export async function captureProductionPreviews({
  camera,
  controls,
  renderer,
  scene,
  setProductionCaptureMode,
  height = PRODUCTION_PREVIEW_SIZE,
  width = PRODUCTION_PREVIEW_SIZE,
}) {
  validateCaptureRequest({
    camera,
    controls,
    height,
    renderer,
    scene,
    setProductionCaptureMode,
    width,
  });
  const snapshot = snapshotRenderState({ camera, controls, renderer, scene });
  const target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
  });
  let front;
  let back;

  try {
    setProductionCaptureMode(true);
    scene.background = new THREE.Color('#f3f1ec');
    front = await captureSide('front', {
      camera,
      controls,
      height,
      renderer,
      scene,
      target,
      width,
    });
    back = await captureSide('back', {
      camera,
      controls,
      height,
      renderer,
      scene,
      target,
      width,
    });
    return { front, back };
  } catch (error) {
    releasePreviewCanvas(front?.canvas);
    releasePreviewCanvas(back?.canvas);
    throw error;
  } finally {
    try {
      restoreRenderState(snapshot, {
        camera,
        controls,
        renderer,
        scene,
      });
    } finally {
      setProductionCaptureMode(false);
      target.dispose();
    }
  }
}

async function captureSide(side, {
  camera,
  controls,
  height,
  renderer,
  scene,
  target,
  width,
}) {
  const preset = VIEW_PRESETS[side];
  camera.position.fromArray(preset.position);
  controls.target.fromArray(preset.target);
  camera.aspect = width / height;
  camera.lookAt(controls.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    const sideLabel = side === 'front' ? '正面' : '背面';
    if (!context) throw new Error(`无法创建${sideLabel}预览画布。`);
    const imageData = context.createImageData(width, height);
    for (let row = 0; row < height; row += 1) {
      const sourceStart = (height - row - 1) * width * 4;
      imageData.data.set(
        pixels.subarray(sourceStart, sourceStart + width * 4),
        row * width * 4,
      );
    }
    context.putImageData(imageData, 0, 0);
    const blob = await canvasToPng(
      canvas,
      `无法编码${sideLabel}预览 PNG。`,
    );
    return {
      blob,
      canvas,
      height,
      width,
    };
  } catch (error) {
    releasePreviewCanvas(canvas);
    throw error;
  }
}

function releasePreviewCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

function snapshotRenderState({ camera, controls, renderer, scene }) {
  return {
    aspect: camera.aspect,
    background: scene.background,
    controlsEnabled: controls.enabled,
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    renderTarget: renderer.getRenderTarget(),
    target: controls.target.clone(),
  };
}

function restoreRenderState(snapshot, {
  camera,
  controls,
  renderer,
  scene,
}) {
  camera.position.copy(snapshot.position);
  camera.quaternion.copy(snapshot.quaternion);
  camera.aspect = snapshot.aspect;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  controls.target.copy(snapshot.target);
  controls.enabled = snapshot.controlsEnabled;
  scene.background = snapshot.background;
  renderer.setRenderTarget(snapshot.renderTarget);
}

function canvasToPng(canvas, errorMessage) {
  if (typeof canvas.toBlob !== 'function') {
    throw new Error(errorMessage);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size) {
        resolve(blob);
        return;
      }
      reject(new Error(errorMessage));
    }, 'image/png');
  });
}

function validateCaptureRequest({
  camera,
  controls,
  height,
  renderer,
  scene,
  setProductionCaptureMode,
  width,
}) {
  if (
    !camera
    || !controls?.target
    || !renderer?.render
    || !renderer?.readRenderTargetPixels
    || !scene
    || typeof setProductionCaptureMode !== 'function'
  ) {
    throw new Error('3D 预览渲染器尚未准备完成。');
  }
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error('生产预览尺寸无效。');
  }
}
