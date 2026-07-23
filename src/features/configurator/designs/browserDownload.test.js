import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerBrowserDownload } from './browserDownload.js';

describe('triggerBrowserDownload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:production-bundle');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps a large Blob URL alive long enough for the browser to consume it', () => {
    triggerBrowserDownload({
      blob: new Blob(['production-bundle'], { type: 'application/zip' }),
      filename: 'fn8788-jersey-production.zip',
    });

    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(59_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:production-bundle');
  });
});
