const SAVE_FIRST_MESSAGE = 'Save the current design before adding it to the Shopify cart.';
const STALE_FILES_MESSAGE = 'The design changed after the production files were saved. Save the design again.';

export function createLocalProductionReceipt({ state, productionFiles }) {
  const references = pickProductionFileReferences(productionFiles);
  return {
    stateFingerprint: fingerprintState(state),
    productionFiles: references,
  };
}

export function getCurrentLocalProductionFiles({ state, receipt }) {
  if (!receipt) throw new Error(SAVE_FIRST_MESSAGE);
  if (receipt.stateFingerprint !== fingerprintState(state)) throw new Error(STALE_FILES_MESSAGE);
  return { ...receipt.productionFiles };
}

function fingerprintState(state) {
  if (!state || typeof state !== 'object') throw new Error('A design state is required.');
  return JSON.stringify(state);
}

function pickProductionFileReferences(productionFiles) {
  const references = {
    atlasFilename: productionFiles?.atlasFilename,
    atlasSha256: productionFiles?.atlasSha256,
    designFilename: productionFiles?.designFilename,
  };
  if (Object.values(references).some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('Local production files are not ready.');
  }
  return references;
}
