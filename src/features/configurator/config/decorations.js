export const EDITABLE_REGIONS = ['front', 'back', 'left-sleeve', 'right-sleeve'];
export const MAX_DECORATIONS = 8;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const SUPPORTED_UPLOAD_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

const MIN_POSITION = -1;
const MAX_POSITION = 1;
const MIN_SCALE = 0.35;
const MAX_SCALE = 2.4;
const MIN_ROTATION = -180;
const MAX_ROTATION = 180;

export const LEGACY_PATTERN_ASSET_URLS = {
  'golden-stripe': 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"%3E%3Cpath fill="%23d1b05d" d="M0 84 240 0v36L0 120z"/%3E%3C/svg%3E',
  'night-grid': 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"%3E%3Cg fill="none" stroke="%2320242a" stroke-width="10" opacity=".85"%3E%3Cpath d="M0 25h240M0 60h240M0 95h240M35 0v120M95 0v120M155 0v120M215 0v120"/%3E%3C/g%3E%3C/svg%3E',
};

export function validateDecorationFile(file) {
  if (!file || !SUPPORTED_UPLOAD_TYPES.has(file.type)) {
    return { ok: false, message: '仅支持 PNG、JPG、WebP 或 SVG 图片。' };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: '图片不能超过 5 MB。' };
  }

  return { ok: true };
}

export function createDecoration({ id, kind, source, label, region }) {
  return {
    id,
    kind,
    source,
    label,
    region: EDITABLE_REGIONS.includes(region) ? region : 'front',
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    placement: null,
  };
}

export function patchDecoration(decoration, patch) {
  const region = EDITABLE_REGIONS.includes(patch.region) ? patch.region : decoration.region;
  return {
    ...decoration,
    ...patch,
    region,
    placement: patch.region && region !== decoration.region
      ? null
      : (patch.placement ?? decoration.placement ?? null),
    ...clampDecorationTransform({
      x: patch.x ?? decoration.x,
      y: patch.y ?? decoration.y,
      scale: patch.scale ?? decoration.scale,
      rotation: patch.rotation ?? decoration.rotation,
    }),
  };
}

export function removeDecoration(decorations, id) {
  return decorations.filter((decoration) => decoration.id !== id);
}

export function clampDecorationTransform({ x, y, scale, rotation }) {
  return {
    x: clampNumber(x, MIN_POSITION, MAX_POSITION),
    y: clampNumber(y, MIN_POSITION, MAX_POSITION),
    scale: clampNumber(scale, MIN_SCALE, MAX_SCALE),
    rotation: clampNumber(rotation, MIN_ROTATION, MAX_ROTATION),
  };
}

export function resolveDecorationAsset(decoration, presets = []) {
  if (decoration.kind === 'upload') return decoration.source;
  return presets.find((preset) => preset.source === decoration.source)?.assetUrl
    ?? LEGACY_PATTERN_ASSET_URLS[decoration.source]
    ?? decoration.source;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
