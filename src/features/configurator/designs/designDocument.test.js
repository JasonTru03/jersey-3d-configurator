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

  it('preserves legacy artwork regions and mesh placements through an import roundtrip', () => {
    const decorations = [
      {
        id: 'golden-back',
        kind: 'pattern',
        source: 'golden-stripe',
        label: 'Golden Stripe',
        region: 'back',
        x: -0.2,
        y: 0.4,
        scale: 1.1,
        rotation: 15,
        placement: { region: 'back', position: { x: 0.2, y: 0.5, z: -0.7 }, normal: { x: 0, y: 0, z: -1 } },
      },
      {
        id: 'night-left',
        kind: 'pattern',
        source: 'night-grid',
        label: 'Night Grid',
        region: 'left-sleeve',
        x: 0.3,
        y: -0.1,
        scale: 0.9,
        rotation: -20,
        placement: { region: 'left-sleeve', position: { x: -1.1, y: 0.3, z: 0.2 }, normal: { x: -1, y: 0, z: 0 } },
      },
      {
        id: 'golden-right',
        kind: 'pattern',
        source: 'golden-stripe',
        label: 'Golden Stripe',
        region: 'right-sleeve',
        x: -0.4,
        y: 0.2,
        scale: 1.2,
        rotation: 30,
        placement: { region: 'right-sleeve', position: { x: 1.1, y: 0.4, z: -0.2 }, normal: { x: 1, y: 0, z: 0 } },
      },
    ];
    const saved = createDesignDocument({
      productId: 'fn8788-jersey',
      savedAt: '2026-07-17T00:00:00.000Z',
      state: { ...defaultState, overrides: { decorations } },
    });
    const loaded = parseDesignDocument(JSON.stringify(saved), {
      defaultState,
      expectedProductId: 'fn8788-jersey',
    });
    const roundTripped = createDesignDocument({
      productId: 'fn8788-jersey',
      savedAt: '2026-07-17T00:01:00.000Z',
      state: loaded,
    });

    expect(roundTripped.state.overrides.decorations).toEqual(decorations);
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
