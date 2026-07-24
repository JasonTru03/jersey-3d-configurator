import {
  BadgeDollarSign,
  Cable,
  CircuitBoard,
  FolderOpen,
  Layers3,
  Lightbulb,
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
import { useEffect, useRef, useState } from 'react';
import { ensurePrintItems, getPrintItems, legacyFirstItemFields, patchPrintItem } from '../config/printItems.js';
import { useConfigurator } from '../hooks/useConfigurator.js';
import { ProductStage } from '../scene/ProductStage.jsx';
import { DecorationPanel } from './DecorationPanel.jsx';
import { DesignReviewDialog } from './DesignReviewDialog.jsx';
import { TemplateLibrary } from './TemplateLibrary.jsx';
import { ZoneColorPanel } from './ZoneColorPanel.jsx';
import { BottomPatternPanel } from './BottomPatternPanel.jsx';
import { APPEARANCE_PALETTE } from '../config/appearance.js';
import { createCartUrl, parseShopifyLaunch } from '../shopify/cartHandoff.js';
import { hashAtlasBlob } from '../scene/bottomPatternBaker.js';
import { createBrowserDownload } from '../designs/browserDownload.js';
import {
  createLocalProductionReceipt,
  getCurrentLocalProductionFiles,
} from '../designs/localProductionReceipt.js';
import { createProductionBundle } from '../designs/productionBundle.js';
import './configurator.css';

const sectionDefaults = [
  { id: 'layout', label: 'Size', icon: Shirt },
  { id: 'colorway', label: 'Color', icon: Palette },
  { id: 'templates', label: 'Template', icon: Palette },
  { id: 'material', label: 'Fabric', icon: Layers3 },
  { id: 'lighting', label: 'Print', icon: Lightbulb },
  { id: 'decorations', label: 'Artwork', icon: Sticker },
  { id: 'extras', label: 'Extras', icon: Cable },
];

export function ConfiguratorPage({ navigateToCart = defaultNavigateToCart } = {}) {
  const [shopifyContext] = useState(() => parseShopifyLaunch(window.location.search));
  const {
    canRedo,
    canUndo,
    configurationError,
    loadDesignFile,
    product,
    quote,
    redo,
    saveDesignFile,
    selected,
    state,
    status,
    undo,
    updateState,
  } = useConfigurator(shopifyContext?.initialLayout ? { layout: shopifyContext.initialLayout } : undefined);
  const fileInputRef = useRef(null);
  const nameInputRef = useRef(null);
  const [editingPrintId, setEditingPrintId] = useState(null);
  const [artworkFocusId, setArtworkFocusId] = useState(null);
  const [section, setSection] = useState('layout');
  const [theme, setTheme] = useState('light');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [fileError, setFileError] = useState('');
  const [cartError, setCartError] = useState('');
  const [localProductionReceipt, setLocalProductionReceipt] = useState(null);
  const [preparedDownload, setPreparedDownload] = useState(null);
  const bakeProviderRef = useRef(null);

  useEffect(() => () => preparedDownload?.release(), [preparedDownload]);

  const handleLightingSelect = (lighting) => {
    if (lighting === 'none') {
      updateState({ lighting });
      return;
    }
    const printItems = ensurePrintItems(getPrintItems(state.overrides));
    updateState({
      lighting,
      overrides: { printItems, ...legacyFirstItemFields(printItems) },
    });
  };

  const handleSaveDesign = async () => {
    try {
      setFileError('');
      const productionFiles = shouldPrepareBottomPatternAsset(state)
        ? await createLocalProductionFiles({ bake: await getLatestPatternBake(bakeProviderRef), productId: product.id })
        : null;
      const download = saveDesignFile(productionFiles?.bakeMetadata);
      if (!download) return;
      let artifact = download;
      let receipt = null;
      if (productionFiles) {
        const bundle = await createProductionBundle({
          productId: product.id,
          design: download,
          atlas: { blob: productionFiles.atlas, filename: productionFiles.atlasFilename },
        });
        artifact = bundle;
        receipt = createLocalProductionReceipt({
          state,
          productionFiles: { ...productionFiles, bundleFilename: bundle.filename },
        });
      }
      setLocalProductionReceipt(null);
      setPreparedDownload({
        ...createBrowserDownload(artifact),
        label: productionFiles ? 'Download production ZIP' : 'Download design JSON',
        receipt,
      });
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Design file preparation failed.');
    }
  };

  const handleLoadDesign = async (event) => {
    const result = await loadDesignFile(event.target.files?.[0] ?? null);
    setFileError(result.ok ? '' : result.message);
    event.target.value = '';
  };

  const handleAddToCart = async () => {
    try {
      setCartError('');
      let productionFiles;
      if (shouldPrepareBottomPatternAsset(state)) {
        productionFiles = getCurrentLocalProductionFiles({ state, receipt: localProductionReceipt });
      }
      const url = createCartUrl({ context: shopifyContext, quote, state, productionFiles });
      navigateToCart(url);
    } catch (error) {
      setCartError(error instanceof Error ? error.message : 'Cart preparation failed.');
    }
  };

  if (status === 'loading') {
    return <main className="boot-screen">Loading configurator</main>;
  }

  if (status === 'error' || !product || !state || !quote || !selected) {
    return <main className="boot-screen">Configurator unavailable</main>;
  }

  return (
    <main className="configurator-shell" data-theme={theme}>
      <Sidebar activeSection={section} labels={product.optionLabels} onSelect={setSection} />
      <section className="workspace">
        <TopBar
          canRedo={canRedo}
          canUndo={canUndo}
          onOpenFile={() => fileInputRef.current?.click()}
          onRedo={redo}
          onReview={() => setReviewOpen(true)}
          onSave={handleSaveDesign}
          onThemeToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          onUndo={undo}
          product={product}
          quote={quote}
          theme={theme}
          />
          <input accept="application/json" hidden onChange={handleLoadDesign} ref={fileInputRef} type="file" />
          {fileError && <p className="file-error" role="alert">{fileError}</p>}
          {configurationError && <p className="file-error" role="alert">{configurationError}</p>}
          {preparedDownload && !reviewOpen && (
            <div className="prepared-download">
              <PreparedDownloadLink
                download={preparedDownload}
                onDownload={() => setLocalProductionReceipt(preparedDownload.receipt)}
              />
            </div>
          )}
        <div className="workspace-grid">
          <ProductStage
            artworkFocusId={artworkFocusId}
            onBakeProvider={(provider) => { bakeProviderRef.current = provider; }}
            onEditPersonalization={(id) => {
              setEditingPrintId(id);
              setSection('lighting');
              requestAnimationFrame(() => nameInputRef.current?.focus());
            }}
            onStatePatch={updateState}
            product={product}
            state={state}
            selected={selected}
          />
          <ConfigPanel
            onArtworkSelect={setArtworkFocusId}
            product={product}
            quote={quote}
            section={section}
            selected={selected}
            state={state}
            updateState={updateState}
            onLightingSelect={handleLightingSelect}
            editingPrintId={editingPrintId}
            nameInputRef={nameInputRef}
          />
        </div>
      </section>
      <DesignReviewDialog
        cartError={cartError}
        onClose={() => setReviewOpen(false)}
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

export async function createLocalProductionFiles({ bake, productId }) {
  if (!bake?.blob || !bake?.metadata) throw new Error('The latest UV atlas is not ready.');
  const atlasFilename = `${productId}-uv-atlas.png`;
  const atlasSha256 = await hashAtlasBlob(bake.blob);
  return {
    atlas: bake.blob,
    atlasFilename,
    atlasSha256,
    designFilename: `${productId}-design.json`,
    bakeMetadata: { ...structuredClone(bake.metadata), atlasFilename, atlasSha256 },
  };
}

async function getLatestPatternBake(bakeProviderRef) {
  return bakeProviderRef.current?.();
}

function defaultNavigateToCart(url) {
  window.location.assign(url);
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

function TopBar({ canRedo, canUndo, onOpenFile, onRedo, onReview, onSave, onThemeToggle, onUndo, product, quote, theme }) {
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
        <button className="soft-button" onClick={onSave} type="button">
          <Save size={17} />
          Save design
        </button>
        <button className="primary-button" onClick={onReview} type="button">
          <ShoppingCart size={17} />
          Review design
        </button>
        <strong className="price-pill">${quote.total}</strong>
      </div>
    </header>
  );
}

function ConfigPanel({ editingPrintId, nameInputRef, onArtworkSelect, onLightingSelect, product, quote, section, selected, state, updateState }) {
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
  const patchBottomPattern = (patch) => updateState({ overrides: { bottomPattern: patch } });

  return (
    <aside className="config-panel">
      <PanelHeader labels={product.optionLabels} section={section} />
      {section === 'layout' && (
        <OptionGrid
          group="layout"
          options={product.options.layout}
          selectedId={state.layout}
          onSelect={(layout) => updateState({ layout })}
        />
      )}
      {section === 'colorway' && (
        <ColorwayPanel
          options={product.options.colorway}
          selectedId={state.colorway}
          onSelect={(colorway) => updateState({ colorway })}
        />
      )}
      {section === 'templates' && (
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
          <BottomPatternPanel
            pattern={state.overrides?.bottomPattern}
            onChange={patchBottomPattern}
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
      {section === 'lighting' && (
        <>
          <OptionGrid
            group="lighting"
            options={product.options.lighting}
            selectedId={state.lighting}
            onSelect={onLightingSelect}
          />
          {state.lighting !== 'none' && (
            <PrintFields
              overrides={state.overrides}
              editingPrintId={editingPrintId}
              nameInputRef={nameInputRef}
              updateState={updateState}
            />
          )}
        </>
      )}
      {section === 'extras' && (
        <ExtrasPanel
          extras={product.options.extras}
          state={state}
          updateState={updateState}
        />
      )}
      {section === 'decorations' && (
        <DecorationPanel onArtworkSelect={onArtworkSelect} product={product} state={state} updateState={updateState} />
      )}
      <BuildSummary quote={quote} selected={selected} />
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

function ColorwayPanel({ options, selectedId, onSelect }) {
  return (
    <div className="option-stack">
      {options.map((option) => (
        <button
          aria-pressed={selectedId === option.id}
          className={selectedId === option.id ? 'option-card color-card active' : 'option-card color-card'}
          data-option-group="colorway"
          data-option-id={option.id}
          key={option.id}
          onClick={() => onSelect(option.id)}
          type="button"
        >
          <span>
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
          <span className="swatch-row" aria-hidden="true">
            {Object.entries(option.swatches)
              .slice(0, 3)
              .map(([key, value]) => (
                <i key={key} style={{ background: value }} />
              ))}
          </span>
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
              updateState({
                extras: {
                  [extra.id]: !enabled,
                },
              })
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

function PrintFields({ editingPrintId, nameInputRef, overrides, updateState }) {
  const items = getPrintItems(overrides);
  const active = items.find((item) => item.id === editingPrintId) ?? items[0];
  const patchActive = (patch) => {
    const next = patchPrintItem(items, active.id, patch);
    updateState({ overrides: { printItems: next, ...legacyFirstItemFields(next) } });
  };
  return (
    <div className="print-fields">
      <label>
        <span>Name</span>
        <input
          maxLength={14}
          onChange={(event) => patchActive({ name: event.target.value })}
          placeholder="PLAYER"
          type="text"
          ref={nameInputRef}
          value={active?.name ?? ''}
        />
      </label>
      <label>
        <span>Number</span>
        <input
          inputMode="numeric"
          maxLength={2}
          onChange={(event) => patchActive({ number: event.target.value })}
          placeholder="16"
          type="text"
          value={active?.number ?? ''}
        />
      </label>
      <p>Drag the print on the jersey to place it.</p>
    </div>
  );
}

function BuildSummary({ quote, selected }) {
  return (
    <section className="summary-panel">
      <div className="summary-title">
        <BadgeDollarSign size={18} />
        <h2>Build Summary</h2>
      </div>
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
      <div className="quote-lines">
        {quote.optionAdjustments.map((adjustment) => (
          <span key={adjustment.label}>
            {adjustment.label}
            <b>+${adjustment.amount}</b>
          </span>
        ))}
      </div>
      <div className="quote-total">
        <span>Total</span>
        <strong>${quote.total}</strong>
      </div>
    </section>
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
