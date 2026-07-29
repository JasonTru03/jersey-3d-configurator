import { useEffect, useMemo, useRef, useState } from 'react';
import { productApi } from '../api/productApi.js';
import { mergeConfiguratorState } from '../config/state.js';
import { usePersonalizationDeletion } from '../hooks/usePersonalizationDeletion.js';
import { ProductStage } from '../scene/ProductStage.jsx';
import { DecorationPanel } from '../ui/DecorationPanel.jsx';

const defaults = {
  heading: 'Customize your match jersey',
  subheading: 'Preview the FN8788 shirt in 3D before adding it to cart.',
  defaultLayout: 'm',
  defaultColorway: 'home',
  defaultMaterial: 'stadium',
  defaultLighting: 'none',
  productHandle: '',
  productId: '',
  variantId: '',
  modelUrl: '',
};

export function ShopifyConfiguratorSection({ settings = defaults }) {
  const mergedSettings = { ...defaults, ...settings };
  const {
    configurationError,
    product,
    quote,
    selected,
    state,
    updateState,
  } = useShopifyConfigurator(mergedSettings);
  const [artworkFocusId, setArtworkFocusId] = useState(null);
  const [deletionError, setDeletionError] = useState('');
  const [selectedPersonalizationKey, setSelectedPersonalizationKey] = useState(null);
  const personalizationDeletion = usePersonalizationDeletion({
    onError: setDeletionError,
    onSelectionChange: setSelectedPersonalizationKey,
    selectedKey: selectedPersonalizationKey,
    state,
    updateState,
  });

  useEffect(() => {
    if (!product || !selected || !state) return;
    syncLineItemProperties({ product, selected, state, settings: mergedSettings });
  }, [mergedSettings, product, selected, state]);

  if (!product || !quote || !selected || !state) {
    return (
      <section className="pc3d-section">
        <div className="pc3d-loading">Loading 3D configurator</div>
      </section>
    );
  }

  return (
    <section className="pc3d-section">
      <div className="pc3d-header">
        <p className="pc3d-kicker">Interactive 3D builder</p>
        <h2>{mergedSettings.heading}</h2>
        <p>{mergedSettings.subheading}</p>
      </div>
      {(deletionError || configurationError) && (
        <p className="pc3d-error" role="alert">{deletionError || configurationError}</p>
      )}

      <div className="pc3d-layout">
        <ProductStage
          artworkFocusId={artworkFocusId}
          onDeletePersonalization={personalizationDeletion.deletePersonalization}
          onPersonalizationSelect={setSelectedPersonalizationKey}
          onStatePatch={updateState}
          personalizationFocusId={selectedPersonalizationKey}
          personalizationMutationDisabled={personalizationDeletion.deletePending}
          product={product}
          state={state}
          selected={selected}
        />
        <div className="pc3d-panel">
          <OptionGroup
            label={product.optionLabels?.layout ?? 'Size'}
            options={product.options.layout}
            selectedId={state.layout}
            onSelect={(layout) => updateState({ layout })}
          />
          <ColorwayGroup
            options={product.options.colorway}
            selectedId={state.colorway}
            onSelect={(colorway) => updateState({ colorway })}
          />
          <OptionGroup
            label={product.optionLabels?.material ?? 'Fabric'}
            options={product.options.material}
            selectedId={state.material}
            onSelect={(material) => updateState({ material })}
          />
          <OptionGroup
            disabled={personalizationDeletion.deletePending}
            label={product.optionLabels?.lighting ?? 'Print'}
            options={product.options.lighting}
            selectedId={state.lighting}
            onSelect={(lighting) => updateState({ lighting })}
          />
          {state.lighting !== 'none' && (
            <PrintFields
              disabled={personalizationDeletion.deletePending}
              overrides={state.overrides}
              updateState={updateState}
            />
          )}
          <section className="pc3d-group">
            <h3>Artwork</h3>
            <DecorationPanel onArtworkSelect={setArtworkFocusId} product={product} state={state} updateState={updateState} />
          </section>
          <ExtrasGroup extras={product.options.extras} state={state} updateState={updateState} />
          <Summary quote={quote} selected={selected} />
        </div>
      </div>
    </section>
  );
}

function useShopifyConfigurator(settings) {
  const [product, setProduct] = useState(null);
  const [state, setState] = useState(null);
  const [quote, setQuote] = useState(null);
  const [configurationError, setConfigurationError] = useState('');
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let active = true;

    async function load() {
      const products = await productApi.getProducts();
      const definition = await productApi.getProductDefinition(products[0].id);
      if (settings.modelUrl && definition.model) {
        definition.model.glbUrl = settings.modelUrl;
      }
      const initialState = mergeConfiguratorState(definition.defaultState, {
        layout: settings.defaultLayout,
        colorway: settings.defaultColorway,
        material: settings.defaultMaterial,
        lighting: settings.defaultLighting,
      });
      const initialQuote = await productApi.quoteConfiguration(definition.id, initialState);

      if (!active) return;
      setProduct(definition);
      stateRef.current = initialState;
      setState(initialState);
      setQuote(initialQuote);
    }

    load();
    return () => {
      active = false;
    };
  }, [
    settings.defaultColorway,
    settings.defaultLayout,
    settings.defaultLighting,
    settings.defaultMaterial,
    settings.modelUrl,
  ]);

  const updateState = async (
    patch,
    { quote: shouldQuote = true, transactional = false } = {},
  ) => {
    const currentState = stateRef.current;
    if (!product || !currentState) return { message: 'The configurator is still loading.', ok: false };
    const resolvedPatch = resolveShopifyStatePatch(currentState, patch);
    const nextState = mergeConfiguratorState(currentState, resolvedPatch);
    if (!shouldQuote) {
      stateRef.current = nextState;
      setState(nextState);
      setConfigurationError('');
      return { ok: true };
    }
    try {
      if (!transactional) {
        stateRef.current = nextState;
        setState(nextState);
      }
      const nextQuote = await productApi.quoteConfiguration(product.id, nextState);
      if (transactional) {
        stateRef.current = nextState;
        setState(nextState);
      }
      setQuote(nextQuote);
      setConfigurationError('');
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Configuration update failed.';
      setConfigurationError(message);
      return { message, ok: false };
    }
  };

  const selected = useMemo(() => {
    if (!product || !state) return null;
    return {
      layout: product.options.layout.find((option) => option.id === state.layout),
      colorway: product.options.colorway.find((option) => option.id === state.colorway),
      material: product.options.material.find((option) => option.id === state.material),
      lighting: product.options.lighting.find((option) => option.id === state.lighting),
      extras: product.options.extras.filter((option) => Boolean(state.extras[option.id])),
    };
  }, [product, state]);

  return { configurationError, product, quote, selected, state, updateState };
}

function resolveShopifyStatePatch(currentState, patch) {
  const resolvedPatch = typeof patch === 'function' ? patch(currentState) : patch;
  if (Object.prototype.toString.call(resolvedPatch) !== '[object Object]') {
    throw new TypeError('Configuration patch must be an object.');
  }
  return resolvedPatch;
}

function OptionGroup({ disabled = false, label, options, selectedId, onSelect }) {
  return (
    <section className="pc3d-group">
      <h3>{label}</h3>
      <div className="pc3d-options">
        {options.map((option) => (
          <button
            aria-pressed={selectedId === option.id}
            className={selectedId === option.id ? 'pc3d-option active' : 'pc3d-option'}
            disabled={disabled}
            key={option.id}
            onClick={() => onSelect(option.id)}
            type="button"
          >
            <span>
              <strong>{option.shortLabel ?? option.label}</strong>
              <small>{option.description ?? option.label}</small>
            </span>
            <b>{option.priceDelta ? `+$${option.priceDelta}` : 'Base'}</b>
          </button>
        ))}
      </div>
    </section>
  );
}

function ColorwayGroup({ options, selectedId, onSelect }) {
  return (
    <section className="pc3d-group">
      <h3>Colorway</h3>
      <div className="pc3d-options">
        {options.map((option) => (
          <button
            aria-pressed={selectedId === option.id}
            className={selectedId === option.id ? 'pc3d-option active' : 'pc3d-option'}
            key={option.id}
            onClick={() => onSelect(option.id)}
            type="button"
          >
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
            <span className="pc3d-swatches" aria-hidden="true">
              {Object.entries(option.swatches).slice(0, 3).map(([key, value]) => (
                <i key={key} style={{ background: value }} />
              ))}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ExtrasGroup({ extras, state, updateState }) {
  return (
    <section className="pc3d-group">
      <h3>Extras</h3>
      <div className="pc3d-options">
        {extras.map((extra) => {
          const enabled = Boolean(state.extras[extra.id]);
          return (
            <button
              aria-pressed={enabled}
              className={enabled ? 'pc3d-option active' : 'pc3d-option'}
              key={extra.id}
              onClick={() => updateState({ extras: { [extra.id]: !enabled } })}
              type="button"
            >
              <span>
                <strong>{extra.label}</strong>
                <small>{enabled ? 'Included in this build' : 'Available add-on'}</small>
              </span>
              <b>+${extra.priceDelta}</b>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PrintFields({ disabled, overrides, updateState }) {
  return (
    <section className="pc3d-group pc3d-print-fields">
      <h3>Personalization</h3>
      <div>
        <label>
          <span>Name</span>
          <input
            maxLength={14}
            disabled={disabled}
            onChange={(event) => updateState({ overrides: { printName: event.target.value } })}
            placeholder="PLAYER"
            type="text"
            value={overrides.printName ?? ''}
          />
        </label>
        <label>
          <span>Number</span>
          <input
            inputMode="numeric"
            disabled={disabled}
            maxLength={2}
            onChange={(event) => updateState({ overrides: { printNumber: event.target.value } })}
            placeholder="16"
            type="text"
            value={overrides.printNumber ?? ''}
          />
        </label>
      </div>
      <p>Drag the print on the jersey to place it.</p>
    </section>
  );
}

function Summary({ quote, selected }) {
  return (
    <section className="pc3d-summary">
      <h3>Configuration summary</h3>
      <dl>
        <div>
          <dt>Size</dt>
          <dd>{selected.layout?.shortLabel}</dd>
        </div>
        <div>
          <dt>Colorway</dt>
          <dd>{selected.colorway?.label}</dd>
        </div>
        <div>
          <dt>Fabric</dt>
          <dd>{selected.material?.shortLabel}</dd>
        </div>
        <div>
          <dt>Print</dt>
          <dd>{selected.lighting?.shortLabel}</dd>
        </div>
      </dl>
      <strong className="pc3d-total">${quote.total}</strong>
    </section>
  );
}

function syncLineItemProperties({ product, selected, state, settings }) {
  const form = document.querySelector('form[action*="/cart/add"]');
  if (!form) return;

  const extras = selected.extras.map((extra) => extra.label).join(', ') || 'None';
  const labels = product.optionLabels ?? {};
  const properties = {
    [labels.layout ?? 'Size']: selected.layout?.label ?? '',
    [labels.colorway ?? 'Colorway']: selected.colorway?.label ?? '',
    [labels.material ?? 'Fabric']: selected.material?.shortLabel ?? selected.material?.label ?? '',
    [labels.lighting ?? 'Print']: selected.lighting?.shortLabel ?? selected.lighting?.label ?? '',
    'Print Name': state.overrides?.printName ?? '',
    'Print Number': state.overrides?.printNumber ?? '',
    'Print Placement': JSON.stringify(state.overrides?.printPlacement ?? {}),
    Extras: extras,
    '_3D Config JSON': JSON.stringify({
      productId: settings.productId,
      productHandle: settings.productHandle,
      variantId: settings.variantId,
      renderer: product.renderer,
      state: serializeStateForOrder(state),
    }),
  };

  Object.entries(properties).forEach(([name, value]) => {
    upsertHiddenInput(form, `properties[${name}]`, value);
  });
}

export function serializeStateForOrder(state) {
  return {
    ...state,
    overrides: {
      ...state.overrides,
      decorations: (state.overrides?.decorations ?? []).map((decoration) => {
        const { source, ...metadata } = decoration;
        return decoration.kind === 'upload' ? metadata : { ...metadata, source };
      }),
    },
  };
}

function upsertHiddenInput(form, name, value) {
  let input = form.querySelector(`input[name="${cssEscape(name)}"]`);
  if (!input) {
    input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    form.appendChild(input);
  }
  input.value = value;
}

function cssEscape(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
