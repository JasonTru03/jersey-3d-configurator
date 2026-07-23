import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserDownload } from './browserDownload.js';

describe('triggerBrowserDownload', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:production-bundle');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a native-link target and releases it only when requested', () => {
    const prepared = createBrowserDownload({
      blob: new Blob(['production-bundle'], { type: 'application/zip' }),
      filename: 'fn8788-jersey-production.zip',
    });

    expect(prepared).toMatchObject({
      filename: 'fn8788-jersey-production.zip',
      url: 'blob:production-bundle',
    });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    prepared.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:production-bundle');
  });
});
