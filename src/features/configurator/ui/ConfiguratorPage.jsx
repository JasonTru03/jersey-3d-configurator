import {
  Cable,
  CircuitBoard,
  FolderOpen,
  Layers3,
  Moon,
  PackageCheck,
  Palette,
  Save,
  Redo2,
  Settings2,
  ShoppingCart,
  Sticker,
  Shirt,
  Sun,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfigurator } from '../hooks/useConfigurator.js';
import { usePersonalizationDeletion } from '../hooks/usePersonalizationDeletion.js';
import { ProductStage } from '../scene/ProductStage.jsx';
import { DecorationPanel } from './DecorationPanel.jsx';
import { DesignReviewDialog } from './DesignReviewDialog.jsx';
import { PersonalizePanel } from './PersonalizePanel.jsx';
import { TemplateLibrary } from './TemplateLibrary.jsx';
import { ZoneColorPanel } from './ZoneColorPanel.jsx';
import { APPEARANCE_PALETTE } from '../config/appearance.js';
import { parseShopifyLaunch } from '../shopify/cartHandoff.js';
import { createSecureCartHandoff } from '../shopify/cartQuoteClient.js';
import { createBrowserDownload } from '../designs/browserDownload.js';
import {
  createLocalProductionReceipt,
  getCurrentLocalProductionFiles,
} from '../designs/localProductionReceipt.js';
import { createProductionPackage } from '../designs/productionPackage.js';
import './configurator.css';
import '../scene/personalization-controls.css';

const sectionDefaults = [
  { id: 'layout', label: 'Size', icon: Shirt },
  { id: 'design', label: 'Design', icon: Palette },
  { id: 'material', label: 'Fabric', icon: Layers3 },
  { id: 'personalize', label: 'Personalize', icon: Settings2 },
  { id: 'decorations', label: 'Artwork', icon: Sticker },
  { id: 'extras', label: 'Extras', icon: Cable },
];

export function ConfiguratorPage({ navigateToCart = defaultNavigateToCart } = {}) {
  const [shopifyContext] = useState(() => parseShopifyLaunch(window.location.search));
  const {
    canRedo,
    canUndo,
    configurationError,
    hasPendingMutation,
    loadDesignFile,
    mutationPending,
    product,
    quote,
    redo,
    selected,
    state,
    status,
    undo,
    updateState,
  } = useConfigurator(
    shopifyContext?.initialLayout ? { layout: shopifyContext.initialLayout } : undefined,
    { onMutationStart: handleMutationStart },
  );
  const fileInputRef = useRef(null);
  const [selectedPersonalizationKey, setSelectedPersonalizationKey] = useState(null);
  const [personalizationSidePending, setPersonalizationSidePending] = useState(false);
  const personalizationSidePendingRef = useRef(false);
  const [personalizationSideFocus, setPersonalizationSideFocus] = useState(null);
  const [artworkFocusId, setArtworkFocusId] = useState(null);
  const [section, setSection] = useState('layout');
  const [theme, setTheme] = useState('light');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [fileError, setFileError] = useState('');
  const [cartError, setCartError] = useState('');
  const [cartPending, setCartPending] = useState(false);
  const [localProductionReceipt, setLocalProductionReceipt] = useState(null);
  const [preparedDownload, setPreparedDownload] = useState(null);
  const [productionPending, setProductionPending] = useState(false);
  const [productionProviderReady, setProductionProviderReady] = useState(false);
  const productionProviderRef = useRef(null);
  const productionPendingRef = useRef(false);
  const activeCartRequestRef = useRef(null);
  const cartPendingRef = useRef(false);
  const cartRequestIdRef = useRef(0);
  const latestStateRef = useRef(state);
  const mountedRef = useRef(false);
  const reviewOpenRef = useRef(reviewOpen);
  const saveRequestIdRef = useRef(0);
  latestStateRef.current = state;
  reviewOpenRef.current = reviewOpen;
  const snapshotMutationPending = personalizationSidePending || mutationPending;
  const personalizationDeletion = usePersonalizationDeletion({
    onError: setFileError,
    onSelectionChange: setSelectedPersonalizationKey,
    selectedKey: selectedPersonalizationKey,
    state,
    updateState,
  });
  const handleRendererError = useCallback((error) => {
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    setFileError(message || '3D 服装预览加载失败，请稍后重试。');
  }, []);
  const handleProductionProvider = useCallback((provider) => {
    productionProviderRef.current = provider;
    setProductionProviderReady(typeof provider === 'function');
  }, []);

  const handlePersonalizationSidePendingChange = (pending) => {
    personalizationSidePendingRef.current = pending;
    setPersonalizationSidePending(pending);
  };
  const handlePersonalizationSideFocus = (side) => {
    setPersonalizationSideFocus((current) => ({
      id: (current?.id ?? 0) + 1,
      side,
    }));
  };

  function cancelActiveCartRequest({ updateUi = true } = {}) {
    const activeRequest = activeCartRequestRef.current;
    if (!activeRequest) return;
    activeCartRequestRef.current = null;
    activeRequest.controller.abort();
    cartPendingRef.current = false;
    if (updateUi && mountedRef.current) setCartPending(false);
  }

  function handleMutationStart() {
    saveRequestIdRef.current += 1;
    setPreparedDownload(null);
    cancelActiveCartRequest();
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveRequestIdRef.current += 1;
      productionPendingRef.current = false;
      cancelActiveCartRequest({ updateUi: false });
    };
  }, []);

  useEffect(() => () => preparedDownload?.release(), [preparedDownload]);

  useEffect(() => {
    const activeRequest = activeCartRequestRef.current;
    if (activeRequest && activeRequest.stateSnapshot !== state) {
      cancelActiveCartRequest();
    }
  }, [state]);

  useEffect(() => {
    if (!reviewOpen) cancelActiveCartRequest();
  }, [reviewOpen]);

  const handleSaveDesign = async () => {
    if (
      personalizationSidePendingRef.current
      || hasPendingMutation()
      || productionPendingRef.current
      || !productionProviderRef.current
    ) return;
    const requestId = saveRequestIdRef.current + 1;
    const stateSnapshot = structuredClone(latestStateRef.current);
    saveRequestIdRef.current = requestId;
    productionPendingRef.current = true;
    setProductionPending(true);
    const isCurrentRequest = () => (
      mountedRef.current && saveRequestIdRef.current === requestId
    );
    try {
      setFileError('');
      const artifact = await createProductionPackage({
        artifactProvider: productionProviderRef.current,
        product,
        selected: structuredClone(selected),
        state: stateSnapshot,
        variantId: shopifyContext?.variantId ?? null,
      });
      if (!isCurrentRequest()) return;
      const receipt = shouldPrepareBottomPatternAsset(stateSnapshot)
        ? createReceiptFromProductionPackage({ artifact, state: stateSnapshot })
        : null;
      setLocalProductionReceipt(null);
      setPreparedDownload({
        ...createBrowserDownload(artifact),
        label: 'Download production ZIP',
        receipt,
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      setFileError(error instanceof Error ? error.message : 'Design file preparation failed.');
    } finally {
      productionPendingRef.current = false;
      if (mountedRef.current) setProductionPending(false);
    }
  };

  const handleLoadDesign = async (event) => {
    const result = await loadDesignFile(event.target.files?.[0] ?? null);
    setFileError(result.ok ? '' : result.message);
    event.target.value = '';
  };

  const handleAddToCart = async () => {
    if (
      personalizationSidePendingRef.current
      || hasPendingMutation()
      || cartPendingRef.current
    ) return;
    const controller = new AbortController();
    const id = cartRequestIdRef.current + 1;
    const stateSnapshot = latestStateRef.current;
    cartRequestIdRef.current = id;
    activeCartRequestRef.current = { controller, id, stateSnapshot };
    cartPendingRef.current = true;
    setCartPending(true);
    try {
      setCartError('');
      let productionFiles;
      if (shouldPrepareBottomPatternAsset(stateSnapshot)) {
        productionFiles = getCurrentLocalProductionFiles({ state: stateSnapshot, receipt: localProductionReceipt });
      }
      const result = await createSecureCartHandoff({
        context: shopifyContext,
        state: stateSnapshot,
        productionFiles,
        signal: controller.signal,
      });
      if (
        !mountedRef.current
        || activeCartRequestRef.current?.id !== id
        || !reviewOpenRef.current
        || latestStateRef.current !== stateSnapshot
      ) return;
      navigateToCart(result.handoffUrl);
    } catch (error) {
      if (
        mountedRef.current
        && activeCartRequestRef.current?.id === id
        && !isAbortError(error)
      ) {
        setCartError(error instanceof Error ? error.message : 'Cart preparation failed.');
      }
    } finally {
      if (activeCartRequestRef.current?.id === id) {
        activeCartRequestRef.current = null;
        cartPendingRef.current = false;
        if (mountedRef.current) setCartPending(false);
      }
    }
  };

  const handleCloseReview = () => {
    reviewOpenRef.current = false;
    cancelActiveCartRequest();
    setReviewOpen(false);
  };

  const handleOpenReview = () => {
    if (personalizationSidePendingRef.current || hasPendingMutation()) return;
    reviewOpenRef.current = true;
    setReviewOpen(true);
  };

  if (status === 'loading') {
    return <main className="boot-screen">Loading configurator</main>;
  }

  if (status === 'error' || !product || !state || !quote || !selected) {
    return <main className="boot-screen">Configurator unavailable</main>;
  }

  return (
    <main className="configurator-root configurator-shell" data-theme={theme}>
      <Sidebar activeSection={section} labels={product.optionLabels} onSelect={setSection} />
      <section className="workspace app-shell">
        <TopBar
          canRedo={canRedo}
          canUndo={canUndo}
          onOpenFile={() => fileInputRef.current?.click()}
          onRedo={redo}
          onSave={handleSaveDesign}
          onThemeToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          onUndo={undo}
          product={product}
          saveDisabled={snapshotMutationPending || productionPending || !productionProviderReady}
          theme={theme}
        />
        <input accept="application/json" hidden onChange={handleLoadDesign} ref={fileInputRef} type="file" />
        {(fileError || configurationError || (preparedDownload && !reviewOpen)) && (
          <section aria-label="Configurator status" className="workspace-status">
            {(fileError || configurationError) && (
              <p className="file-error" role="alert">{fileError || configurationError}</p>
            )}
            {preparedDownload && !reviewOpen && (
              <div className="prepared-download">
                <PreparedDownloadLink
                  download={preparedDownload}
                  onDownload={() => setLocalProductionReceipt(preparedDownload.receipt)}
                />
              </div>
            )}
          </section>
        )}
        <div className="workspace-grid">
          <ProductStage
            artworkFocusId={artworkFocusId}
            onRendererError={handleRendererError}
            onProductionProvider={handleProductionProvider}
            onEditPersonalization={(id) => {
              setSelectedPersonalizationKey(id);
              setSection('personalize');
            }}
            onDeletePersonalization={personalizationDeletion.deletePersonalization}
            onPersonalizationSelect={setSelectedPersonalizationKey}
            onStatePatch={updateState}
            personalizationFocusId={selectedPersonalizationKey}
            personalizationMutationDisabled={
              personalizationDeletion.deletePending || personalizationSidePending
            }
            personalizationSideFocus={personalizationSideFocus}
            product={product}
            state={state}
            selected={selected}
          />
          <ConfigPanel
            deletePending={personalizationDeletion.deletePending}
            deletePersonalization={personalizationDeletion.deletePersonalization}
            onArtworkSelect={setArtworkFocusId}
            onSideFocus={handlePersonalizationSideFocus}
            onReview={handleOpenReview}
            onPersonalizationSidePendingChange={handlePersonalizationSidePendingChange}
            personalizationSidePending={personalizationSidePending}
            product={product}
            quote={quote}
            section={section}
            selectedPersonalizationKey={selectedPersonalizationKey}
            snapshotMutationPending={snapshotMutationPending}
            state={state}
            updateState={updateState}
            onPersonalizationSelect={setSelectedPersonalizationKey}
          />
        </div>
      </section>
      <DesignReviewDialog
        cartError={cartError}
        cartPending={cartPending}
        mutationPending={snapshotMutationPending || productionPending}
        onClose={handleCloseReview}
        onAddToCart={handleAddToCart}
        onDownload={() => setLocalProductionReceipt(preparedDownload?.receipt ?? null)}
        onSave={handleSaveDesign}
        open={reviewOpen}
        preparedDownload={preparedDownload}
        product={product}
        quote={quote}
        selected={selected}
        shopifyContext={shopifyContext}
        state={state}
      />
    </main>
  );
}

export function shouldPrepareBottomPatternAsset(state) {
  return state?.overrides?.bottomPattern?.enabled === true;
}

function createReceiptFromProductionPackage({ artifact, state }) {
  const atlas = artifact.manifest?.files?.find((file) => file.name === 'uv-atlas.png');
  if (!atlas?.sha256) {
    throw new Error('生产文件清单缺少 uv-atlas.png。');
  }
  return createLocalProductionReceipt({
    state,
    productionFiles: {
      atlasFilename: 'uv-atlas.png',
      atlasSha256: `sha256:${atlas.sha256}`,
      bundleFilename: artifact.filename,
      designFilename: 'design.json',
    },
  });
}

function defaultNavigateToCart(url) {
  window.location.assign(url);
}

function isAbortError(error) {
  return error !== null && typeof error === 'object' && error.name === 'AbortError';
}

function PreparedDownloadLink({ download, onDownload }) {
  return (
    <a className="soft-button" download={download.filename} href={download.url} onClick={onDownload}>
      <Save size={17} />
      {download.label}
    </a>
  );
}

function Sidebar({ activeSection, labels, onSelect }) {
  const sections = getSections(labels);
  return (
    <aside className="sidebar">
      <div className="brand">
        <CircuitBoard size={25} />
        <span>CONFIGR</span>
      </div>
      <nav className="side-nav" aria-label="Configurator sections">
        {sections.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              className={activeSection === item.id ? 'active' : ''}
              key={item.id}
              onClick={() => onSelect(item.id)}
              type="button"
            >
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-status">
        <PackageCheck size={18} />
        <span>Draft build</span>
      </div>
    </aside>
  );
}

function TopBar({
  canRedo,
  canUndo,
  onOpenFile,
  onRedo,
  onSave,
  onThemeToggle,
  onUndo,
  product,
  saveDisabled,
  theme,
}) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">3D Product Builder</p>
        <h1>{product.name}</h1>
      </div>
      <div className="top-actions">
        <button className="icon-button" onClick={onThemeToggle} type="button" title="Toggle theme">
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <button aria-label="Undo" className="icon-button" disabled={!canUndo} onClick={onUndo} type="button"><Undo2 size={18} /></button>
        <button aria-label="Redo" className="icon-button" disabled={!canRedo} onClick={onRedo} type="button"><Redo2 size={18} /></button>
        <button className="soft-button" onClick={onOpenFile} type="button"><FolderOpen size={17} />Open design</button>
        <button className="soft-button" disabled={saveDisabled} onClick={onSave} type="button">
          <Save size={17} />
          Save design
        </button>
      </div>
    </header>
  );
}

function ConfigPanel({
  deletePending,
  deletePersonalization,
  onArtworkSelect,
  onPersonalizationSelect,
  onPersonalizationSidePendingChange,
  onReview,
  onSideFocus,
  personalizationSidePending,
  product,
  quote,
  section,
  selectedPersonalizationKey,
  snapshotMutationPending,
  state,
  updateState,
}) {
  const patchAppearance = (patch) => {
    const currentAppearance = state.overrides?.appearance ?? {};
    updateState({
      overrides: {
        appearance: {
          ...currentAppearance,
          ...patch,
          colors: {
            ...currentAppearance.colors,
            ...patch.colors,
          },
        },
      },
    });
  };
  return (
    <aside className="config-panel">
      <PanelHeader labels={product.optionLabels} section={section} />
      <div className="panel-scroll">
        {section === 'layout' && (
          <OptionGrid
            group="layout"
            options={product.options.layout}
            selectedId={state.layout}
            onSelect={(layout) => updateState({ layout })}
          />
        )}
        {section === 'design' && (
          <>
            <TemplateLibrary
              activeTemplate={state.overrides?.appearance?.template}
              onSelect={(template) => patchAppearance({ template })}
              templates={product.options.templates}
            />
            <ZoneColorPanel
              colors={state.overrides?.appearance?.colors ?? {}}
              onColorChange={(colors) => patchAppearance({ colors })}
              palette={APPEARANCE_PALETTE}
            />
          </>
        )}
        {section === 'material' && (
          <OptionGrid
            group="material"
            options={product.options.material}
            selectedId={state.material}
            onSelect={(material) => updateState({ material })}
          />
        )}
        {section === 'personalize' && (
          <PersonalizePanel
            deletePending={deletePending}
            deletePersonalization={deletePersonalization}
            onSelect={onPersonalizationSelect}
            onSideFocus={onSideFocus}
            onSidePendingChange={onPersonalizationSidePendingChange}
            selectedKey={selectedPersonalizationKey}
            sidePending={personalizationSidePending}
            state={state}
            updateState={updateState}
          />
        )}
        {section === 'extras' && (
          <ExtrasPanel
            extras={product.options.extras}
            state={state}
            updateState={updateState}
          />
        )}
        {section === 'decorations' && (
          <DecorationPanel
            onArtworkSelect={onArtworkSelect}
            onSideFocus={onSideFocus}
            product={product}
            state={state}
            updateState={updateState}
          />
        )}
      </div>
      <div className="panel-checkout" data-testid="panel-checkout">
        <span>
          <small>Total</small>
          <strong>${quote.total}</strong>
        </span>
        <button
          className="primary-button"
          disabled={snapshotMutationPending}
          onClick={onReview}
          type="button"
        >
          <ShoppingCart size={17} />
          Review design
        </button>
      </div>
    </aside>
  );
}

function PanelHeader({ labels, section }) {
  const sectionMeta = getSections(labels).find((item) => item.id === section);
  const Icon = sectionMeta?.icon ?? Settings2;

  return (
    <div className="panel-header">
      <Icon size={19} />
      <div>
        <p className="eyebrow">Configure</p>
        <h2>{sectionMeta?.label}</h2>
      </div>
    </div>
  );
}

function OptionGrid({ group, options, selectedId, onSelect }) {
  return (
    <div className="option-stack">
      {options.map((option) => (
        <button
          aria-pressed={selectedId === option.id}
          className={selectedId === option.id ? 'option-card active' : 'option-card'}
          data-option-group={group}
          data-option-id={option.id}
          key={option.id}
          onClick={() => onSelect(option.id)}
          type="button"
        >
          <span>
            <strong>{option.shortLabel ?? option.label}</strong>
            <small>{option.description ?? option.label}</small>
          </span>
          <PriceDelta amount={option.priceDelta} />
        </button>
      ))}
    </div>
  );
}

function ExtrasPanel({ extras, state, updateState }) {
  return (
    <div className="option-stack">
      {extras.map((extra) => {
        const enabled = Boolean(state.extras[extra.id]);
        return (
          <button
            aria-pressed={enabled}
            className={enabled ? 'option-card active' : 'option-card'}
            data-option-group="extras"
            data-option-id={extra.id}
            key={extra.id}
            onClick={() =>
              updateState((latestState) => ({
                extras: {
                  [extra.id]: !Boolean(latestState.extras?.[extra.id]),
                },
              }))
            }
            type="button"
          >
            <span>
              <strong>{extra.label}</strong>
              <small>{enabled ? 'Included in this build' : 'Available add-on'}</small>
            </span>
            <PriceDelta amount={extra.priceDelta} />
          </button>
        );
      })}
    </div>
  );
}

function PriceDelta({ amount }) {
  return <b className="price-delta">{amount ? `+$${amount}` : 'Base'}</b>;
}

function getSections(labels = {}) {
  return sectionDefaults.map((section) => ({
    ...section,
    label: labels[section.id] ?? section.label,
  }));
}
