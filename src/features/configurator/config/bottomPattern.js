export const BOTTOM_PATTERN_VERSION = 1;

export const DEFAULT_BOTTOM_PATTERN = {
  enabled: false,
  source: {
    kind: 'preset',
    id: 'none',
    assetRef: '',
  },
  transform: {
    offset: { u: 0, v: 0 },
    scale: 1,
    rotationDeg: 0,
    repeat: { u: 3, v: 4 },
  },
  projectionVersion: BOTTOM_PATTERN_VERSION,
  modelProjectionId: 'chelsea-jersey-cylindrical-v1',
};

export function createDefaultBottomPattern() {
  return structuredClone(DEFAULT_BOTTOM_PATTERN);
}

export function normalizeBottomPattern(bottomPattern = {}) {
  const defaults = DEFAULT_BOTTOM_PATTERN;
  const transform = bottomPattern?.transform ?? {};
  const offset = transform.offset ?? {};
  const repeat = transform.repeat ?? {};
  const source = bottomPattern?.source ?? {};

  return {
    enabled: typeof bottomPattern?.enabled === 'boolean' ? bottomPattern.enabled : defaults.enabled,
    source: {
      kind: source.kind === 'preset' ? source.kind : defaults.source.kind,
      id: validPresetId(source.id) ? source.id : defaults.source.id,
      assetRef: typeof source.assetRef === 'string' ? source.assetRef : defaults.source.assetRef,
    },
    transform: {
      offset: {
        u: clampNumber(offset.u, -1, 1, defaults.transform.offset.u),
        v: clampNumber(offset.v, -1, 1, defaults.transform.offset.v),
      },
      scale: clampNumber(transform.scale, 0.1, 8, defaults.transform.scale),
      rotationDeg: normalizeRotation(transform.rotationDeg, defaults.transform.rotationDeg),
      repeat: {
        u: clampNumber(repeat.u, 1, 16, defaults.transform.repeat.u),
        v: clampNumber(repeat.v, 1, 16, defaults.transform.repeat.v),
      },
    },
    projectionVersion: BOTTOM_PATTERN_VERSION,
    modelProjectionId: defaults.modelProjectionId,
  };
}

function validPresetId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function normalizeRotation(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return ((value % 360) + 360) % 360;
}
