import { useCallback, useEffect, useMemo, useState } from 'react';
import { productApi } from '../api/productApi.js';
import { selectedOptions } from '../config/selectors.js';
import { mergeConfiguratorState } from '../config/state.js';
import { createDesignDocument, parseDesignDocument } from '../designs/designDocument.js';
import { createDesignDownload, readDesignFile } from '../designs/designFileBrowser.js';
import {
  createDesignHistory,
  getCurrentDesignState,
  moveDesignHistory,
  recordDesignState,
  replaceCurrentDesignState,
} from '../designs/designHistory.js';

export function useConfigurator(initialStateOverride) {
  const [product, setProduct] = useState(null);
  const [history, setHistory] = useState(null);
  const [quote, setQuote] = useState(null);
  const [configurationError, setConfigurationError] = useState('');
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let active = true;

    async function loadProduct() {
      try {
        const products = await productApi.getProducts();
        const definition = await productApi.getProductDefinition(products[0].id);
        const initialState = definition.options.layout.some((option) => option.id === initialStateOverride?.layout)
          ? mergeConfiguratorState(definition.defaultState, { layout: initialStateOverride.layout })
          : definition.defaultState;
        const initialQuote = await productApi.quoteConfiguration(
          definition.id,
          initialState,
        );

        if (!active) return;
        setProduct(definition);
        setHistory(createDesignHistory(initialState));
        setQuote(initialQuote);
        setStatus('ready');
      } catch (error) {
        if (!active) return;
        setStatus('error');
        console.error(error);
      }
    }

    loadProduct();

    return () => {
      active = false;
    };
  }, []);

  const updateState = useCallback(
    async (patch, { quote: shouldQuote = true, recordHistory = true } = {}) => {
      if (!product) {
        return { message: 'The configurator is still loading.', ok: false };
      }
      if (!recordHistory && !shouldQuote) {
        setHistory((currentHistory) => {
          const latestState = getCurrentDesignState(currentHistory);
          return latestState
            ? replaceCurrentDesignState(
                currentHistory,
                mergeConfiguratorState(latestState, patch),
              )
            : currentHistory;
        });
        setConfigurationError('');
        return { ok: true };
      }
      const currentState = getCurrentDesignState(history);
      if (!currentState) {
        return { message: 'The configurator is still loading.', ok: false };
      }
      const nextState = mergeConfiguratorState(currentState, patch);
      try {
        const nextQuote = shouldQuote
          ? await productApi.quoteConfiguration(product.id, nextState)
          : quote;
        setHistory((currentHistory) => (
          recordHistory
            ? recordDesignState(currentHistory, nextState)
            : replaceCurrentDesignState(currentHistory, nextState)
        ));
        if (shouldQuote) setQuote(nextQuote);
        setConfigurationError('');
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Configuration update failed.';
        setConfigurationError(message);
        return { message, ok: false };
      }
    },
    [history, product, quote],
  );

  const moveHistory = useCallback(async (offset) => {
    if (!product || !history) return;
    const nextHistory = moveDesignHistory(history, offset);
    if (nextHistory === history) return;
    const nextState = getCurrentDesignState(nextHistory);
    setHistory(nextHistory);
    setQuote(await productApi.quoteConfiguration(product.id, nextState));
  }, [history, product]);

  const saveDesignFile = useCallback((bakeMetadata) => {
    const currentState = getCurrentDesignState(history);
    if (!product || !currentState) return null;

    const stateForExport = bakeMetadata && currentState.overrides?.bottomPattern?.enabled
      ? {
        ...currentState,
        overrides: {
          ...currentState.overrides,
          bottomPattern: {
            ...currentState.overrides.bottomPattern,
            bakeMetadata: structuredClone(bakeMetadata),
          },
        },
      }
      : currentState;

    return createDesignDownload(createDesignDocument({
      productId: product.id,
      state: stateForExport,
    }));
  }, [history, product]);

  const loadDesignFile = useCallback(async (file) => {
    if (!product) {
      return { message: 'The configurator is still loading.', ok: false };
    }

    try {
      const rawText = await readDesignFile(file);
      const nextState = parseDesignDocument(rawText, {
        colorways: product.options.colorway,
        defaultState: product.defaultState,
        expectedProductId: product.id,
      });
      const nextQuote = await productApi.quoteConfiguration(product.id, nextState);
      setHistory(createDesignHistory(nextState));
      setQuote(nextQuote);
      setConfigurationError('');
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Design file loading failed.';
      setConfigurationError(message);
      return { message, ok: false };
    }
  }, [product]);

  const state = useMemo(() => getCurrentDesignState(history), [history]);
  const canUndo = Boolean(history?.cursor > 0);
  const canRedo = Boolean(history && history.cursor < history.entries.length - 1);

  const selected = useMemo(() => {
    if (!product || !state) return null;
    return selectedOptions(product, state);
  }, [product, state]);

  return {
    product,
    quote,
    selected,
    state,
    status,
    updateState,
    undo: () => moveHistory(-1),
    redo: () => moveHistory(1),
    canUndo,
    canRedo,
    configurationError,
    loadDesignFile,
    saveDesignFile,
  };
}
