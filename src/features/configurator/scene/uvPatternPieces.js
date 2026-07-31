import { validateModelUvLayout } from '../config/modelUvLayouts.js';

const OUTPUT_SIZE = 4096;
const TRIANGLE_BATCH_SIZE = 128;
const LAYOUT_MARGIN = 192;
const PIECE_GAP = 128;

export function uvToAtlasPoint({ u, v }, atlasSize) {
  return { x: u * atlasSize, y: (1 - v) * atlasSize };
}

export function transformPiecePoint(point, {
  width,
  height,
  rotation = 0,
  mirrorX = false,
}) {
  let transformed;
  switch (rotation) {
    case 90:
      transformed = { x: height - point.y, y: point.x };
      break;
    case 180:
      transformed = { x: width - point.x, y: height - point.y };
      break;
    case 270:
      transformed = { x: point.y, y: width - point.x };
      break;
    default:
      transformed = { x: point.x, y: point.y };
  }
  const outputWidth = rotation === 90 || rotation === 270 ? height : width;
  return mirrorX
    ? { x: outputWidth - transformed.x, y: transformed.y }
    : transformed;
}

export async function createUvPatternPieces({
  atlasCanvas,
  atlasSize,
  meshes,
  uvLayout,
  yieldControl = yieldToBrowser,
}) {
  validateModelUvLayout(uvLayout, meshes);
  validateSourceAtlas(atlasCanvas, atlasSize);
  const groups = buildUniqueGroups(uvLayout.pieceGroups, meshes);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 UV 裁片画布。');
  context.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  const temporaryCanvases = [];
  try {
    const extractedPieces = [];
    for (const group of groups) {
      const triangles = extractGroupTriangles(group, atlasSize);
      if (triangles.length === 0) {
        throw new Error(`UV 裁片 "${group.id}" 没有可映射的有效三角形。`);
      }
      const sourceBounds = calculateSourceBounds(triangles, atlasSize);
      const sourceCanvas = createCanvas(sourceBounds.width, sourceBounds.height);
      temporaryCanvases.push(sourceCanvas);
      await drawTriangleBatches({
        context: sourceCanvas.getContext('2d'),
        atlasCanvas,
        sourceBounds,
        triangles,
        yieldControl,
      });
      const orientedSize = getOrientedSize(sourceBounds, group);
      const orientedCanvas = createCanvas(orientedSize.width, orientedSize.height);
      temporaryCanvases.push(orientedCanvas);
      drawOrientedPiece(orientedCanvas.getContext('2d'), sourceCanvas, sourceBounds, group);
      extractedPieces.push({
        group,
        mappedTriangles: triangles.length,
        sourceBounds,
        orientedCanvas,
        orientedSize,
      });
    }

    const layout = calculatePieceLayout(extractedPieces);
    const pieces = extractedPieces.map((extracted, index) => {
      const outputBounds = layout[index];
      context.drawImage(
        extracted.orientedCanvas,
        outputBounds.x,
        outputBounds.y,
        outputBounds.width,
        outputBounds.height,
      );
      return createPieceMetadata(
        extracted.group,
        extracted.mappedTriangles,
        extracted.sourceBounds,
        outputBounds,
      );
    });
    for (const piece of pieces) {
      piece.coveragePixels = countCoveragePixels(context, piece.outputBounds);
      if (piece.coveragePixels === 0) {
        throw new Error(`UV 裁片 "${piece.id}" 提取结果为空。`);
      }
    }
    const layoutFingerprint = createLayoutFingerprint(uvLayout.version, pieces);
    const blob = await canvasToPngBlob(canvas);
    return {
      blob,
      canvas,
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
      pieces,
      layoutFingerprint,
    };
  } finally {
    for (const temporaryCanvas of temporaryCanvases) {
      temporaryCanvas.width = 0;
      temporaryCanvas.height = 0;
    }
  }
}

function validateSourceAtlas(atlasCanvas, atlasSize) {
  if (!atlasCanvas || !Number.isFinite(atlasSize) || atlasSize <= 0) {
    throw new Error('UV 裁片需要有效的源 Atlas 和 atlasSize。');
  }
}

function buildUniqueGroups(pieceGroups, meshes) {
  const meshesByName = new Map();
  for (const mesh of meshes) {
    const matches = meshesByName.get(mesh.name) ?? [];
    matches.push(mesh);
    meshesByName.set(mesh.name, matches);
  }

  const referencedMeshes = new Set();
  const resolvedGroups = [...pieceGroups]
    .sort((left, right) => left.order - right.order)
    .map((group) => ({
      ...group,
      duplicateGroup: normalizeDuplicateGroup(group),
      aliases: [],
      meshes: [],
    }));

  for (const group of resolvedGroups) {
    for (const { meshName } of group.islandRefs) {
      if (referencedMeshes.has(meshName)) {
        throw new Error(`UV 裁片配置重复引用网格 "${meshName}"。`);
      }
      referencedMeshes.add(meshName);
      const matches = meshesByName.get(meshName) ?? [];
      if (matches.length === 0) {
        throw new Error(`UV 裁片 "${group.id}" 找不到网格 "${meshName}"。`);
      }
      if (matches.length !== 1) {
        throw new Error(`UV 裁片 "${group.id}" 的网格 "${meshName}" 匹配不唯一。`);
      }
      group.meshes.push(matches[0]);
    }
  }

  const uniqueGroups = [];
  const duplicateGroups = new Map();
  for (const group of resolvedGroups) {
    if (!group.duplicateGroup) {
      uniqueGroups.push(group);
      continue;
    }
    const canonical = duplicateGroups.get(group.duplicateGroup);
    if (canonical) {
      canonical.aliases.push(group.id);
    } else {
      duplicateGroups.set(group.duplicateGroup, group);
      uniqueGroups.push(group);
    }
  }
  return uniqueGroups;
}

function normalizeDuplicateGroup(group) {
  if (!Object.hasOwn(group, 'duplicateGroup')) return null;
  if (typeof group.duplicateGroup !== 'string' || group.duplicateGroup.trim().length === 0) {
    throw new Error(`模型 UV 裁片配置错误：裁片组 "${group.id}" 的 duplicateGroup 必须是非空字符串。`);
  }
  return group.duplicateGroup.trim();
}

function extractGroupTriangles(group, atlasSize) {
  return group.meshes.flatMap((mesh) => extractMeshTriangles(mesh, atlasSize));
}

function extractMeshTriangles(mesh, atlasSize) {
  const geometry = mesh.geometry;
  const position = geometry?.getAttribute?.('position');
  const uv = geometry?.getAttribute?.('uv');
  if (!position || !uv) return [];
  if (Array.isArray(mesh.material)) {
    if (mesh.material.length === 0) return [];
  } else if (!mesh.material || mesh.material.visible === false) {
    return [];
  }

  const index = geometry.getIndex?.() ?? geometry.index;
  const elementCount = index ? index.count : position.count;
  const triangles = [];
  const offsets = new Set();
  for (const { start, end } of getVisibleRenderSpans(geometry, mesh.material, elementCount)) {
    for (let offset = start; offset + 2 < end; offset += 3) {
      if (offsets.has(offset)) continue;
      offsets.add(offset);
      const vertexIndices = [0, 1, 2].map((delta) => (
        index ? index.getX(offset + delta) : offset + delta
      ));
      if (!vertexIndices.every((vertexIndex) => (
        Number.isInteger(vertexIndex)
        && vertexIndex >= 0
        && vertexIndex < position.count
      ))) {
        throw new Error(`UV 裁片网格 "${mesh.name}" 的实际绘制索引超出 position 范围。`);
      }
      if (!vertexIndices.every((vertexIndex) => vertexIndex < uv.count)) {
        throw new Error(`UV 裁片网格 "${mesh.name}" 的实际绘制范围超出 UV 属性。`);
      }
      if (!vertexIndices.every((vertexIndex) => isFiniteAttributeItem(position, vertexIndex))) continue;
      const uvPoints = vertexIndices.map((vertexIndex) => ({
        u: uv.getX(vertexIndex),
        v: uv.getY(vertexIndex),
      }));
      if (!uvPoints.every(isValidUvPoint) || isDegenerateUvTriangle(uvPoints)) continue;
      triangles.push(uvPoints.map((point) => uvToAtlasPoint(point, atlasSize)));
    }
  }
  return triangles;
}

function getVisibleRenderSpans(geometry, material, elementCount) {
  const drawStart = clampInteger(geometry.drawRange?.start ?? 0, 0, elementCount);
  const requestedCount = geometry.drawRange?.count ?? Infinity;
  const drawEnd = Number.isFinite(requestedCount)
    ? clampInteger(drawStart + Math.max(0, requestedCount), drawStart, elementCount)
    : elementCount;
  if (drawStart >= drawEnd) return [];

  if (!Array.isArray(material)) return [{ start: drawStart, end: drawEnd }];
  const groups = geometry.groups ?? [];
  if (groups.length === 0) return [];
  return groups.flatMap((group) => {
    if (material[group.materialIndex]?.visible === false || !material[group.materialIndex]) return [];
    const start = Math.max(drawStart, clampInteger(group.start, 0, elementCount));
    const end = Math.min(drawEnd, clampInteger(group.start + group.count, 0, elementCount));
    return start < end ? [{ start, end }] : [];
  });
}

function clampInteger(value, minimum, maximum) {
  if (!Number.isFinite(value)) return maximum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function isFiniteAttributeItem(attribute, index) {
  for (let component = 0; component < attribute.itemSize; component += 1) {
    const value = component === 0
      ? attribute.getX(index)
      : component === 1
        ? attribute.getY(index)
        : attribute.getZ(index);
    if (!Number.isFinite(value)) return false;
  }
  return true;
}

function isValidUvPoint({ u, v }) {
  return Number.isFinite(u) && Number.isFinite(v) && u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

function isDegenerateUvTriangle([first, second, third]) {
  const twiceArea = (second.u - first.u) * (third.v - first.v)
    - (second.v - first.v) * (third.u - first.u);
  return Math.abs(twiceArea) <= Number.EPSILON;
}

function calculateSourceBounds(triangles, atlasSize) {
  let minimumX = atlasSize;
  let minimumY = atlasSize;
  let maximumX = 0;
  let maximumY = 0;
  for (const triangle of triangles) {
    for (const { x, y } of triangle) {
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  minimumX = Math.max(0, Math.floor(minimumX));
  minimumY = Math.max(0, Math.floor(minimumY));
  maximumX = Math.min(atlasSize, Math.ceil(maximumX));
  maximumY = Math.min(atlasSize, Math.ceil(maximumY));
  return {
    x: minimumX,
    y: minimumY,
    width: Math.max(1, maximumX - minimumX),
    height: Math.max(1, maximumY - minimumY),
  };
}

export async function drawTriangleBatches({
  context,
  atlasCanvas,
  sourceBounds,
  triangles,
  yieldControl,
}) {
  if (!context) throw new Error('无法创建 UV 裁片临时画布。');
  for (let start = 0; start < triangles.length; start += TRIANGLE_BATCH_SIZE) {
    const batch = triangles.slice(start, start + TRIANGLE_BATCH_SIZE);
    context.save();
    context.beginPath();
    for (const triangle of batch) {
      const [first, second, third] = triangle.map(({ x, y }) => ({
        x: x - sourceBounds.x,
        y: y - sourceBounds.y,
      }));
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.lineTo(third.x, third.y);
      context.closePath();
    }
    context.clip();
    context.drawImage(
      atlasCanvas,
      sourceBounds.x,
      sourceBounds.y,
      sourceBounds.width,
      sourceBounds.height,
      0,
      0,
      sourceBounds.width,
      sourceBounds.height,
    );
    context.restore();
    await yieldControl();
  }
}

function getOrientedSize({ width, height }, transform) {
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map((point) => transformPiecePoint(point, { width, height, ...transform }));
  const minimumX = Math.min(...corners.map(({ x }) => x));
  const maximumX = Math.max(...corners.map(({ x }) => x));
  const minimumY = Math.min(...corners.map(({ y }) => y));
  const maximumY = Math.max(...corners.map(({ y }) => y));
  return {
    width: Math.max(1, Math.round(maximumX - minimumX)),
    height: Math.max(1, Math.round(maximumY - minimumY)),
  };
}

export function drawOrientedPiece(context, sourceCanvas, sourceBounds, { rotation, mirrorX }) {
  if (!context) throw new Error('无法创建 UV 裁片方向画布。');
  const { width, height } = sourceBounds;
  const outputWidth = rotation === 90 || rotation === 270 ? height : width;
  context.save();
  if (mirrorX) {
    context.translate(outputWidth, 0);
    context.scale(-1, 1);
  }
  switch (rotation) {
    case 90:
      context.translate(height, 0);
      context.rotate(Math.PI / 2);
      break;
    case 180:
      context.translate(width, height);
      context.rotate(Math.PI);
      break;
    case 270:
      context.translate(0, width);
      context.rotate(Math.PI * 3 / 2);
      break;
    default:
      context.rotate(0);
  }
  context.drawImage(sourceCanvas, 0, 0);
  context.restore();
}

function calculatePieceLayout(extractedPieces) {
  const count = extractedPieces.length;
  const columns = count <= 2 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const availableWidth = OUTPUT_SIZE - LAYOUT_MARGIN * 2 - PIECE_GAP * (columns - 1);
  const availableHeight = OUTPUT_SIZE - LAYOUT_MARGIN * 2 - PIECE_GAP * (rows - 1);
  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new Error('UV 裁片数量过多，无法排入 4096 PNG。');
  }
  const cellWidth = availableWidth / columns;
  const cellHeight = availableHeight / rows;
  const scale = Math.min(...extractedPieces.map(({ orientedSize }) => Math.min(
    cellWidth / orientedSize.width,
    cellHeight / orientedSize.height,
  )));

  return extractedPieces.map(({ orientedSize }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const width = Math.max(1, Math.floor(orientedSize.width * scale));
    const height = Math.max(1, Math.floor(orientedSize.height * scale));
    const cellX = LAYOUT_MARGIN + column * (cellWidth + PIECE_GAP);
    const cellY = LAYOUT_MARGIN + row * (cellHeight + PIECE_GAP);
    return {
      x: Math.round(cellX + (cellWidth - width) / 2),
      y: Math.round(cellY + (cellHeight - height) / 2),
      width,
      height,
    };
  });
}

function createPieceMetadata(group, mappedTriangles, sourceBounds, outputBounds) {
  return {
    id: group.id,
    label: group.label,
    order: group.order,
    zone: group.zone,
    rotation: group.rotation,
    mirrorX: group.mirrorX,
    duplicateGroup: group.duplicateGroup ?? null,
    islandRefs: group.islandRefs.map(({ meshName }) => ({ meshName })),
    sourceMeshes: group.islandRefs.map(({ meshName }) => meshName),
    mappedTriangles,
    sourceBounds,
    outputBounds,
    coveragePixels: 0,
    aliases: [...group.aliases],
  };
}

export function countCoveragePixels(context, { x, y, width, height }) {
  const maximumPixelsPerRead = 262144;
  const rowsPerRead = Math.max(1, Math.floor(maximumPixelsPerRead / width));
  let coveragePixels = 0;
  for (let offsetY = 0; offsetY < height; offsetY += rowsPerRead) {
    const blockHeight = Math.min(rowsPerRead, height - offsetY);
    const { data } = context.getImageData(x, y + offsetY, width, blockHeight);
    for (let alphaIndex = 3; alphaIndex < data.length; alphaIndex += 4) {
      if (data[alphaIndex] > 0) coveragePixels += 1;
    }
  }
  return coveragePixels;
}

function createLayoutFingerprint(layoutVersion, pieces) {
  const serialized = JSON.stringify({
    output: { width: OUTPUT_SIZE, height: OUTPUT_SIZE },
    layoutVersion,
    pieces: pieces.map((piece) => ({
      id: piece.id,
      order: piece.order,
      rotation: piece.rotation,
      mirrorX: piece.mirrorX,
      duplicateGroup: piece.duplicateGroup,
      islandRefs: piece.islandRefs,
      sourceBounds: piece.sourceBounds,
      outputBounds: piece.outputBounds,
      aliases: piece.aliases,
    })),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `uv-pieces-v${layoutVersion}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToPngBlob(canvas) {
  if (typeof canvas.toBlob !== 'function') {
    throw new Error('浏览器不支持导出 UV 裁片 PNG。');
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('UV 裁片 PNG 导出失败：Canvas 返回空 Blob。'));
    }, 'image/png');
  });
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
