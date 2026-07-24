import { Rotate3D, SlidersHorizontal, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GarmentRenderer } from './garmentRenderer.js';
import { KeyboardRenderer } from './keyboardRenderer.js';
import { PersonalizationToolbarOverlay } from './PersonalizationToolbarOverlay.jsx';
import {
  duplicateCustomTextItem,
  getBillableCustomTextItems,
  getCustomTextItems,
  patchCustomTextItem,
  removeCustomTextItem,
} from '../config/customTextItems.js';
import { duplicatePrintItem, getPrintItems, legacyFirstItemFields, patchPrintItem, removePrintItem } from '../config/printItems.js';
import { getNextPrintPlacement } from './garmentRenderer.js';

const printCopyCandidates = [
  { x: 0.3, y: 0.36, z: 0.5 },
  { x: -0.3, y: 0.36, z: 0.5 },
  { x: 0, y: 0.08, z: 0.5 },
];

const rendererRegistry = {
  garmentRenderer: GarmentRenderer,
  keyboardRenderer: KeyboardRenderer,
};

export function ProductStage({
  artworkFocusId,
  onBakeProvider,
  onEditPersonalization,
  onPersonalizationSelect,
  onStatePatch,
  personalizationFocusId,
  product,
  state,
  selected,
}) {
  const hostRef = useRef(null);
  const rendererRef = useRef(null);
  const [view, setView] = useState('orbit');
  const printItems = state?.lighting && state.lighting !== 'none' ? getPrintItems(state.overrides) : [];
  const customTextItems = getCustomTextItems(state?.overrides);
  const personalizationItems = [...printItems, ...getBillableCustomTextItems(customTextItems)];
  const [activePrintId, setActivePrintId] = useState(null);
  const [selectedPrintId, setSelectedPrintId] = useState(null);
  const [printAnchor, setPrintAnchor] = useState({ visible: false });

  const handlePrintSelectionChange = useCallback((id) => {
    setActivePrintId(id);
    setSelectedPrintId(id);
    onPersonalizationSelect?.(id);
  }, [onPersonalizationSelect]);

  useEffect(() => {
    if (personalizationFocusId && personalizationItems.some((item) => item.id === personalizationFocusId)) {
      setActivePrintId(personalizationFocusId);
      setSelectedPrintId(personalizationFocusId);
      return;
    }

    setActivePrintId((current) => (
      personalizationItems.some((item) => item.id === current)
        ? current
        : personalizationItems[0]?.id ?? null
    ));
    setSelectedPrintId((current) => {
      if (personalizationItems.some((item) => item.id === current)) return current;
      if (current || personalizationFocusId) onPersonalizationSelect?.(null);
      return null;
    });
    setPrintAnchor((current) => (
      selectedPrintId && !personalizationItems.some((item) => item.id === selectedPrintId)
        ? { visible: false }
        : current
    ));
  }, [state, personalizationFocusId]);

  const patchPrint = (id, patch) => {
    if (customTextItems.some((item) => item.id === id)) {
      onStatePatch({ overrides: { customTextItems: patchCustomTextItem(customTextItems, id, patch) } });
      return;
    }
    const nextItems = patchPrintItem(printItems, id, patch);
    onStatePatch({ overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) } });
  };

  useEffect(() => {
    const Renderer = rendererRegistry[product.renderer];
    if (!hostRef.current || rendererRef.current || !Renderer) return;
    if (!canUseWebGl()) return;

    try {
      rendererRef.current = new Renderer(hostRef.current, {
        onPrintAnchorChange: setPrintAnchor,
        onPrintSelectionChange: handlePrintSelectionChange,
        onStatePatch,
      });
      rendererRef.current.update(product, state, selected);
    } catch (error) {
      console.error(error);
    }

    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [product.renderer]);

  useEffect(() => {
    rendererRef.current?.update(product, state, selected);
  }, [product, selected, state]);

  useEffect(() => {
    if (artworkFocusId) rendererRef.current?.focusDecoration(artworkFocusId);
  }, [artworkFocusId]);

  useEffect(() => {
    rendererRef.current?.setActivePrintId(activePrintId);
  }, [activePrintId]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.onStatePatch = onStatePatch;
      rendererRef.current.onPrintAnchorChange = setPrintAnchor;
      rendererRef.current.onPrintSelectionChange = handlePrintSelectionChange;
    }
  }, [handlePrintSelectionChange, onStatePatch]);

  useEffect(() => {
    rendererRef.current?.setView(view);
  }, [view]);

  useEffect(() => {
    onBakeProvider?.(() => rendererRef.current?.ensureLatestBottomPatternBake?.());
    return () => onBakeProvider?.(null);
  }, [onBakeProvider]);

  return (
    <section className="stage-wrap">
      <div className="stage-toolbar" aria-label="3D view tools">
        <button
          className={view === 'orbit' ? 'active' : ''}
          onClick={() => setView('orbit')}
          title="Orbit view"
          type="button"
        >
          <Rotate3D size={17} />
        </button>
        <button
          className={view === 'top' ? 'active' : ''}
          onClick={() => setView('top')}
          title="Top view"
          type="button"
        >
          <SlidersHorizontal size={17} />
        </button>
        <button
          className={view === 'detail' ? 'active' : ''}
          onClick={() => setView('detail')}
          title="Detail view"
          type="button"
        >
          <ZoomIn size={17} />
        </button>
      </div>
      <div className="stage" ref={hostRef} aria-label={`${product.name} 3D preview`}>
        <div className="stage-fallback">
          <BoxIcon />
        </div>
        <PersonalizationToolbarOverlay
          anchor={selectedPrintId === activePrintId ? printAnchor : { visible: false }}
          item={personalizationItems.find((item) => item.id === selectedPrintId)}
          onCopy={(id) => {
            const placement = getNextPrintPlacement(
              printCopyCandidates,
              personalizationItems.map((item) => item.placement).filter(Boolean),
            );
            const isCustomText = customTextItems.some((item) => item.id === id);
            const copy = isCustomText
              ? duplicateCustomTextItem(customTextItems, id, placement)
              : duplicatePrintItem(printItems, id, placement);
            if (!copy) return;
            if (isCustomText) {
              onStatePatch({ overrides: { customTextItems: [...customTextItems, copy] } });
            } else {
              const nextItems = [...printItems, copy];
              onStatePatch({ overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) } });
            }
            setActivePrintId(copy.id);
            setSelectedPrintId(copy.id);
            onPersonalizationSelect?.(copy.id);
          }}
          onDelete={(id) => {
            setActivePrintId(null);
            setSelectedPrintId(null);
            setPrintAnchor({ visible: false });
            onPersonalizationSelect?.(null);
            if (customTextItems.some((item) => item.id === id)) {
              onStatePatch({ overrides: { customTextItems: removeCustomTextItem(customTextItems, id) } });
            } else {
              const nextItems = removePrintItem(printItems, id);
              onStatePatch({ overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) } });
            }
          }}
          onEdit={(id) => onEditPersonalization?.(id)}
          onRotate={(id, rotation) => patchPrint(id, { rotation })}
          onScale={(id, scale) => patchPrint(id, { scale })}
        />
      </div>
      <div className="stage-caption">
        <strong>{selected.layout?.label}</strong>
        <span>{selected.colorway?.label} / {selected.material?.shortLabel}</span>
      </div>
    </section>
  );
}

function BoxIcon() {
  return <span aria-hidden="true">3D</span>;
}

function canUseWebGl() {
  return typeof window !== 'undefined' && typeof window.WebGLRenderingContext !== 'undefined';
}
