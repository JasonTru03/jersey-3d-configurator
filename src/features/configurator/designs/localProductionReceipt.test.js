import { describe, expect, it } from 'vitest';
import {
  createLocalProductionReceipt,
  getCurrentLocalProductionFiles,
} from './localProductionReceipt.js';

const state = {
  layout: 'm',
  overrides: {
    bottomPattern: {
      enabled: true,
      transform: { scale: 1, rotationDeg: 0 },
    },
  },
};

const productionFiles = {
  atlas: new Blob(['atlas'], { type: 'image/png' }),
  atlasFilename: 'chelsea-uv-atlas.png',
  atlasSha256: 'sha256:test',
  bundleFilename: 'chelsea-production.zip',
  designFilename: 'chelsea-design.json',
  uploadUrl: 'https://example.invalid/private',
};

describe('local production receipt', () => {
  it('records the current design and exposes only cart-safe file references', () => {
    const receipt = createLocalProductionReceipt({ state, productionFiles });

    expect(getCurrentLocalProductionFiles({ state, receipt })).toEqual({
      atlasFilename: 'chelsea-uv-atlas.png',
      atlasSha256: 'sha256:test',
      bundleFilename: 'chelsea-production.zip',
      designFilename: 'chelsea-design.json',
    });
    expect(receipt.productionFiles).not.toHaveProperty('atlas');
    expect(receipt.productionFiles).not.toHaveProperty('uploadUrl');
  });

  it('requires a save before a patterned design can enter the cart', () => {
    expect(() => getCurrentLocalProductionFiles({ state, receipt: null }))
      .toThrow('Save the current design before adding it to the Shopify cart.');
  });

  it('rejects production files after the design changes', () => {
    const receipt = createLocalProductionReceipt({ state, productionFiles });
    const changedState = {
      ...state,
      layout: 'l',
    };

    expect(() => getCurrentLocalProductionFiles({ state: changedState, receipt }))
      .toThrow('The design changed after the production files were saved. Save the design again.');
  });
});
