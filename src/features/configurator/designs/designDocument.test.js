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

  it('loads legacy print fields as a print item', () => {
    const state = parseDesignDocument(JSON.stringify({
      format: 'jersey-design',
      productId: 'fn8788-jersey',
      state: {
        ...defaultState,
        overrides: { printName: 'MASON', printNumber: '10', printPlacement: { x: 0, y: 0.2, z: 0.5 } },
      },
      version: 1,
    }), { defaultState, expectedProductId: 'fn8788-jersey' });

    expect(state.overrides.printItems).toMatchObject([{ name: 'MASON', number: '10' }]);
  });

  it('mirrors the first print item to legacy fields when saving', () => {
    const document = createDesignDocument({
      productId: 'fn8788-jersey',
      state: {
        ...defaultState,
        overrides: {
          printItems: [{ id: 'print-1', name: 'MASON', number: '10', placement: { x: 0, y: 0.2, z: 0.5 } }],
        },
      },
    });

    expect(document.state.overrides).toMatchObject({ printName: 'MASON', printNumber: '10' });
  });
});
