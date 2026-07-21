import { normalizeAppearance } from '../config/appearance.js';
import { getPrintItems, legacyFirstItemFields } from '../config/printItems.js';

export const DESIGN_DOCUMENT_FORMAT = 'jersey-design';
export const DESIGN_DOCUMENT_VERSION = 1;

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

  if (document?.format !== DESIGN_DOCUMENT_FORMAT || document.version !== DESIGN_DOCUMENT_VERSION) {
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
  const colorwayId = document.state.colorway ?? defaultState.colorway;
  const legacySwatches = colorways.find((colorway) => colorway.id === colorwayId)?.swatches;
  let appearance;

  try {
    appearance = normalizeAppearance(documentOverrides.appearance, legacySwatches);
  } catch (error) {
    throw new DesignDocumentError('invalid-state', error.message);
  }

  return {
    ...structuredClone(defaultState),
    ...structuredClone(document.state),
    extras: { ...defaultState.extras, ...document.state.extras },
    overrides: {
      ...mergedOverrides,
      appearance,
      printItems,
      ...legacyFirstItemFields(printItems),
    },
  };
}

function normalizePrintState(state) {
  const overrides = state.overrides ?? {};
  const printItems = getPrintItems(overrides);
  return {
    ...state,
    overrides: {
      ...overrides,
      ...(overrides.appearance ? { appearance: normalizeAppearance(overrides.appearance) } : {}),
      printItems,
      ...legacyFirstItemFields(printItems),
    },
  };
}

function hasDocumentPrintData(overrides) {
  return Array.isArray(overrides.printItems)
    || Boolean(overrides.printName || overrides.printNumber || overrides.printPlacement);
}
