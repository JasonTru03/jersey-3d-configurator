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
  return {
    format: DESIGN_DOCUMENT_FORMAT,
    productId,
    savedAt,
    state: structuredClone(state),
    variantId,
    version: DESIGN_DOCUMENT_VERSION,
  };
}

export function parseDesignDocument(rawText, { expectedProductId, defaultState }) {
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

  return {
    ...structuredClone(defaultState),
    ...structuredClone(document.state),
    extras: { ...defaultState.extras, ...document.state.extras },
    overrides: { ...defaultState.overrides, ...document.state.overrides },
  };
}
