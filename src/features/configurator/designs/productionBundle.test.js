import { describe, expect, it } from 'vitest';
import { createProductionBundle } from './productionBundle.js';

describe('createProductionBundle', () => {
  it('packages the design JSON and UV atlas into one ZIP download', async () => {
    const result = await createProductionBundle({
      productId: 'fn8788-jersey',
      design: {
        blob: new Blob(['{"format":"jersey-design"}'], { type: 'application/json' }),
        filename: 'fn8788-jersey-design.json',
      },
      atlas: {
        blob: new Blob(['atlas-bytes'], { type: 'image/png' }),
        filename: 'fn8788-jersey-uv-atlas.png',
      },
    });

    expect(result.filename).toBe('fn8788-jersey-production.zip');
    expect(result.blob.type).toBe('application/zip');

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('fn8788-jersey-design.json');
    expect(text).toContain('fn8788-jersey-uv-atlas.png');
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(bytes.slice(-22, -18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
