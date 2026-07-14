import { describe, expect, it } from 'vitest';
import { DesignDocumentError, createDesignDocument, parseDesignDocument } from './designDocument.js';

const defaultState = {
  colorway: 'home',
  extras: {},
  overrides: { decorations: [] },
  productId: 'fn8788-jersey',
};

describe('design document', () => {
  it('preserves uploaded artwork when a document is exported and imported', () => {
    const document = createDesignDocument({
      productId: 'fn8788-jersey',
      savedAt: '2026-07-14T00:00:00.000Z',
      state: {
        ...defaultState,
        overrides: {
          decorations: [{ id: 'upload-1', kind: 'upload', source: 'data:image/png;base64,abc' }],
        },
      },
    });

    expect(parseDesignDocument(JSON.stringify(document), {
      defaultState,
      expectedProductId: 'fn8788-jersey',
    })).toMatchObject({
      overrides: { decorations: [{ source: 'data:image/png;base64,abc' }] },
    });
  });

  it('rejects a document for another product without returning a replacement state', () => {
    expect(() => parseDesignDocument(JSON.stringify({
      format: 'jersey-design',
      productId: 'other-product',
      state: {},
      version: 1,
    }), {
      defaultState,
      expectedProductId: 'fn8788-jersey',
    })).toThrow(DesignDocumentError);
  });
});
