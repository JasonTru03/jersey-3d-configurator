import { createCylindricalProjector, getModelProjection } from './modelProjection.js';
import { Vector3 } from 'three';

const PNG_MIME_TYPE = 'image/png';
const DEFAULT_ATLAS_SIZE = 2048;

export function createPatternBakeKey({ sourceHash, transform, projectionVersion, projectionId, size }) {
  const keyInput = normalizeBakeKeyInput({ sourceHash, transform, projectionVersion, projectionId, size });
  return `bottom-pattern-atlas:${JSON.stringify(keyInput)}`;
}

export async function bakeBottomPatternAtlas({ meshEntries, pattern, sourceTexture, size = DEFAULT_ATLAS_SIZE }) {
  validateBakeRequest({ meshEntries, pattern, sourceTexture, size });

  const keyInput = {
    sourceHash: pattern.sourceHash,
    transform: pattern.transform,
    projectionVersion: pattern.projectionVersion,
    projectionId: pattern.projectionId ?? pattern.modelProjectionId,
    size,
  };
  const key = createPatternBakeKey(keyInput);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create bottom pattern atlas canvas context.');

  context.clearRect(0, 0, size, size);
  renderProjectedPatternAtlas(context, size, meshEntries, pattern, sourceTexture);
  const blob = await canvasToPngBlob(canvas);

  return {
    blob,
    canvas,
    metadata: {
      key,
      mimeType: PNG_MIME_TYPE,
      atlasSize: size,
      size,
      width: size,
      height: size,
      meshCount: meshEntries.length,
      sourceHash: keyInput.sourceHash,
      transform: structuredClone(keyInput.transform),
      projectionVersion: keyInput.projectionVersion,
      projectionId: keyInput.projectionId,
    },
  };
}

function renderProjectedPatternAtlas(context, size, meshEntries, pattern, sourceTexture) {
  const source = sourceTexture.image ?? sourceTexture;
  const projectionBounds = getProjectionBounds(meshEntries);
  const projection = getModelProjection(pattern.projectionId ?? pattern.modelProjectionId);
  const patternFill = context.createPattern?.(source, 'repeat');
  if (!patternFill) {
    context.drawImage(source, 0, 0, size, size);
    return;
  }

  patternFill.setTransform?.(getPatternTransform(pattern, source, size));
  meshEntries.forEach((mesh) => renderMeshTriangles(context, mesh, projectionBounds, size, patternFill, projection));
}

function getProjectionBounds(meshEntries) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  meshEntries.forEach((mesh) => {
    const position = mesh.geometry?.attributes?.position;
    if (!position) return;
    for (let index = 0; index < position.count; index += 1) {
      const point = transformPoint(mesh, position, index);
      bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
      bounds.minZ = Math.min(bounds.minZ, point.z); bounds.maxZ = Math.max(bounds.maxZ, point.z);
    }
  });
  return bounds;
}

function renderMeshTriangles(context, mesh, bounds, size, patternFill, projection) {
  const geometry = mesh.geometry;
  const position = geometry?.attributes?.position;
  const uv = geometry?.attributes?.uv;
  if (!position || !uv) return;
  const index = geometry.index;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const vertexIndexes = [0, 1, 2].map((offset) => index ? index.getX(triangle * 3 + offset) : triangle * 3 + offset);
    const sourcePoints = unwrapU(vertexIndexes.map((vertex) => projectPoint(transformPoint(mesh, position, vertex), bounds, projection)));
    const targetPoints = vertexIndexes.map((vertex) => ({ x: uv.getX(vertex) * size, y: (1 - uv.getY(vertex)) * size }));
    const matrix = affineTransform(sourcePoints, targetPoints);
    if (!matrix) continue;
    context.save();
    context.transform(...matrix);
    context.fillStyle = patternFill;
    context.beginPath();
    context.moveTo(sourcePoints[0].x, sourcePoints[0].y);
    context.lineTo(sourcePoints[1].x, sourcePoints[1].y);
    context.lineTo(sourcePoints[2].x, sourcePoints[2].y);
    context.closePath();
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = patternFill;
    context.stroke();
    context.restore();
  }
}

function transformPoint(mesh, position, index) {
  const point = new Vector3(position.getX(index), position.getY(index), position.getZ(index));
  return mesh.localToWorld ? mesh.localToWorld(point) : point;
}

function projectPoint(point, bounds, projection) {
  const projector = createCylindricalProjector({
    center: { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
    minY: bounds.minY, frontAngleDeg: projection?.frontAngleDeg ?? 0,
    maxY: bounds.maxY,
  });
  const projected = projector.project(point);
  return { x: projected.u, y: 1 - projected.v };
}

function unwrapU(points) {
  const values = points.map((point) => point.x);
  if (Math.max(...values) - Math.min(...values) <= 0.5) return points;
  return points.map((point) => ({ ...point, x: point.x < 0.5 ? point.x + 1 : point.x }));
}

function affineTransform(source, target) {
  const [first, second, third] = source;
  const determinant = first.x * (second.y - third.y) + second.x * (third.y - first.y) + third.x * (first.y - second.y);
  if (Math.abs(determinant) < Number.EPSILON) return null;
  const solve = (values) => {
    const [one, two, three] = values;
    return [
      (one * (second.y - third.y) + two * (third.y - first.y) + three * (first.y - second.y)) / determinant,
      (one * (third.x - second.x) + two * (first.x - third.x) + three * (second.x - first.x)) / determinant,
      (one * (second.x * third.y - third.x * second.y) + two * (third.x * first.y - first.x * third.y) + three * (first.x * second.y - second.x * first.y)) / determinant,
    ];
  };
  const [a, c, e] = solve(target.map((point) => point.x));
  const [b, d, f] = solve(target.map((point) => point.y));
  return [a, b, c, d, e, f];
}

function getPatternTransform(pattern, source, size) {
  const { transform } = pattern;
  const angle = (transform.rotationDeg * Math.PI) / 180;
  const scale = transform.scale;
  const repeatU = transform.repeat.u / scale;
  const repeatV = transform.repeat.v / scale;
  const width = source.width || size;
  const height = source.height || size;
  const a = Math.cos(angle) * repeatU * size / width;
  const b = Math.sin(angle) * repeatU * size / width;
  const c = -Math.sin(angle) * repeatV * size / height;
  const d = Math.cos(angle) * repeatV * size / height;
  const e = transform.offset.u * width;
  const f = transform.offset.v * height;
  if (typeof DOMMatrix === 'function') return new DOMMatrix([a, b, c, d, e, f]);
  return { a, b, c, d, e, f };
}

function normalizeBakeKeyInput({ sourceHash, transform, projectionVersion, projectionId, size }) {
  if (typeof sourceHash !== 'string' || sourceHash.length === 0) throw new Error('sourceHash is required');
  if (!transform || typeof transform !== 'object') throw new Error('transform is required');
  if (!Number.isInteger(projectionVersion) || projectionVersion < 1) throw new Error('projectionVersion must be a positive integer');
  if (typeof projectionId !== 'string' || projectionId.length === 0) throw new Error('projectionId is required');
  if (!Number.isInteger(size) || size < 1) throw new Error('size must be a positive integer');

  return {
    sourceHash,
    transform: canonicalize(transform),
    projectionVersion,
    projectionId,
    size,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function validateBakeRequest({ meshEntries, pattern, sourceTexture, size }) {
  if (!Array.isArray(meshEntries) || meshEntries.length === 0) {
    throw new Error('meshEntries must contain at least one entry');
  }
  if (!pattern || typeof pattern !== 'object') throw new Error('pattern is required');
  if (!sourceTexture) throw new Error('sourceTexture is required');
  normalizeBakeKeyInput({
    sourceHash: pattern.sourceHash,
    transform: pattern.transform,
    projectionVersion: pattern.projectionVersion,
    projectionId: pattern.projectionId ?? pattern.modelProjectionId,
    size,
  });
}

function canvasToPngBlob(canvas) {
  if (typeof canvas.toBlob !== 'function') throw new Error('Canvas PNG export is not supported.');
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Unable to encode bottom pattern atlas as PNG.'));
        return;
      }
      resolve(blob);
    }, PNG_MIME_TYPE);
  });
}
