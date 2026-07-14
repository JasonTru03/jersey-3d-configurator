import { describe, expect, it } from 'vitest';
import { createDesignDownload, readDesignFile } from './designFileBrowser.js';

describe('design file browser', () => {
  it('creates a JSON download named with the product id', () => {
    const result = createDesignDownload({
      productId: 'fn8788-jersey',
      savedAt: '2026-07-14T00:00:00.000Z',
      state: {},
    });

    expect(result.filename).toBe('fn8788-jersey-design.json');
    expect(result.blob.type).toBe('application/json');
  });

  it('rejects a missing file before parsing', async () => {
    await expect(readDesignFile(null)).rejects.toThrow('Choose a design file first.');
  });
});
