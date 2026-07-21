import { useCallback, useEffect, useMemo, useState } from 'react';
import { productApi } from '../api/productApi.js';
import { mergeConfiguratorState } from '../config/state.js';
import { createDesignDocument, parseDesignDocument } from '../designs/designDocument.js';
import { createDesignDownload, readDesignFile } from '../designs/designFileBrowser.js';
import {
  createDesignHistory,
  getCurrentDesignState,
  moveDesignHistory,
  recordDesignState,
} from '../designs/designHistory.js';

export function useConfigurator() {
  const [product, setProduct] = useState(null);
  const [history, setHistory] = useState(null);
  const [quote, setQuote] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let active = true;

    async function loadProduct() {
      try {
        const products = await productApi.getProducts();
        const definition = await productApi.getProductDefinition(products[0].id);
        const initialQuote = await productApi.quoteConfiguration(
          definition.id,
          definition.defaultState,
        );

        if (!active) return;
        setProduct(definition);
        setHistory(createDesignHistory(definition.defaultState));
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
    async (patch) => {
      const currentState = getCurrentDesignState(history);
      if (!product || !currentState) return;
      const nextState = mergeConfiguratorState(currentState, patch);
      setHistory((currentHistory) => recordDesignState(currentHistory, nextState));
      setQuote(await productApi.quoteConfiguration(product.id, nextState));
    },
    [history, product],
  );

  const moveHistory = useCallback(async (offset) => {
    if (!product || !history) return;
    const nextHistory = moveDesignHistory(history, offset);
    if (nextHistory === history) return;
    const nextState = getCurrentDesignState(nextHistory);
    setHistory(nextHistory);
    setQuote(await productApi.quoteConfiguration(product.id, nextState));
  }, [history, product]);

  const saveDesignFile = useCallback(() => {
    const currentState = getCurrentDesignState(history);
    if (!product || !currentState) return null;

    return createDesignDownload(createDesignDocument({
      productId: product.id,
      state: currentState,
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
      setHistory(createDesignHistory(nextState));
      setQuote(await productApi.quoteConfiguration(product.id, nextState));
      return { ok: true };
    } catch (error) {
      return { message: error.message, ok: false };
    }
  }, [product]);

  const state = useMemo(() => getCurrentDesignState(history), [history]);
  const canUndo = Boolean(history?.cursor > 0);
  const canRedo = Boolean(history && history.cursor < history.entries.length - 1);

  const selected = useMemo(() => {
    if (!product || !state) return null;
    return {
      layout: product.options.layout.find((option) => option.id === state.layout),
      colorway: product.options.colorway.find((option) => option.id === state.colorway),
      material: product.options.material.find((option) => option.id === state.material),
      lighting: product.options.lighting.find((option) => option.id === state.lighting),
      extras: product.options.extras.filter((option) => state.extras[option.id]),
    };
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
    loadDesignFile,
    saveDesignFile,
  };
}
