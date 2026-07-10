import { useCallback, useEffect, useMemo, useState } from 'react';
import { productApi } from '../api/productApi.js';
import { mergeConfiguratorState } from '../config/state.js';

export function useConfigurator() {
  const [product, setProduct] = useState(null);
  const [state, setState] = useState(null);
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
        setState(definition.defaultState);
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
      if (!product || !state) return;
      const nextState = mergeConfiguratorState(state, patch);
      setState(nextState);
      setQuote(await productApi.quoteConfiguration(product.id, nextState));
    },
    [product, state],
  );

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
  };
}
