export const MIN_RENDERABLE_UV_TRIANGLE_AREA = 1e-12;

const triangleCache = new WeakMap();
let triangleRevision = 0;

export function collectRenderableUvTriangles(mesh) {
  const geometry = mesh?.geometry;
  const position = geometry?.getAttribute?.('position') ?? geometry?.attributes?.position;
  const uv = geometry?.getAttribute?.('uv') ?? geometry?.attributes?.uv;
  if (!position || !uv || position.itemSize < 3 || uv.itemSize < 2) return null;

  const index = geometry.getIndex?.() ?? geometry.index;
  if (index && index.itemSize < 1) return null;
  const signature = getRenderableUvGeometrySignature(mesh, position, uv, index);
  const cached = triangleCache.get(mesh);
  if (cached && signaturesMatch(cached.signature, signature)) return cached.data;

  const coordinates = [];
  const triangleKeys = new Set();
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  const elementCount = index?.count ?? position.count;

  for (const { start, end } of getRenderableSpans(mesh, elementCount)) {
    for (let offset = start; offset + 2 < end; offset += 3) {
      const first = readRenderableVertex(mesh, position, uv, index, offset);
      const second = readRenderableVertex(mesh, position, uv, index, offset + 1);
      const third = readRenderableVertex(mesh, position, uv, index, offset + 2);
      if (!first || !second || !third || isDegenerate(first, second, third)) continue;
      const key = [first.vertexIndex, second.vertexIndex, third.vertexIndex]
        .sort((left, right) => left - right)
        .join(':');
      if (triangleKeys.has(key)) continue;
      triangleKeys.add(key);
      coordinates.push(first.u, first.v, second.u, second.v, third.u, third.v);
      minU = Math.min(minU, first.u, second.u, third.u);
      minV = Math.min(minV, first.v, second.v, third.v);
      maxU = Math.max(maxU, first.u, second.u, third.u);
      maxV = Math.max(maxV, first.v, second.v, third.v);
    }
  }

  const data = coordinates.length === 0
    ? null
    : {
        bounds: { minU, minV, maxU, maxV },
        coordinates,
        triangleCount: coordinates.length / 6,
        revision: ++triangleRevision,
      };
  triangleCache.set(mesh, { data, signature });
  return data;
}

export function getRenderableUvTriangleRevision(mesh) {
  return collectRenderableUvTriangles(mesh)?.revision ?? null;
}

export function getRenderableUvGeometrySignature(mesh, positionArg, uvArg, indexArg) {
  const geometry = mesh?.geometry;
  const position = positionArg
    ?? geometry?.getAttribute?.('position')
    ?? geometry?.attributes?.position;
  const uv = uvArg ?? geometry?.getAttribute?.('uv') ?? geometry?.attributes?.uv;
  const index = indexArg ?? geometry?.getIndex?.() ?? geometry?.index ?? null;
  const groups = Array.isArray(mesh?.material)
    ? (geometry?.groups ?? []).map((group) => {
        const material = Number.isInteger(group.materialIndex)
          ? mesh.material[group.materialIndex]
          : null;
        return [
          group.start,
          group.count,
          group.materialIndex,
          Boolean(material),
          material?.visible !== false,
        ].join(':');
      }).join(',')
    : `single-material:${Boolean(mesh?.material)}:${mesh?.material?.visible !== false}`;
  return {
    geometry,
    position,
    positionVersion: getAttributeVersion(position),
    positionCount: position?.count ?? null,
    positionItemSize: position?.itemSize ?? null,
    positionNormalized: position?.normalized ?? null,
    uv,
    uvVersion: getAttributeVersion(uv),
    uvCount: uv?.count ?? null,
    uvItemSize: uv?.itemSize ?? null,
    uvNormalized: uv?.normalized ?? null,
    index,
    indexVersion: getAttributeVersion(index),
    indexCount: index?.count ?? null,
    indexItemSize: index?.itemSize ?? null,
    indexNormalized: index?.normalized ?? null,
    drawStart: geometry?.drawRange?.start ?? 0,
    drawCount: geometry?.drawRange?.count ?? Infinity,
    materialIsArray: Array.isArray(mesh?.material),
    groups,
  };
}

function getRenderableSpans(mesh, elementCount) {
  const drawSpan = intersectSpan(
    0,
    elementCount,
    mesh.geometry.drawRange?.start ?? 0,
    mesh.geometry.drawRange?.count ?? Infinity,
  );
  if (!drawSpan) return [];

  if (!Array.isArray(mesh.material)) {
    return mesh.material && mesh.material.visible !== false ? [drawSpan] : [];
  }
  const groups = mesh.geometry.groups ?? [];
  if (groups.length === 0) return [];

  const spans = [];
  for (const group of groups) {
    const material = Number.isInteger(group.materialIndex)
      ? mesh.material[group.materialIndex]
      : null;
    if (!material || material.visible === false) continue;
    const span = intersectSpan(drawSpan.start, drawSpan.end, group.start, group.count);
    if (span) spans.push(span);
  }
  return spans;
}

function intersectSpan(baseStart, baseEnd, rangeStart, rangeCount) {
  if (!Number.isFinite(rangeStart) || !(rangeCount > 0)) return null;
  const rangeEnd = rangeCount === Infinity ? baseEnd : rangeStart + rangeCount;
  if (!Number.isFinite(rangeEnd)) return null;
  const start = Math.max(baseStart, 0, Math.ceil(rangeStart));
  const end = Math.min(baseEnd, Math.floor(rangeEnd));
  return end > start ? { start, end } : null;
}

function readRenderableVertex(mesh, position, uv, index, offset) {
  const vertexIndex = index ? index.getX(offset) : offset;
  if (!Number.isFinite(vertexIndex) || !Number.isInteger(vertexIndex) || vertexIndex < 0) return null;
  if (vertexIndex >= position.count) return null;
  if (vertexIndex >= uv.count) {
    throw new Error(`模型 UV 网格 "${mesh.name}" 的已绘制三角形引用了 UV 属性范围外的顶点。`);
  }
  if (!isFinitePosition(position, vertexIndex)) return null;
  const u = uv.getX(vertexIndex);
  const v = uv.getY(vertexIndex);
  return Number.isFinite(u) && Number.isFinite(v) ? { u, v, vertexIndex } : null;
}

function isFinitePosition(position, vertexIndex) {
  return Number.isFinite(position.getX(vertexIndex))
    && Number.isFinite(position.getY(vertexIndex))
    && Number.isFinite(position.getZ(vertexIndex));
}

function isDegenerate(first, second, third) {
  const area = (second.u - first.u) * (third.v - first.v)
    - (second.v - first.v) * (third.u - first.u);
  return Math.abs(area) <= MIN_RENDERABLE_UV_TRIANGLE_AREA;
}

function getAttributeVersion(attribute) {
  return attribute?.data?.version ?? attribute?.version ?? null;
}

function signaturesMatch(first, second) {
  return Object.keys(first).every((key) => first[key] === second[key]);
}
