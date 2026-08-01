import { validateModelUvLayout } from '../config/modelUvLayouts.js';
import {
  collectRenderableUvTriangles,
  iterateRenderableUvTriangles,
} from './renderableUvTriangles.js';

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
  const extractedPieces = [];
  for (const group of groups) {
    const { triangles, sourceBounds } = await collectGroupTriangles(group, atlasSize, yieldControl);
    if (triangles.length === 0) {
      throw new Error(`UV 裁片 "${group.id}" 没有可映射的有效三角形。`);
    }
    extractedPieces.push({
      group,
      mappedTriangles: triangles.length,
      sourceBounds,
      orientedSize: getOrientedSize(sourceBounds, group),
      triangles,
    });
  }

  const layout = calculatePieceLayout(extractedPieces);
  const canvas = createCanvas(OUTPUT_SIZE, OUTPUT_SIZE);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建 UV 裁片画布。');
    context.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const pieces = [];

    for (let index = 0; index < extractedPieces.length; index += 1) {
      const extracted = extractedPieces[index];
      const { outputBounds, scale } = layout[index];
      const temporaryCanvases = [];
      try {
        const maskCanvas = createCanvas(extracted.sourceBounds.width, extracted.sourceBounds.height);
        temporaryCanvases.push(maskCanvas);
        const sourceCanvas = createCanvas(extracted.sourceBounds.width, extracted.sourceBounds.height);
        temporaryCanvases.push(sourceCanvas);
        const orientedCanvas = createCanvas(extracted.orientedSize.width, extracted.orientedSize.height);
        temporaryCanvases.push(orientedCanvas);

        await drawTriangleMaskBatches({
          context: maskCanvas.getContext('2d'),
          sourceBounds: extracted.sourceBounds,
          triangles: extracted.triangles,
          yieldControl,
        });
        applyPieceMask({
          context: sourceCanvas.getContext('2d'),
          atlasCanvas,
          maskCanvas,
          sourceBounds: extracted.sourceBounds,
        });
        drawOrientedPiece(
          orientedCanvas.getContext('2d'),
          sourceCanvas,
          extracted.sourceBounds,
          extracted.group,
        );
        context.drawImage(
          orientedCanvas,
          outputBounds.x,
          outputBounds.y,
          outputBounds.width,
          outputBounds.height,
        );
        const piece = createPieceMetadata(
          extracted.group,
          extracted.mappedTriangles,
          extracted.sourceBounds,
          outputBounds,
          scale,
        );
        piece.coveragePixels = await scanCoveragePixels(
          context,
          piece.outputBounds,
          yieldControl,
        );
        if (piece.coveragePixels === 0) {
          throw new Error(`UV 裁片 "${piece.id}" 提取结果为空。`);
        }
        pieces.push(piece);
      } finally {
        releaseCanvases(temporaryCanvases);
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
  } catch (error) {
    releaseCanvases([canvas]);
    throw error;
  }
}

function validateSourceAtlas(atlasCanvas, atlasSize) {
  if (!Number.isInteger(atlasSize) || atlasSize <= 0) {
    throw new Error('UV 裁片源 Atlas 的 atlasSize 必须是正整数。');
  }
  if (
    !atlasCanvas
    || !Number.isInteger(atlasCanvas.width)
    || !Number.isInteger(atlasCanvas.height)
    || atlasCanvas.width <= 0
    || atlasCanvas.height <= 0
    || atlasCanvas.width !== atlasSize
    || atlasCanvas.height !== atlasSize
  ) {
    throw new Error(`UV 裁片源 Atlas 尺寸必须精确等于 ${atlasSize}×${atlasSize}。`);
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
  const ids = new Set(uniqueGroups.map(({ id }) => id));
  if (!ids.has('front') || !ids.has('back')) {
    throw new Error('模型 UV 裁片配置去重后必须仍包含独立的正片和背片。');
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

export async function collectGroupTriangles(group, atlasSize, yieldControl) {
  const triangles = [];
  const extents = {
    minimumX: atlasSize,
    minimumY: atlasSize,
    maximumX: 0,
    maximumY: 0,
  };
  try {
    for (const mesh of group.meshes) {
      await yieldControl();
      let trianglesSinceYield = 0;
      for (const coordinates of iterateRenderableUvTriangles(mesh)) {
        const triangle = [
          uvToAtlasPoint({ u: coordinates[0], v: coordinates[1] }, atlasSize),
          uvToAtlasPoint({ u: coordinates[2], v: coordinates[3] }, atlasSize),
          uvToAtlasPoint({ u: coordinates[4], v: coordinates[5] }, atlasSize),
        ];
        triangles.push(triangle);
        includeTriangleInExtents(extents, triangle);
        trianglesSinceYield += 1;
        if (trianglesSinceYield === TRIANGLE_BATCH_SIZE) {
          await yieldControl();
          trianglesSinceYield = 0;
        }
      }
      if (trianglesSinceYield > 0) await yieldControl();
    }
    return {
      triangles,
      sourceBounds: triangles.length > 0 ? calculateSourceBounds(extents, atlasSize) : null,
    };
  } catch (error) {
    throw new Error(`UV 裁片 "${group.id}" 无法提取：${error.message}`, { cause: error });
  }
}

export function collectPieceAtlasTriangles(mesh, atlasSize) {
  const data = collectRenderableUvTriangles(mesh);
  if (!data) return [];
  const triangles = [];
  for (let offset = 0; offset < data.coordinates.length; offset += 6) {
    triangles.push([
      uvToAtlasPoint({ u: data.coordinates[offset], v: data.coordinates[offset + 1] }, atlasSize),
      uvToAtlasPoint({ u: data.coordinates[offset + 2], v: data.coordinates[offset + 3] }, atlasSize),
      uvToAtlasPoint({ u: data.coordinates[offset + 4], v: data.coordinates[offset + 5] }, atlasSize),
    ]);
  }
  return triangles;
}

function includeTriangleInExtents(extents, triangle) {
  for (const { x, y } of triangle) {
    extents.minimumX = Math.min(extents.minimumX, x);
    extents.minimumY = Math.min(extents.minimumY, y);
    extents.maximumX = Math.max(extents.maximumX, x);
    extents.maximumY = Math.max(extents.maximumY, y);
  }
}

function calculateSourceBounds(extents, atlasSize) {
  let {
    minimumX,
    minimumY,
    maximumX,
    maximumY,
  } = extents;
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

export async function drawTriangleMaskBatches({
  context,
  sourceBounds,
  triangles,
  yieldControl,
}) {
  if (!context) throw new Error('无法创建 UV 裁片遮罩画布。');
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = '#FFFFFF';
  context.beginPath();
  for (let start = 0; start < triangles.length; start += TRIANGLE_BATCH_SIZE) {
    const batch = triangles.slice(start, start + TRIANGLE_BATCH_SIZE);
    for (const triangle of batch) {
      let [first, second, third] = triangle.map(({ x, y }) => ({
        x: x - sourceBounds.x,
        y: y - sourceBounds.y,
      }));
      if (signedTriangleArea(first, second, third) < 0) {
        [second, third] = [third, second];
      }
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.lineTo(third.x, third.y);
      context.closePath();
    }
    await yieldControl();
  }
  context.fill();
}

function signedTriangleArea(first, second, third) {
  return (second.x - first.x) * (third.y - first.y)
    - (second.y - first.y) * (third.x - first.x);
}

export function applyPieceMask({ context, atlasCanvas, maskCanvas, sourceBounds }) {
  if (!context) throw new Error('无法创建 UV 裁片源画布。');
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
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(maskCanvas, 0, 0);
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
      scale,
      outputBounds: {
        x: Math.round(cellX + (cellWidth - width) / 2),
        y: Math.round(cellY + (cellHeight - height) / 2),
        width,
        height,
      },
    };
  });
}

function createPieceMetadata(group, mappedTriangles, sourceBounds, outputBounds, scale) {
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
    scale,
    coveragePixels: 0,
    aliases: [...group.aliases],
  };
}

export function countCoveragePixels(imageData) {
  const data = imageData?.data ?? imageData;
  let coveragePixels = 0;
  for (let alphaIndex = 3; alphaIndex < data.length; alphaIndex += 4) {
    if (data[alphaIndex] > 0) coveragePixels += 1;
  }
  return coveragePixels;
}

export async function scanCoveragePixels(context, { x, y, width, height }, yieldControl) {
  const maximumPixelsPerRead = 262144;
  const rowsPerRead = Math.max(1, Math.floor(maximumPixelsPerRead / width));
  let coveragePixels = 0;
  for (let offsetY = 0; offsetY < height; offsetY += rowsPerRead) {
    const blockHeight = Math.min(rowsPerRead, height - offsetY);
    coveragePixels += countCoveragePixels(
      context.getImageData(x, y + offsetY, width, blockHeight),
    );
    await yieldControl();
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
      scale: piece.scale,
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

function releaseCanvases(canvases) {
  for (const canvas of canvases) {
    canvas.width = 0;
    canvas.height = 0;
  }
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
