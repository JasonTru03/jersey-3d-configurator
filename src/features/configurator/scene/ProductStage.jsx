import { Rotate3D, SlidersHorizontal, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GarmentRenderer } from './garmentRenderer.js';
import { KeyboardRenderer } from './keyboardRenderer.js';
import { PersonalizationToolbarOverlay } from './PersonalizationToolbarOverlay.jsx';
import {
  duplicateCustomTextItem,
  getCustomTextItems,
  patchCustomTextItem,
} from '../config/customTextItems.js';
import { duplicatePrintItem, getPrintItems, legacyFirstItemFields, patchPrintItem } from '../config/printItems.js';
import {
  findPersonalizationItem,
  getRenderablePersonalizationItems,
  getSelectablePersonalizationItems,
  makePersonalizationKey,
  PERSONALIZATION_COPY_CANDIDATES,
} from '../config/personalizationItems.js';
import { getNextPrintPlacement } from './garmentRenderer.js';

const rendererRegistry = {
  garmentRenderer: GarmentRenderer,
  keyboardRenderer: KeyboardRenderer,
};

export function ProductStage({
  artworkFocusId,
  deletePending = false,
  onBakeProvider,
  onDeletePersonalization,
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
  const reportedNullSelectionRef = useRef(null);
  const reconciliationInputRef = useRef({ focusId: Symbol('initial-focus'), keys: null });
  const [view, setView] = useState('orbit');
  const printItems = state?.lighting && state.lighting !== 'none' ? getPrintItems(state.overrides) : [];
  const customTextItems = getCustomTextItems(state?.overrides);
  const selectablePersonalizationItems = useMemo(
    () => getSelectablePersonalizationItems(state),
    [state],
  );
  const renderablePersonalizationItems = useMemo(
    () => getRenderablePersonalizationItems(state),
    [state],
  );
  const selectableKeys = useMemo(
    () => new Set(selectablePersonalizationItems.map((item) => item.key)),
    [selectablePersonalizationItems],
  );
  const [activePrintId, setActivePrintId] = useState(null);
  const [selectedPrintId, setSelectedPrintId] = useState(null);
  const [printAnchor, setPrintAnchor] = useState({ visible: false });
  const templateLabel = (product.options?.templates ?? []).find(
    (template) => template.id === state.overrides?.appearance?.template,
  )?.label ?? 'Solid';

  const handlePrintSelectionChange = useCallback((id) => {
    reportedNullSelectionRef.current = id === null ? reportedNullSelectionRef.current : null;
    setActivePrintId(id);
    setSelectedPrintId(id);
    onPersonalizationSelect?.(id);
  }, [onPersonalizationSelect]);

  useEffect(() => {
    const previousInput = reconciliationInputRef.current;
    if (previousInput.keys === selectableKeys && previousInput.focusId === personalizationFocusId) return;
    reconciliationInputRef.current = { focusId: personalizationFocusId, keys: selectableKeys };

    const focusIsValid = personalizationFocusId && selectableKeys.has(personalizationFocusId);
    const invalidFocusId = personalizationFocusId && !focusIsValid
      ? personalizationFocusId
      : null;
    const nextActiveId = focusIsValid
      ? personalizationFocusId
      : (selectableKeys.has(activePrintId)
          ? activePrintId
          : selectablePersonalizationItems[0]?.key ?? null);
    const nextSelectedId = focusIsValid
      ? personalizationFocusId
      : (selectableKeys.has(selectedPrintId) ? selectedPrintId : null);

    if (nextActiveId !== activePrintId) setActivePrintId(nextActiveId);
    const missingSelectedId = selectedPrintId && !selectableKeys.has(selectedPrintId)
      ? selectedPrintId
      : null;
    const invalidSelectionId = invalidFocusId ?? missingSelectedId;
    const nullReportKey = invalidSelectionId ? `invalid:${invalidSelectionId}` : null;
    if (nextSelectedId === selectedPrintId) {
      if (nextSelectedId !== null) reportedNullSelectionRef.current = null;
      if (nullReportKey && reportedNullSelectionRef.current !== nullReportKey) {
        reportedNullSelectionRef.current = nullReportKey;
        onPersonalizationSelect?.(null);
      }
      return;
    }

    setSelectedPrintId(nextSelectedId);
    if (nextSelectedId !== null) {
      reportedNullSelectionRef.current = null;
      return;
    }
    setPrintAnchor({ visible: false });
    if (nullReportKey && reportedNullSelectionRef.current !== nullReportKey) {
      reportedNullSelectionRef.current = nullReportKey;
      onPersonalizationSelect?.(null);
    }
  }, [
    activePrintId,
    onPersonalizationSelect,
    personalizationFocusId,
    selectableKeys,
    selectablePersonalizationItems,
    selectedPrintId,
  ]);

  const patchPrint = (id, patch) => {
    const item = findPersonalizationItem(selectablePersonalizationItems, id);
    if (!item) return;
    if (item.itemKind === 'text') {
      onStatePatch({ overrides: { customTextItems: patchCustomTextItem(customTextItems, item.sourceId, patch) } });
      return;
    }
    const nextItems = patchPrintItem(printItems, item.sourceId, patch);
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
          deleteDisabled={deletePending}
          item={findPersonalizationItem(renderablePersonalizationItems, selectedPrintId)}
          onCopy={(id) => {
            const item = findPersonalizationItem(selectablePersonalizationItems, id);
            if (!item) return;
            const placement = getNextPrintPlacement(
              PERSONALIZATION_COPY_CANDIDATES,
              selectablePersonalizationItems.map((entry) => entry.placement).filter(Boolean),
            );
            const copy = item.itemKind === 'text'
              ? duplicateCustomTextItem(customTextItems, item.sourceId, placement)
              : duplicatePrintItem(printItems, item.sourceId, placement);
            if (!copy) return;
            if (item.itemKind === 'text') {
              onStatePatch({ overrides: { customTextItems: [...customTextItems, copy] } });
            } else {
              const nextItems = [...printItems, copy];
              onStatePatch({ overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) } });
            }
            const copyKey = makePersonalizationKey(item.itemKind, copy.id);
            setActivePrintId(copyKey);
            setSelectedPrintId(copyKey);
            onPersonalizationSelect?.(copyKey);
          }}
          onDelete={onDeletePersonalization}
          onEdit={(id) => onEditPersonalization?.(id)}
          onRotate={(id, rotation) => patchPrint(id, { rotation })}
          onScale={(id, scale) => patchPrint(id, { scale })}
        />
      </div>
      <div className="stage-caption">
        <strong>{selected.layout?.label}</strong>
        <span>{templateLabel} / {selected.material?.shortLabel}</span>
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
