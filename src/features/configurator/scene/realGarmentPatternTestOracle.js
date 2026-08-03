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
