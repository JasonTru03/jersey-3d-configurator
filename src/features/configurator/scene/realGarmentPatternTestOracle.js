const TEST_UV_AREA_EPSILON = 1e-12;

export const PINNED_REAL_GARMENT_TRIANGLE_COUNTS = Object.freeze({
  'chelsea-jersey': Object.freeze({ back: 12320, front: 10142 }),
  'fn8788-jersey': Object.freeze({ back: 7316, front: 6282 }),
});

export function collectRawRenderableUvTriangles(mesh) {
  const geometry = mesh?.geometry;
  const position = geometry?.getAttribute?.('position') ?? geometry?.attributes?.position;
  const uv = geometry?.getAttribute?.('uv') ?? geometry?.attributes?.uv;
  const index = geometry?.getIndex?.() ?? geometry?.index ?? null;
  if (!position || position.itemSize < 3 || !uv || uv.itemSize < 2) {
    return { coordinates: [], triangleCount: 0 };
  }

  const elementCount = index?.count ?? position.count;
  const coordinates = [];
  const seenVertexSets = new Set();
  for (const range of getVisibleDrawRanges(mesh, elementCount)) {
    for (let elementOffset = range.start; elementOffset + 2 < range.end; elementOffset += 3) {
      const vertices = [0, 1, 2].map((offset) => readVertex(
        mesh,
        position,
        uv,
        index,
        elementOffset + offset,
      ));
      if (vertices.some((vertex) => vertex === null)) continue;
      if (isDegenerateUvTriangle(vertices)) continue;
      const vertexSetKey = vertices
        .map(({ vertexIndex }) => vertexIndex)
        .sort((left, right) => left - right)
        .join(':');
      if (seenVertexSets.has(vertexSetKey)) continue;
      seenVertexSets.add(vertexSetKey);
      vertices.forEach(({ u, v }) => coordinates.push(u, v));
    }
  }

  return { coordinates, triangleCount: coordinates.length / 6 };
}

export function assertPinnedTriangleCounts(modelId, actual) {
  const expected = PINNED_REAL_GARMENT_TRIANGLE_COUNTS[modelId];
  if (!expected) throw new Error(`真实模型 "${modelId}" 缺少固定三角形计数。`);
  for (const region of ['front', 'back']) {
    if (actual?.[region] === expected[region]) continue;
    throw new Error(
      `真实模型 "${modelId}" 的 ${region} 三角形计数应为 ${expected[region]}，实际为 ${actual?.[region]}。`,
    );
  }
}

export function mapAtlasPointToPieceOutput(piece, atlasPoint, {
  rotation = piece?.rotation,
  mirrorX = piece?.mirrorX,
  outputTransform = { mirrorX: false, rotation: 0 },
  outputSize = { height: 4096, width: 4096 },
} = {}) {
  const layoutBounds = inverseOutputBounds(piece.outputBounds, outputTransform, outputSize);
  const relativePoint = {
    x: (atlasPoint.x - piece.sourceBounds.x) / piece.sourceBounds.width,
    y: (atlasPoint.y - piece.sourceBounds.y) / piece.sourceBounds.height,
  };
  let orientedPoint;
  switch (rotation) {
    case 0:
      orientedPoint = relativePoint;
      break;
    case 90:
      orientedPoint = { x: 1 - relativePoint.y, y: relativePoint.x };
      break;
    case 180:
      orientedPoint = { x: 1 - relativePoint.x, y: 1 - relativePoint.y };
      break;
    case 270:
      orientedPoint = { x: relativePoint.y, y: 1 - relativePoint.x };
      break;
    default:
      throw new Error(`真实模型方向 oracle 不支持 rotation=${rotation}。`);
  }
  if (mirrorX) orientedPoint = { x: 1 - orientedPoint.x, y: orientedPoint.y };
  const layoutPoint = {
    x: layoutBounds.x + orientedPoint.x * layoutBounds.width,
    y: layoutBounds.y + orientedPoint.y * layoutBounds.height,
  };
  return applyOutputTransform(layoutPoint, outputTransform, outputSize);
}

function inverseOutputBounds(outputBounds, outputTransform, outputSize) {
  const corners = [
    { x: outputBounds.x, y: outputBounds.y },
    { x: outputBounds.x + outputBounds.width, y: outputBounds.y },
    { x: outputBounds.x, y: outputBounds.y + outputBounds.height },
    {
      x: outputBounds.x + outputBounds.width,
      y: outputBounds.y + outputBounds.height,
    },
  ].map((point) => invertOutputTransform(point, outputTransform, outputSize));
  const xValues = corners.map(({ x }) => x);
  const yValues = corners.map(({ y }) => y);
  const minimumX = Math.min(...xValues);
  const maximumX = Math.max(...xValues);
  const minimumY = Math.min(...yValues);
  const maximumY = Math.max(...yValues);
  return {
    height: maximumY - minimumY,
    width: maximumX - minimumX,
    x: minimumX,
    y: minimumY,
  };
}

function invertOutputTransform(point, outputTransform, outputSize) {
  const rotation = outputTransform?.rotation ?? 0;
  assertSupportedOracleRotation(rotation, 'output rotation');
  const rotatedPoint = outputTransform?.mirrorX
    ? { x: outputSize.width - point.x, y: point.y }
    : point;
  const layoutSize = getLayoutSize(outputSize, rotation);
  switch (rotation) {
    case 0:
      return rotatedPoint;
    case 90:
      return { x: rotatedPoint.y, y: layoutSize.height - rotatedPoint.x };
    case 180:
      return {
        x: layoutSize.width - rotatedPoint.x,
        y: layoutSize.height - rotatedPoint.y,
      };
    case 270:
      return { x: layoutSize.width - rotatedPoint.y, y: rotatedPoint.x };
    default:
      throw new Error('Unreachable oracle output rotation.');
  }
}

function applyOutputTransform(point, outputTransform, outputSize) {
  const rotation = outputTransform?.rotation ?? 0;
  assertSupportedOracleRotation(rotation, 'output rotation');
  const layoutSize = getLayoutSize(outputSize, rotation);
  let rotatedPoint;
  switch (rotation) {
    case 0:
      rotatedPoint = point;
      break;
    case 90:
      rotatedPoint = { x: layoutSize.height - point.y, y: point.x };
      break;
    case 180:
      rotatedPoint = {
        x: layoutSize.width - point.x,
        y: layoutSize.height - point.y,
      };
      break;
    case 270:
      rotatedPoint = { x: point.y, y: layoutSize.width - point.x };
      break;
    default:
      throw new Error('Unreachable oracle output rotation.');
  }
  return outputTransform?.mirrorX
    ? { x: outputSize.width - rotatedPoint.x, y: rotatedPoint.y }
    : rotatedPoint;
}

function getLayoutSize(outputSize, rotation) {
  return rotation === 90 || rotation === 270
    ? { height: outputSize.width, width: outputSize.height }
    : outputSize;
}

function assertSupportedOracleRotation(rotation, label = 'rotation') {
  if ([0, 90, 180, 270].includes(rotation)) return;
  throw new Error(`真实模型方向 oracle 不支持 ${label}=${rotation}。`);
}

function getVisibleDrawRanges(mesh, elementCount) {
  const geometry = mesh.geometry;
  const drawRange = intersectRanges(
    { end: elementCount, start: 0 },
    geometry.drawRange?.start ?? 0,
    geometry.drawRange?.count ?? Infinity,
  );
  if (!drawRange) return [];
  if (!Array.isArray(mesh.material)) {
    return mesh.material?.visible === false || !mesh.material ? [] : [drawRange];
  }

  return (geometry.groups ?? []).flatMap((group) => {
    const material = Number.isInteger(group.materialIndex)
      ? mesh.material[group.materialIndex]
      : null;
    if (!material || material.visible === false) return [];
    const range = intersectRanges(drawRange, group.start, group.count);
    return range ? [range] : [];
  });
}

function intersectRanges(base, startValue, count) {
  if (!Number.isFinite(startValue) || !(count > 0)) return null;
  const rangeEnd = count === Infinity ? base.end : startValue + count;
  if (!Number.isFinite(rangeEnd)) return null;
  const start = Math.max(base.start, 0, Math.ceil(startValue));
  const end = Math.min(base.end, Math.floor(rangeEnd));
  return end > start ? { end, start } : null;
}

function readVertex(mesh, position, uv, index, elementOffset) {
  const vertexIndex = index ? index.getX(elementOffset) : elementOffset;
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= position.count) return null;
  if (vertexIndex >= uv.count) {
    throw new Error(`真实模型 UV 网格 "${mesh.name}" 的三角形引用了 UV 属性范围外的顶点。`);
  }
  if (![position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex)]
    .every(Number.isFinite)) {
    return null;
  }
  const u = uv.getX(vertexIndex);
  const v = uv.getY(vertexIndex);
  return Number.isFinite(u) && Number.isFinite(v) ? { u, v, vertexIndex } : null;
}

function isDegenerateUvTriangle([first, second, third]) {
  const doubledArea = (second.u - first.u) * (third.v - first.v)
    - (second.v - first.v) * (third.u - first.u);
  return Math.abs(doubledArea) <= TEST_UV_AREA_EPSILON;
}
