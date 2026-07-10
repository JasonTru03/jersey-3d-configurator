import {
  BadgeDollarSign,
  Cable,
  CircuitBoard,
  Layers3,
  Lightbulb,
  Moon,
  PackageCheck,
  Palette,
  Save,
  Settings2,
  ShoppingCart,
  Shirt,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
import { useConfigurator } from '../hooks/useConfigurator.js';
import { ProductStage } from '../scene/ProductStage.jsx';
import './configurator.css';

const sectionDefaults = [
  { id: 'layout', label: 'Size', icon: Shirt },
  { id: 'colorway', label: 'Color', icon: Palette },
  { id: 'material', label: 'Fabric', icon: Layers3 },
  { id: 'lighting', label: 'Print', icon: Lightbulb },
  { id: 'extras', label: 'Extras', icon: Cable },
];

export function ConfiguratorPage() {
  const { product, quote, selected, state, status, updateState } = useConfigurator();
  const [section, setSection] = useState('layout');
  const [theme, setTheme] = useState('light');

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
        <TopBar product={product} quote={quote} theme={theme} onThemeToggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
        <div className="workspace-grid">
          <ProductStage
            onStatePatch={updateState}
            product={product}
            state={state}
            selected={selected}
          />
          <ConfigPanel
            product={product}
            quote={quote}
            section={section}
            selected={selected}
            state={state}
            updateState={updateState}
          />
        </div>
      </section>
    </main>
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

function TopBar({ product, quote, theme, onThemeToggle }) {
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
        <button className="soft-button" type="button">
          <Save size={17} />
          Save
        </button>
        <button className="primary-button" type="button">
          <ShoppingCart size={17} />
          Add to cart
        </button>
        <strong className="price-pill">${quote.total}</strong>
      </div>
    </header>
  );
}

function ConfigPanel({ product, quote, section, selected, state, updateState }) {
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
            onSelect={(lighting) => updateState({ lighting })}
          />
          {state.lighting !== 'none' && (
            <PrintFields
              overrides={state.overrides}
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

function PrintFields({ overrides, updateState }) {
  return (
    <div className="print-fields">
      <label>
        <span>Name</span>
        <input
          maxLength={14}
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
          maxLength={2}
          onChange={(event) => updateState({ overrides: { printNumber: event.target.value } })}
          placeholder="16"
          type="text"
          value={overrides.printNumber ?? ''}
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
