const UV_REGIONS = {
  bodyFront: [[0.03, 0.05], [0.31, 0.05], [0.34, 0.82], [0.24, 0.95], [0.1, 0.95], [0, 0.82]],
  bodyBack: [[0.37, 0.05], [0.65, 0.05], [0.68, 0.82], [0.58, 0.95], [0.44, 0.95], [0.34, 0.82]],
  sleeves: [
    [[0.69, 0.08], [0.84, 0.11], [0.87, 0.57], [0.72, 0.59]],
    [[0.86, 0.08], [0.99, 0.05], [1, 0.57], [0.85, 0.59]],
  ],
  shoulderSide: [
    [[0.03, 0.05], [0.1, 0.05], [0.09, 0.3], [0, 0.36]],
    [[0.24, 0.05], [0.31, 0.05], [0.34, 0.36], [0.25, 0.3]],
    [[0.37, 0.05], [0.44, 0.05], [0.43, 0.3], [0.34, 0.36]],
    [[0.58, 0.05], [0.65, 0.05], [0.68, 0.36], [0.59, 0.3]],
  ],
  collar: [[0.12, 0], [0.22, 0], [0.24, 0.1], [0.17, 0.15], [0.1, 0.1]],
};
const MIN_UV_TRIANGLE_AREA = 1e-12;
const meshUvDataCache = new WeakMap();
const layoutPathCache = new WeakMap();
let meshUvDataRevision = 0;

export function createGarmentAppearanceCanvas(
  size = 2048,
  appearance = { template: 'solid', colors: {} },
  { modelMeshes = [], uvLayout = null } = {},
) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create garment appearance canvas context.');
  if (modelMeshes.length > 0 && uvLayout) {
    renderModelUvAppearance(context, canvas, appearance, { modelMeshes, uvLayout });
  } else {
    renderGarmentAppearance(context, canvas, appearance);
  }
  return canvas;
}

export function renderModelUvAppearance(
  context,
  { width, height },
  appearance,
  { modelMeshes, uvLayout },
) {
  assertPositiveDimensions(width, height);

  const groups = [...uvLayout.pieceGroups].sort((left, right) => left.order - right.order);
  const resolvedGroups = resolveConfiguredGroupMeshes(modelMeshes, groups);
  resolvedGroups.forEach(({ group, meshes }) => {
    const meshUvData = [];
    for (const mesh of meshes) {
      const data = getMeshUvData(mesh);
      if (data) meshUvData.push(data);
    }
    if (meshUvData.length === 0) {
      throw new Error(`模型 UV 裁片组 "${group.id}" 没有可绘制的 UV 三角形。`);
    }
    const bounds = getGroupPixelBounds(meshUvData, width, height);
    const path = getCachedGroupPath(uvLayout, group, meshUvData, width, height);
    paintUvTriangles(context, meshUvData, width, height, path, () => {
      paintAppearanceZone(context, group.zone, bounds, appearance);
    });
  });
}

function resolveConfiguredGroupMeshes(modelMeshes, groups) {
  const referencedNames = new Set();
  const ownerByMeshName = new Map();
  for (const group of groups) {
    const namesInGroup = new Set();
    for (const { meshName } of group.islandRefs) {
      if (namesInGroup.has(meshName)) {
        throw new Error(`模型 UV 裁片组 "${group.id}" 重复引用网格 "${meshName}"。`);
      }
      namesInGroup.add(meshName);
      const owner = ownerByMeshName.get(meshName);
      if (ownerByMeshName.has(meshName)) {
        throw new Error(`模型 UV 网格 "${meshName}" 被裁片组 "${owner}" 和 "${group.id}" 重复引用。`);
      }
      ownerByMeshName.set(meshName, group.id);
      referencedNames.add(meshName);
    }
  }

  const matchesByName = new Map();
  for (const mesh of modelMeshes) {
    if (!referencedNames.has(mesh?.name)) continue;
    const matches = matchesByName.get(mesh.name) ?? [];
    matches.push(mesh);
    matchesByName.set(mesh.name, matches);
  }

  return groups.map((group) => ({
    group,
    meshes: group.islandRefs.map(({ meshName }) => {
      const matches = matchesByName.get(meshName) ?? [];
      if (matches.length > 1) throw new Error(`模型 UV 网格名称 "${meshName}" 不唯一。`);
      if (matches.length === 0) throw new Error(`模型 UV 网格 "${meshName}" 不存在。`);
      return matches[0];
    }),
  }));
}

export function renderGarmentAppearance(context, { width, height }, appearance) {
  assertPositiveDimensions(width, height);

  const colors = appearance.colors ?? {};
  const body = colors.body ?? '#F7F5EF';
  context.fillStyle = body;
  context.fillRect(0, 0, width, height);

  const paintTemplate = templatePainters[appearance.template] ?? templatePainters.solid;
  paintRegion(context, UV_REGIONS.bodyFront, width, height, () => paintTemplate(context, bodyBounds(UV_REGIONS.bodyFront, width, height), colors));
  paintRegion(context, UV_REGIONS.bodyBack, width, height, () => paintTemplate(context, bodyBounds(UV_REGIONS.bodyBack, width, height), colors));
  UV_REGIONS.sleeves.forEach((region) => paintRegion(context, region, width, height, () => paintSolid(context, bodyBounds(region, width, height), { body: colors.sleeves ?? body })));
  UV_REGIONS.shoulderSide.forEach((region) => paintRegion(context, region, width, height, () => paintSolid(context, bodyBounds(region, width, height), { body: colors.shoulderSide ?? body })));
  paintRegion(context, UV_REGIONS.collar, width, height, () => paintSolid(context, bodyBounds(UV_REGIONS.collar, width, height), { body: colors.collar ?? body }));
}

function assertPositiveDimensions(width, height) {
  if (!(width > 0) || !(height > 0)) {
    throw new Error('Appearance texture requires a positive width and height.');
  }
}

function getMeshUvData(mesh) {
  const position = mesh?.geometry?.attributes?.position;
  const uv = mesh?.geometry?.attributes?.uv;
  if (!position || !uv || position.itemSize < 3 || uv.itemSize < 2) return null;

  const index = mesh.geometry.index;
  if (index && index.itemSize < 1) return null;
  const signature = getMeshUvSignature(mesh, position, uv, index);
  const cached = meshUvDataCache.get(mesh);
  if (cached && meshUvSignatureMatches(cached.signature, signature)) return cached.data;

  const spans = getGeometryRenderSpans(mesh, index?.count ?? position.count);
  const coordinates = [];
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;

  for (const { start, end } of spans) {
    for (let offset = start; offset + 2 < end; offset += 3) {
      const first = readUvVertex(index, uv, position.count, offset, mesh.name);
      const second = readUvVertex(index, uv, position.count, offset + 1, mesh.name);
      const third = readUvVertex(index, uv, position.count, offset + 2, mesh.name);
      if (!first || !second || !third || isDegenerateUvTriangle(first, second, third)) continue;
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
        revision: ++meshUvDataRevision,
      };
  meshUvDataCache.set(mesh, { data, signature });
  return data;
}

function getMeshUvSignature(mesh, position, uv, index) {
  const groups = Array.isArray(mesh.material)
    ? (mesh.geometry.groups ?? []).map((group) => {
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
    : 'single-material';
  return {
    geometry: mesh.geometry,
    position,
    positionVersion: getBufferAttributeVersion(position),
    positionCount: position.count,
    positionItemSize: position.itemSize,
    positionNormalized: position.normalized,
    uv,
    uvVersion: getBufferAttributeVersion(uv),
    uvCount: uv.count,
    uvItemSize: uv.itemSize,
    uvNormalized: uv.normalized,
    index,
    indexVersion: getBufferAttributeVersion(index),
    indexCount: index?.count ?? null,
    indexItemSize: index?.itemSize ?? null,
    indexNormalized: index?.normalized ?? null,
    drawStart: mesh.geometry.drawRange?.start ?? 0,
    drawCount: mesh.geometry.drawRange?.count ?? Infinity,
    materialIsArray: Array.isArray(mesh.material),
    groups,
  };
}

function getBufferAttributeVersion(attribute) {
  return attribute?.data?.version ?? attribute?.version ?? null;
}

function meshUvSignatureMatches(first, second) {
  return Object.keys(first).every((key) => first[key] === second[key]);
}

function getGeometryRenderSpans(mesh, elementCount) {
  const drawSpan = intersectRenderSpan(
    0,
    elementCount,
    mesh.geometry.drawRange?.start ?? 0,
    mesh.geometry.drawRange?.count ?? Infinity,
  );
  if (!drawSpan) return [];

  if (!Array.isArray(mesh.material)) return [drawSpan];
  const groups = mesh.geometry.groups ?? [];
  if (groups.length === 0) return [];

  const spans = [];
  for (const group of groups) {
    const material = Number.isInteger(group.materialIndex)
      ? mesh.material[group.materialIndex]
      : null;
    if (!material || material.visible === false) continue;
    const span = intersectRenderSpan(
      drawSpan.start,
      drawSpan.end,
      group.start,
      group.count,
    );
    if (span) spans.push(span);
  }
  return mergeOverlappingSpans(spans);
}

function intersectRenderSpan(baseStart, baseEnd, rangeStart, rangeCount) {
  if (!Number.isFinite(rangeStart) || !(rangeCount > 0)) return null;
  const rangeEnd = rangeCount === Infinity ? baseEnd : rangeStart + rangeCount;
  if (!Number.isFinite(rangeEnd)) return null;
  const start = Math.max(baseStart, 0, Math.ceil(rangeStart));
  const end = Math.min(baseEnd, Math.floor(rangeEnd));
  return end > start ? { start, end } : null;
}

function mergeOverlappingSpans(spans) {
  if (spans.length < 2) return spans;
  spans.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [spans[0]];
  for (let index = 1; index < spans.length; index += 1) {
    const next = spans[index];
    const previous = merged[merged.length - 1];
    if (next.start < previous.end) previous.end = Math.max(previous.end, next.end);
    else merged.push(next);
  }
  return merged;
}

function readUvVertex(index, uv, positionCount, offset, meshName) {
  const vertexIndex = index ? index.getX(offset) : offset;
  if (!Number.isFinite(vertexIndex) || !Number.isInteger(vertexIndex) || vertexIndex < 0) return null;
  if (vertexIndex >= positionCount) return null;
  if (vertexIndex >= uv.count) {
    throw new Error(`模型 UV 网格 "${meshName}" 的已绘制三角形引用了 UV 属性范围外的顶点。`);
  }
  const u = uv.getX(vertexIndex);
  const v = uv.getY(vertexIndex);
  return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : null;
}

function isDegenerateUvTriangle(first, second, third) {
  const area = (
    (second.u - first.u) * (third.v - first.v)
    - (second.v - first.v) * (third.u - first.u)
  );
  return Math.abs(area) <= MIN_UV_TRIANGLE_AREA;
}

function getGroupPixelBounds(meshUvData, width, height) {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const { bounds } of meshUvData) {
    minU = Math.min(minU, bounds.minU);
    minV = Math.min(minV, bounds.minV);
    maxU = Math.max(maxU, bounds.maxU);
    maxV = Math.max(maxV, bounds.maxV);
  }
  return {
    x: minU * width,
    y: (1 - maxV) * height,
    width: (maxU - minU) * width,
    height: (maxV - minV) * height,
  };
}

function getCachedGroupPath(uvLayout, group, meshUvData, width, height) {
  const PathConstructor = globalThis.Path2D;
  if (typeof PathConstructor !== 'function') return null;
  let cache = layoutPathCache.get(uvLayout);
  if (!cache || cache.PathConstructor !== PathConstructor) {
    cache = { PathConstructor, paths: new Map() };
    layoutPathCache.set(uvLayout, cache);
  }
  const meshNames = group.islandRefs.map(({ meshName }) => meshName).join(',');
  const revisions = meshUvData.map(({ revision }) => revision).join(',');
  const key = `${group.id}|${meshNames}|${revisions}|${width}x${height}`;
  const cached = cache.paths.get(key);
  if (cached) return cached;

  const path = new PathConstructor();
  appendUvTrianglesToPath(path, meshUvData, width, height);
  cache.paths.set(key, path);
  return path;
}

function appendUvTrianglesToPath(path, meshUvData, width, height) {
  for (const { coordinates } of meshUvData) {
    for (let index = 0; index < coordinates.length; index += 6) {
      path.moveTo(coordinates[index] * width, (1 - coordinates[index + 1]) * height);
      path.lineTo(coordinates[index + 2] * width, (1 - coordinates[index + 3]) * height);
      path.lineTo(coordinates[index + 4] * width, (1 - coordinates[index + 5]) * height);
      path.closePath();
    }
  }
}

function paintUvTriangles(context, meshUvData, width, height, path, painter) {
  context.save();
  try {
    if (path) {
      context.clip(path);
    } else {
      context.beginPath();
      appendUvTrianglesToPath(context, meshUvData, width, height);
      context.clip();
    }
    painter();
  } finally {
    context.restore();
  }
}

function paintAppearanceZone(context, zone, bounds, appearance) {
  const colors = appearance.colors ?? {};
  const body = colors.body ?? '#F7F5EF';
  if (zone === 'body') {
    const paintTemplate = templatePainters[appearance.template] ?? templatePainters.solid;
    paintTemplate(context, bounds, { ...colors, body });
    return;
  }
  paintSolid(context, bounds, { body: colors[zone] ?? body });
}

function paintRegion(context, region, width, height, painter) {
  context.save();
  context.beginPath();
  region.forEach(([u, v], index) => {
    const x = u * width;
    const y = v * height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.clip();
  painter();
  context.restore();
}

function bodyBounds(region, width, height) {
  const xs = region.map(([u]) => u * width);
  const ys = region.map(([, v]) => v * height);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function paintSolid(context, bounds, colors) {
  context.fillStyle = colors.body;
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function paintVerticalStripes(context, bounds, colors) {
  paintSolid(context, bounds, colors);
  context.fillStyle = colors.pattern ?? colors.body;
  const stripeWidth = Math.max(bounds.width / 5, 1);
  for (let x = bounds.x + stripeWidth; x < bounds.x + bounds.width; x += stripeWidth * 2) context.fillRect(x, bounds.y, stripeWidth, bounds.height);
}

function paintHorizontalStripes(context, bounds, colors) {
  paintSolid(context, bounds, colors);
  context.fillStyle = colors.pattern ?? colors.body;
  const stripeHeight = Math.max(bounds.height / 6, 1);
  for (let y = bounds.y + stripeHeight; y < bounds.y + bounds.height; y += stripeHeight * 2) context.fillRect(bounds.x, y, bounds.width, stripeHeight);
}

function paintDiagonal(context, bounds, colors) {
  paintSolid(context, bounds, colors);
  context.fillStyle = colors.pattern ?? colors.body;
  const stripeWidth = Math.max(bounds.width / 5, 1);
  for (let x = bounds.x - bounds.height; x < bounds.x + bounds.width; x += stripeWidth * 2) {
    context.beginPath();
    context.moveTo(x, bounds.y + bounds.height);
    context.lineTo(x + stripeWidth, bounds.y + bounds.height);
    context.lineTo(x + bounds.height + stripeWidth, bounds.y);
    context.lineTo(x + bounds.height, bounds.y);
    context.closePath();
    context.fill();
  }
}

function paintGradient(context, bounds, colors) {
  const gradient = context.createLinearGradient(bounds.x, bounds.y, bounds.x, bounds.y + bounds.height);
  gradient.addColorStop(0, colors.body);
  gradient.addColorStop(1, colors.pattern ?? colors.body);
  context.fillStyle = gradient;
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
}

function paintColorBlock(context, bounds, colors) {
  paintSolid(context, bounds, colors);
  context.fillStyle = colors.pattern ?? colors.body;
  context.fillRect(bounds.x, bounds.y + bounds.height * 0.52, bounds.width, bounds.height * 0.48);
}

const templatePainters = {
  solid: paintSolid,
  'vertical-stripes': paintVerticalStripes,
  'horizontal-stripes': paintHorizontalStripes,
  diagonal: paintDiagonal,
  gradient: paintGradient,
  'color-block': paintColorBlock,
};
