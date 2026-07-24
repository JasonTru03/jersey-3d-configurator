import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConfigurator } from './useConfigurator.js';
import { createCartUrl, parseShopifyLaunch } from '../shopify/cartHandoff.js';
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
    expect(createCartUrl({
      context,
      quote: result.current.quote,
      state: result.current.state,
      designAsset: { designId: 'dsg_test', url: 'https://TARGET/atlas.png', sha256: 'abc', version: 2 },
    }))
      .toContain('/cart/48039101989015:1');
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
    const { result } = renderHook(() => useConfigurator());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const original = JSON.parse(await result.current.saveDesignFile().blob.text());
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
    await act(async () => result.current.updateState(
      {
        overrides: {
          customTextItems: [{
            ...result.current.state.overrides.customTextItems[0],
            placement: { x: 0, y: 0.36, z: 0.5 },
            scale: 1.0271,
          }],
        },
      },
      { quote: false, recordHistory: false },
    ));

    expect(result.current.canUndo).toBe(false);
    const roundtrip = JSON.parse(await result.current.saveDesignFile().blob.text());
    expect(roundtrip.state.overrides.customTextItems[0]).toEqual(expect.objectContaining({
      placement: { x: 0, y: 0.36, z: 0.5 },
      rotation: 15,
      scale: 1.0271,
    }));
  });
});
