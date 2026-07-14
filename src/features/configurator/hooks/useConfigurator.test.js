import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useConfigurator } from './useConfigurator.js';

describe('useConfigurator design files', () => {
  it('exports and restores a saved design through its public actions', async () => {
    const { result } = renderHook(() => useConfigurator());

    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.updateState({ colorway: 'away' });
    });

    const download = result.current.saveDesignFile();
    expect(download.filename).toBe('fn8788-jersey-design.json');

    const file = new File([await download.blob.text()], download.filename, { type: 'application/json' });

    await act(async () => {
      await result.current.updateState({ colorway: 'third' });
      await result.current.loadDesignFile(file);
    });

    expect(result.current.state.colorway).toBe('away');
  });
});
