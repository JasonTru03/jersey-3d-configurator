import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

export function useConfigurator(initialStateOverride, { onMutationStart } = {}) {
  const [product, setProduct] = useState(null);
  const [history, setHistory] = useState(null);
  const [quote, setQuote] = useState(null);
  const [configurationError, setConfigurationError] = useState('');
  const [pendingMutationCount, setPendingMutationCount] = useState(0);
  const [status, setStatus] = useState('loading');
  const historyRef = useRef(null);
  const pendingMutationCountRef = useRef(0);
  const quoteRef = useRef(null);
  const mutationQueueRef = useRef(Promise.resolve());
  const onMutationStartRef = useRef(onMutationStart);
  onMutationStartRef.current = onMutationStart;

  const enqueueMutation = useCallback((operation) => {
    onMutationStartRef.current?.();
    pendingMutationCountRef.current += 1;
    setPendingMutationCount(pendingMutationCountRef.current);
    const result = mutationQueueRef.current.then(operation, operation);
    mutationQueueRef.current = result.then(
      () => {
        pendingMutationCountRef.current -= 1;
        setPendingMutationCount(pendingMutationCountRef.current);
      },
      () => {
        pendingMutationCountRef.current -= 1;
        setPendingMutationCount(pendingMutationCountRef.current);
      },
    );
    return result;
  }, []);

  const hasPendingMutation = useCallback(
    () => pendingMutationCountRef.current > 0,
    [],
  );

  const commitHistory = useCallback((nextHistory) => {
    historyRef.current = nextHistory;
    setHistory(nextHistory);
  }, []);

  const commitQuote = useCallback((nextQuote) => {
    quoteRef.current = nextQuote;
    setQuote(nextQuote);
  }, []);

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
        commitHistory(createDesignHistory(initialState));
        commitQuote(initialQuote);
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
  }, [commitHistory, commitQuote]);

  const updateState = useCallback(
    (patch, { quote: shouldQuote = true, recordHistory = true } = {}) => {
      if (!product) {
        return Promise.resolve({ message: 'The configurator is still loading.', ok: false });
      }
      return enqueueMutation(async () => {
        const currentHistory = historyRef.current;
        const currentState = getCurrentDesignState(currentHistory);
        if (!currentState) {
          return { message: 'The configurator is still loading.', ok: false };
        }
        const nextState = mergeConfiguratorState(currentState, patch);
        try {
          const nextQuote = shouldQuote
            ? await productApi.quoteConfiguration(product.id, nextState)
            : quoteRef.current;
          commitHistory(
            recordHistory
              ? recordDesignState(currentHistory, nextState)
              : replaceCurrentDesignState(currentHistory, nextState),
          );
          if (shouldQuote) commitQuote(nextQuote);
          setConfigurationError('');
          return { ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Configuration update failed.';
          setConfigurationError(message);
          return { message, ok: false };
        }
      });
    },
    [commitHistory, commitQuote, enqueueMutation, product],
  );

  const moveHistory = useCallback((offset) => enqueueMutation(async () => {
    const currentHistory = historyRef.current;
    if (!product || !currentHistory) return;
    const nextHistory = moveDesignHistory(currentHistory, offset);
    if (nextHistory === currentHistory) return;
    const nextState = getCurrentDesignState(nextHistory);
    commitHistory(nextHistory);
    commitQuote(await productApi.quoteConfiguration(product.id, nextState));
  }), [commitHistory, commitQuote, enqueueMutation, product]);

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

  const loadDesignFile = useCallback((file) => {
    if (!product) {
      return Promise.resolve({ message: 'The configurator is still loading.', ok: false });
    }

    return enqueueMutation(async () => {
      try {
        const rawText = await readDesignFile(file);
        const nextState = parseDesignDocument(rawText, {
          colorways: product.options.colorway,
          defaultState: product.defaultState,
          expectedProductId: product.id,
        });
        const nextQuote = await productApi.quoteConfiguration(product.id, nextState);
        commitHistory(createDesignHistory(nextState));
        commitQuote(nextQuote);
        setConfigurationError('');
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Design file loading failed.';
        setConfigurationError(message);
        return { message, ok: false };
      }
    });
  }, [commitHistory, commitQuote, enqueueMutation, product]);

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
    hasPendingMutation,
    loadDesignFile,
    mutationPending: pendingMutationCount > 0,
    saveDesignFile,
  };
}
