import { normalizeAppearance } from '../config/appearance.js';
import { createDefaultBottomPattern, normalizeBottomPattern } from '../config/bottomPattern.js';
import { getCustomTextItems } from '../config/customTextItems.js';
import { getPrintItems, legacyFirstItemFields } from '../config/printItems.js';

export const DESIGN_DOCUMENT_FORMAT = 'jersey-design';
export const DESIGN_DOCUMENT_VERSION = 3;

export class DesignDocumentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'DesignDocumentError';
  }
}

export function createDesignDocument({ productId, variantId = null, state, savedAt = new Date().toISOString() }) {
  const normalizedState = normalizePrintState(state);
  return {
    format: DESIGN_DOCUMENT_FORMAT,
    productId,
    savedAt,
    state: structuredClone(normalizedState),
    variantId,
    version: DESIGN_DOCUMENT_VERSION,
  };
}

export function parseDesignDocument(rawText, { expectedProductId, defaultState, colorways = [] }) {
  let document;

  try {
    document = JSON.parse(rawText);
  } catch {
    throw new DesignDocumentError('invalid-json', 'This design file is not valid JSON.');
  }

  if (document?.format !== DESIGN_DOCUMENT_FORMAT || ![1, 2, DESIGN_DOCUMENT_VERSION].includes(document.version)) {
    throw new DesignDocumentError('unsupported-version', 'This design file format is not supported.');
  }

  if (document.productId !== expectedProductId) {
    throw new DesignDocumentError('product-mismatch', 'This design file belongs to a different product.');
  }

  if (!document.state || typeof document.state !== 'object') {
    throw new DesignDocumentError('invalid-state', 'This design file does not contain a design state.');
  }

  const documentOverrides = document.state.overrides ?? {};
  const mergedOverrides = { ...defaultState.overrides, ...documentOverrides };
  const printSource = hasDocumentPrintData(documentOverrides) ? documentOverrides : mergedOverrides;
  const printItems = getPrintItems(printSource);
  let customTextItems;
  const colorwayId = document.state.colorway ?? defaultState.colorway;
  const legacySwatches = colorways.find((colorway) => colorway.id === colorwayId)?.swatches;
  let appearance;

  try {
    appearance = normalizeAppearance(documentOverrides.appearance, legacySwatches);
  } catch (error) {
    throw new DesignDocumentError('invalid-state', error.message);
  }
  try {
    customTextItems = getCustomTextItems(documentOverrides);
  } catch (error) {
    throw new DesignDocumentError('invalid-state', error.message);
  }
  const bottomPattern = normalizeDocumentBottomPattern(documentOverrides.bottomPattern, document.version);

  return {
    ...structuredClone(defaultState),
    ...structuredClone(document.state),
    extras: { ...defaultState.extras, ...document.state.extras },
    overrides: {
      ...mergedOverrides,
      appearance,
      bottomPattern,
      customTextItems,
      printItems,
      ...legacyFirstItemFields(printItems),
    },
  };
}

function normalizePrintState(state) {
  const overrides = state.overrides ?? {};
  const printItems = getPrintItems(overrides);
  const customTextItems = getCustomTextItems(overrides);
  return {
    ...state,
    overrides: {
      ...overrides,
      ...(overrides.appearance ? { appearance: normalizeAppearance(overrides.appearance) } : {}),
      ...(overrides.bottomPattern ? { bottomPattern: normalizeDocumentBottomPattern(overrides.bottomPattern, DESIGN_DOCUMENT_VERSION) } : {}),
      customTextItems,
      printItems,
      ...legacyFirstItemFields(printItems),
    },
  };
}

function normalizeDocumentBottomPattern(pattern, version) {
  const normalized = normalizeBottomPattern(pattern ?? createDefaultBottomPattern());
  const source = normalized.source.assetRef.startsWith('data:')
    ? { ...normalized.source, assetRef: '' }
    : normalized.source;
  const safePattern = { ...normalized, source };
  const bakeMetadata = sanitizeBakeMetadata(pattern?.bakeMetadata);
  if (!bakeMetadata) return safePattern;
  return { ...safePattern, bakeMetadata };
}

function sanitizeBakeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const safeKeys = ['bakeKey', 'mimeType', 'atlasSize', 'size', 'width', 'height', 'meshCount', 'sourceHash', 'projectionVersion', 'projectionId', 'atlasFilename', 'atlasSha256'];
  const safeMetadata = safeKeys.reduce((result, key) => {
    const value = metadata[key];
    if (typeof value === 'string' && !value.startsWith('data:')) result[key] = value;
    if (Number.isFinite(value)) result[key] = value;
    return result;
  }, {});
  if (metadata.transform && typeof metadata.transform === 'object') safeMetadata.transform = structuredClone(metadata.transform);
  return Object.keys(safeMetadata).length ? safeMetadata : null;
}

function hasDocumentPrintData(overrides) {
  return Array.isArray(overrides.printItems)
    || Boolean(overrides.printName || overrides.printNumber || overrides.printPlacement);
}
