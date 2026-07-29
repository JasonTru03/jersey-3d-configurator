import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConfigurator } from './useConfigurator.js';
import { parseShopifyLaunch } from '../shopify/cartHandoff.js';
import { productApi } from '../api/productApi.js';

describe('useConfigurator design files', () => {
  it('initializes the Shopify-selected XL variant and retains its cart variant ID', async () => {
    const context = parseShopifyLaunch(
      '?shop=testcsj.myshopify.com&variantMap=%7B%22s%22%3A%2248039101890711%22%2C%22m%22%3A%2248039101923479%22%2C%22l%22%3A%2248039101956247%22%2C%22xl%22%3A%2248039101989015%22%7D&variantId=48039101989015',
    );
    const { result } = renderHook(() => useConfigurator({ layout: context?.initialLayout }));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(context?.initialLayout).toBe('xl');
    expect(result.current.state.layout).toBe('xl');
    expect(context.variantMap[result.current.state.layout]).toBe('48039101989015');
  });

  it('exposes normalized appearance in selected options for the garment renderer', async () => {
    const { result } = renderHook(() => useConfigurator());

    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.selected.appearance).toEqual({
      template: 'solid',
      colors: {
        body: '#F7F5EF',
        sleeves: '#F7F5EF',
        shoulderSide: '#20242A',
        collar: '#20242A',
        pattern: '#D8C17A',
        number: '#20242A',
      },
    });
  });

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

  it('includes local production atlas metadata in a saved bottom-pattern design file', async () => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.updateState({ overrides: { bottomPattern: { enabled: true } } });
    });

    const download = result.current.saveDesignFile({
      atlasFilename: 'fn8788-uv-atlas.png',
      atlasSha256: 'sha256:abc123',
    });
    const document = JSON.parse(await download.blob.text());

    expect(document.state.overrides.bottomPattern.bakeMetadata).toMatchObject({
      atlasFilename: 'fn8788-uv-atlas.png',
      atlasSha256: 'sha256:abc123',
    });
  });

  it('keeps the current configuration when an invalid custom text patch cannot be quoted', async () => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const previousState = result.current.state;
    const previousQuote = result.current.quote;
    let response;

    await act(async () => {
      response = await result.current.updateState({ overrides: { customTextItems: 'not-an-array' } });
    });

    expect(response).toEqual({ ok: false, message: 'Custom text items must be an array.' });
    expect(result.current.state).toEqual(previousState);
    expect(result.current.quote).toEqual(previousQuote);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.configurationError).toBe('Custom text items must be an array.');
  });

  it('normalizes placement without a quote, history node, or redo truncation', async () => {
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration');
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.updateState({ colorway: 'away' });
      await result.current.updateState({ colorway: 'third' });
    });
    await act(async () => result.current.undo());
    const callsBeforeNormalization = quoteSpy.mock.calls.length;

    await act(async () => {
      await result.current.updateState(
        { overrides: { customTextItems: [{ id: 'legacy', text: 'MASON', scale: 1.0261 }] } },
        { quote: false, recordHistory: false },
      );
    });

    expect(quoteSpy).toHaveBeenCalledTimes(callsBeforeNormalization);
    expect(result.current.state.overrides.customTextItems[0].scale).toBe(1.0261);
    expect(result.current.canRedo).toBe(true);
    await act(async () => result.current.undo());
    expect(result.current.state.colorway).toBe('home');
    quoteSpy.mockRestore();
  });

  it('roundtrips an opened legacy design after non-historical placement normalization', async () => {
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration');
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const normalizeFromRenderer = result.current.updateState;
    const original = JSON.parse(await result.current.saveDesignFile().blob.text());
    original.state.layout = 'xl';
    original.state.colorway = 'third';
    original.state.lighting = 'name-number';
    original.state.overrides.printItems = [{
      id: 'player',
      name: 'KEEP',
      number: '77',
      placement: { x: 0.25, y: 0.36, z: 0.5 },
      rotation: 0,
      scale: 1,
    }];
    original.state.overrides.customTextItems = [{
      id: 'legacy',
      text: 'MASON',
      placement: { x: 99, y: 99, z: 99 },
      rotation: 15,
      scale: 1.8,
    }];
    const file = new File(
      [JSON.stringify(original)],
      'legacy-invalid-placement.json',
      { type: 'application/json' },
    );

    await act(async () => result.current.loadDesignFile(file));
    const quoteCallsAfterLoad = quoteSpy.mock.calls.length;
    await act(async () => normalizeFromRenderer(
      {
        overrides: {
          customTextItems: [{
            ...original.state.overrides.customTextItems[0],
            placement: { x: 0, y: 0.36, z: 0.5 },
            scale: 1.0271,
          }],
        },
      },
      { quote: false, recordHistory: false },
    ));

    expect(result.current.canUndo).toBe(false);
    expect(quoteSpy).toHaveBeenCalledTimes(quoteCallsAfterLoad);
    expect(result.current.state.layout).toBe('xl');
    expect(result.current.state.colorway).toBe('third');
    expect(result.current.state.overrides.printItems).toEqual([
      expect.objectContaining({ id: 'player', name: 'KEEP', number: '77' }),
    ]);
    const roundtrip = JSON.parse(await result.current.saveDesignFile().blob.text());
    expect(roundtrip.state.overrides.customTextItems[0]).toEqual(expect.objectContaining({
      placement: { x: 0, y: 0.36, z: 0.5 },
      rotation: 15,
      scale: 1.0271,
    }));
    quoteSpy.mockRestore();
  });
});

describe('useConfigurator mutation serialization', () => {
  it('keeps a later personalization-side update when an earlier configuration quote is pending', async () => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const firstQuote = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(firstQuote.promise);
    let layoutUpdate;
    let sideUpdate;

    try {
      act(() => {
        layoutUpdate = result.current.updateState({ layout: 'xl' });
        sideUpdate = result.current.updateState({
          overrides: {
            customTextItems: [{
              id: 'custom-text',
              placement: { side: 'back' },
              text: 'MASON',
            }],
          },
        });
      });

      expect(result.current.hasPendingMutation()).toBe(true);
      await waitFor(() => expect(result.current.mutationPending).toBe(true));
      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(1));
      firstQuote.resolve(result.current.quote);
      await act(async () => {
        await Promise.all([layoutUpdate, sideUpdate]);
      });

      expect(result.current.hasPendingMutation()).toBe(false);
      expect(result.current.mutationPending).toBe(false);
      expect(result.current.state.layout).toBe('xl');
      expect(result.current.state.overrides.customTextItems[0].placement.side).toBe('back');
    } finally {
      quoteSpy.mockRestore();
    }
  });

  it('keeps a later configuration update when an earlier personalization-side quote is pending', async () => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const firstQuote = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(firstQuote.promise);
    let sideUpdate;
    let layoutUpdate;

    try {
      act(() => {
        sideUpdate = result.current.updateState({
          overrides: {
            customTextItems: [{
              id: 'custom-text',
              placement: { side: 'back' },
              text: 'MASON',
            }],
          },
        });
        layoutUpdate = result.current.updateState({ layout: 'xl' });
      });

      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(1));
      firstQuote.resolve(result.current.quote);
      await act(async () => {
        await Promise.all([sideUpdate, layoutUpdate]);
      });

      expect(result.current.state.layout).toBe('xl');
      expect(result.current.state.overrides.customTextItems[0].placement.side).toBe('back');
    } finally {
      quoteSpy.mockRestore();
    }
  });

  it('resolves a functional patch against the latest committed array state', async () => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const initialItems = [
      {
        id: 'first',
        name: 'FIRST',
        placement: { x: -0.2, y: 0.45, z: 0.48 },
      },
      {
        id: 'second',
        name: 'SECOND',
        placement: { x: 0.2, y: 0.45, z: 0.48 },
      },
    ];
    await act(async () => {
      await result.current.updateState(
        { overrides: { printItems: initialItems } },
        { quote: false },
      );
    });
    const firstQuote = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(firstQuote.promise);
    let nameUpdate;
    let sideUpdate;

    try {
      act(() => {
        nameUpdate = result.current.updateState({
          overrides: {
            printItems: initialItems.map((item) => (
              item.id === 'second' ? { ...item, name: 'UPDATED' } : item
            )),
          },
        });
        sideUpdate = result.current.updateState((latestState) => ({
          overrides: {
            printItems: latestState.overrides.printItems.map((item) => (
              item.id === 'second'
                ? { ...item, placement: { x: 0, y: 0.36, z: -0.5 } }
                : item
            )),
          },
        }));
      });
      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(1));
      firstQuote.resolve(result.current.quote);
      await act(async () => {
        await Promise.all([nameUpdate, sideUpdate]);
      });

      expect(result.current.state.overrides.printItems).toEqual([
        initialItems[0],
        {
          ...initialItems[1],
          name: 'UPDATED',
          placement: { x: 0, y: 0.36, z: -0.5 },
        },
      ]);
    } finally {
      firstQuote.resolve(result.current.quote);
      await Promise.allSettled([firstQuote.promise, nameUpdate, sideUpdate]);
      quoteSpy.mockRestore();
    }
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('Quote rejected.'))],
    ['throws', () => { throw new Error('Quote threw.'); }],
  ])('continues with the next update when the first quote %s', async (_label, failQuote) => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const firstQuoteStarted = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockImplementationOnce((...args) => {
        firstQuoteStarted.resolve();
        return failQuote(...args);
      });
    let failedUpdate;
    let nextUpdate;

    try {
      act(() => {
        failedUpdate = result.current.updateState({ material: 'pro' });
        nextUpdate = result.current.updateState({ layout: 'xl' });
      });

      await firstQuoteStarted.promise;
      await act(async () => {
        expect(await failedUpdate).toEqual({
          message: expect.stringMatching(/^Quote (rejected|threw)\.$/),
          ok: false,
        });
        expect(await nextUpdate).toEqual({ ok: true });
      });

      expect(quoteSpy).toHaveBeenCalledTimes(2);
      expect(result.current.state.material).not.toBe('pro');
      expect(result.current.state.layout).toBe('xl');
    } finally {
      quoteSpy.mockRestore();
    }
  });

  it('records queued updates in invocation order so undo removes one committed update at a time', async () => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const firstQuote = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(firstQuote.promise);
    let layoutUpdate;
    let sideUpdate;

    try {
      act(() => {
        layoutUpdate = result.current.updateState({ layout: 'xl' });
        sideUpdate = result.current.updateState({
          overrides: {
            customTextItems: [{
              id: 'custom-text',
              placement: { side: 'back' },
              text: 'MASON',
            }],
          },
        });
      });
      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(1));
      firstQuote.resolve(result.current.quote);
      await act(async () => {
        await Promise.all([layoutUpdate, sideUpdate]);
      });

      await act(async () => result.current.undo());
      expect(result.current.state.layout).toBe('xl');
      expect(result.current.state.overrides.customTextItems).toEqual([]);

      await act(async () => result.current.undo());
      expect(result.current.state.layout).toBe('m');
      expect(result.current.canUndo).toBe(false);
    } finally {
      quoteSpy.mockRestore();
    }
  });

  it('applies undo after an earlier pending update commits', async () => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const firstQuote = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(firstQuote.promise);
    let update;
    let undo;

    try {
      act(() => {
        update = result.current.updateState({ layout: 'xl' });
        undo = result.current.undo();
      });
      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(1));
      firstQuote.resolve(result.current.quote);
      await act(async () => {
        await Promise.all([update, undo]);
      });

      expect(result.current.state.layout).toBe('m');
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);
    } finally {
      quoteSpy.mockRestore();
    }
  });

  it('continues with the next update when an undo quote rejects', async () => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.updateState({ layout: 'xl' });
    });
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockRejectedValueOnce(new Error('Undo quote rejected.'));
    let undo;
    let nextUpdate;

    try {
      act(() => {
        undo = result.current.undo();
        nextUpdate = result.current.updateState({ material: 'player' });
      });
      await act(async () => {
        await expect(undo).rejects.toThrow('Undo quote rejected.');
        await expect(nextUpdate).resolves.toEqual({ ok: true });
      });

      expect(quoteSpy).toHaveBeenCalledTimes(2);
      expect(result.current.state.layout).toBe('m');
      expect(result.current.state.material).toBe('player');
      expect(result.current.canUndo).toBe(true);
      expect(result.current.canRedo).toBe(false);
    } finally {
      quoteSpy.mockRestore();
    }
  });

  it('loads a design after an earlier pending update instead of letting that update overwrite it', async () => {
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const document = JSON.parse(await result.current.saveDesignFile().blob.text());
    document.state.layout = 'xl';
    document.state.colorway = 'third';
    const file = new File(
      [JSON.stringify(document)],
      'queued-design.json',
      { type: 'application/json' },
    );
    const firstQuote = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(firstQuote.promise);
    let update;
    let load;

    try {
      act(() => {
        update = result.current.updateState({ material: 'pro' });
        load = result.current.loadDesignFile(file);
      });
      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(1));
      firstQuote.resolve(result.current.quote);
      await act(async () => {
        await Promise.all([update, load]);
      });

      expect(result.current.state.layout).toBe('xl');
      expect(result.current.state.colorway).toBe('third');
      expect(result.current.canUndo).toBe(false);
    } finally {
      quoteSpy.mockRestore();
    }
  });
});

function createDeferred() {
  let reject;
  let resolve;
  const promise = new Promise((next, fail) => {
    reject = fail;
    resolve = next;
  });
  return { promise, reject, resolve };
}
