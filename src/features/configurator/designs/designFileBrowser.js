export function createDesignDownload(document) {
  return {
    blob: new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }),
    filename: `${document.productId}-design.json`,
  };
}

export async function readDesignFile(file) {
  if (!file) {
    throw new Error('Choose a design file first.');
  }

  return file.text();
}
