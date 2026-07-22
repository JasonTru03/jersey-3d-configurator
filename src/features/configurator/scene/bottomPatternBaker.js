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
  context.drawImage(sourceTexture, 0, 0, size, size);
  const blob = await canvasToPngBlob(canvas);

  return {
    blob,
    metadata: {
      key,
      mimeType: PNG_MIME_TYPE,
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
