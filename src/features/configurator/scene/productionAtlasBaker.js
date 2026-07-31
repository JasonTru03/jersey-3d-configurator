import * as THREE from 'three';

const MIN_LAYER_COVERAGE = 0.985;
const PNG_MIME_TYPE = 'image/png';

export async function bakeProductionAtlas({
  appearanceCanvas,
  atlasSize,
  garmentMeshes,
  layers,
  legacyPatternCanvas = null,
}) {
  if (!Number.isInteger(atlasSize) || atlasSize < 1) {
    throw new Error('UV Atlas 尺寸无效。');
  }
  validateGarmentUvs(garmentMeshes);
  if (!appearanceCanvas) throw new Error('服装外观 UV 画布尚未准备完成。');

  const canvas = document.createElement('canvas');
  canvas.width = atlasSize;
  canvas.height = atlasSize;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 UV Atlas 画布。');

  context.clearRect(0, 0, atlasSize, atlasSize);
  context.drawImage(appearanceCanvas, 0, 0, atlasSize, atlasSize);
  if (legacyPatternCanvas) {
    context.drawImage(legacyPatternCanvas, 0, 0, atlasSize, atlasSize);
  }

  const orderedLayers = (layers ?? [])
    .map((layer, index) => ({ layer, index }))
    .sort((first, second) => (
      (first.layer.renderOrder ?? 0) - (second.layer.renderOrder ?? 0)
      || first.index - second.index
    ))
    .map(({ layer }) => layer);
  for (const layer of orderedLayers) rasterizeLayer(context, atlasSize, layer);

  const blob = await canvasToPngBlob(canvas);
  return {
    blob,
    canvas,
    colorSpace: 'sRGB',
    height: atlasSize,
    width: atlasSize,
  };
}

function validateGarmentUvs(meshes) {
  if (!Array.isArray(meshes) || meshes.length === 0) {
    throw new Error('服装模型尚未准备完成。');
  }
  meshes.forEach((mesh) => {
    if (!mesh?.geometry?.attributes?.uv) {
      throw new Error(`服装网格 "${mesh?.name || 'unnamed'}" 缺少 UV。`);
    }
  });
}

function rasterizeLayer(context, size, layer) {
  const position = layer?.geometry?.attributes?.position;
  const sourceUv = layer?.geometry?.attributes?.uv;
  const textureSource = layer?.textureSource;
  if (
    !position
    || !sourceUv
    || !(layer?.garmentMesh || layer?.garmentMeshes?.length)
    || !layer?.surface
    || !textureSource
    || !textureSource.width
    || !textureSource.height
  ) {
    throw new Error(`生产图层 "${layer?.label || layer?.id || 'unknown'}" 数据不完整。`);
  }

  layer.surface.updateWorldMatrix?.(true, false);
  const garmentMeshes = layer.garmentMeshes?.length
    ? layer.garmentMeshes
    : [layer.garmentMesh];
  garmentMeshes.forEach((mesh) => mesh.updateWorldMatrix?.(true, false));
  const index = layer.geometry.index;
  const indexCount = index ? index.count : position.count;
  const triangleCount = Math.floor(indexCount / 3);
  let mappedCount = 0;

  for (let offset = 0; offset < triangleCount * 3; offset += 3) {
    const vertexIndexes = [0, 1, 2].map((corner) => (
      index ? index.getX(offset + corner) : offset + corner
    ));
    const sourcePoints = vertexIndexes.map((vertex) => ({
      x: sourceUv.getX(vertex) * textureSource.width,
      y: (1 - sourceUv.getY(vertex)) * textureSource.height,
    }));
    const worldPoints = vertexIndexes.map((vertex) => {
      const point = new THREE.Vector3().fromBufferAttribute(position, vertex);
      return layer.surface.localToWorld(point);
    });
    const normal = new THREE.Triangle(
      worldPoints[0],
      worldPoints[1],
      worldPoints[2],
    ).getNormal(new THREE.Vector3());
    if (normal.lengthSq() === 0) continue;
    const targetPoints = worldPoints.map((point) => (
      projectVertexToGarmentUv(garmentMeshes, point, normal, size)
    ));
    if (!targetPoints.every(Boolean)) continue;

    for (const seamCopy of getSeamTargets(targetPoints, size)) {
      drawMappedTriangle(context, textureSource, sourcePoints, seamCopy);
    }
    mappedCount += 1;
  }

  if (!triangleCount || mappedCount / triangleCount < MIN_LAYER_COVERAGE) {
    throw new Error(
      `生产图层 "${layer.label || layer.id || 'unknown'}" 无法完整映射到服装 UV。`,
    );
  }
}

function projectVertexToGarmentUv(garmentMeshes, point, normal, size) {
  const raycaster = new THREE.Raycaster(
    point.clone().addScaledVector(normal, 0.04),
    normal.clone().negate(),
    0,
    0.12,
  );
  const hit = raycaster.intersectObjects(garmentMeshes, false)
    .find((intersection) => intersection.uv);
  return hit?.uv
    ? { x: hit.uv.x * size, y: (1 - hit.uv.y) * size }
    : null;
}

function getSeamTargets(target, size) {
  const xValues = target.map((point) => point.x);
  if (Math.max(...xValues) - Math.min(...xValues) <= size / 2) return [target];
  const unwrapped = target.map((point) => ({
    ...point,
    x: point.x < size / 2 ? point.x + size : point.x,
  }));
  return [
    unwrapped,
    unwrapped.map((point) => ({ ...point, x: point.x - size })),
  ];
}

function drawMappedTriangle(context, image, source, target) {
  const matrix = solveAffine(source, target);
  if (!matrix) return;

  context.save();
  context.beginPath();
  context.moveTo(target[0].x, target[0].y);
  context.lineTo(target[1].x, target[1].y);
  context.lineTo(target[2].x, target[2].y);
  context.closePath();
  context.clip();
  context.setTransform(...matrix);
  context.drawImage(image, 0, 0);
  context.restore();
}

function solveAffine(source, target) {
  const [first, second, third] = source;
  const determinant = (
    first.x * (second.y - third.y)
    + second.x * (third.y - first.y)
    + third.x * (first.y - second.y)
  );
  if (Math.abs(determinant) < Number.EPSILON) return null;

  const solve = (values) => {
    const [one, two, three] = values;
    return [
      (
        one * (second.y - third.y)
        + two * (third.y - first.y)
        + three * (first.y - second.y)
      ) / determinant,
      (
        one * (third.x - second.x)
        + two * (first.x - third.x)
        + three * (second.x - first.x)
      ) / determinant,
      (
        one * (second.x * third.y - third.x * second.y)
        + two * (third.x * first.y - first.x * third.y)
        + three * (first.x * second.y - second.x * first.y)
      ) / determinant,
    ];
  };

  const [a, c, e] = solve(target.map((point) => point.x));
  const [b, d, f] = solve(target.map((point) => point.y));
  return [a, b, c, d, e, f];
}

function canvasToPngBlob(canvas) {
  if (typeof canvas.toBlob !== 'function') {
    throw new Error('此浏览器不支持 UV Atlas PNG 编码。');
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob?.size) {
        resolve(blob);
        return;
      }
      reject(new Error('无法编码 UV Atlas PNG。'));
    }, PNG_MIME_TYPE);
  });
}
