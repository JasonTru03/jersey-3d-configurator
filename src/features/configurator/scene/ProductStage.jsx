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
  onProductionProvider,
  onDeletePersonalization,
  onEditPersonalization,
  onPersonalizationSelect,
  onRendererError,
  onStatePatch,
  personalizationFocusId,
  personalizationMutationDisabled = false,
  personalizationSideFocus,
  product,
  state,
  selected,
}) {
  const hostRef = useRef(null);
  const rendererRef = useRef(null);
  const mountedRef = useRef(false);
  const copyTokenRef = useRef(0);
  const selectionIntentRef = useRef(null);
  const reportedNullSelectionRef = useRef(null);
  const reconciliationInputRef = useRef({ focusId: Symbol('initial-focus'), keys: null });
  const [view, setView] = useState('orbit');
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
    selectionIntentRef.current = id;
    setActivePrintId(id);
    setSelectedPrintId(id);
    onPersonalizationSelect?.(id);
  }, [onPersonalizationSelect]);
  const handleStateNormalize = useCallback(
    (patch) => onStatePatch(patch, { quote: false, recordHistory: false }),
    [onStatePatch],
  );
  const reportRendererError = useCallback(
    (error) => onRendererError?.(error),
    [onRendererError],
  );
  const handleViewSelect = (nextView) => {
    if (nextView === view) {
      rendererRef.current?.setView(nextView);
      return;
    }
    setView(nextView);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

    selectionIntentRef.current = nextSelectedId;
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

  const patchPrint = (id, createPatch) => {
    if (personalizationMutationDisabled) return;
    if (!findPersonalizationItem(selectablePersonalizationItems, id)) return;
    return onStatePatch((latestState) => {
      const latestItem = findPersonalizationItem(
        getSelectablePersonalizationItems(latestState),
        id,
      );
      if (!latestItem) return {};
      const patch = typeof createPatch === 'function'
        ? createPatch(latestItem)
        : createPatch;
      if (latestItem.itemKind === 'text') {
        const latestItems = getCustomTextItems(latestState.overrides);
        return {
          overrides: {
            customTextItems: patchCustomTextItem(latestItems, latestItem.sourceId, patch),
          },
        };
      }
      const latestItems = getPrintItems(latestState.overrides);
      const nextItems = patchPrintItem(latestItems, latestItem.sourceId, patch);
      return {
        overrides: {
          printItems: nextItems,
          ...legacyFirstItemFields(nextItems),
        },
      };
    });
  };

  useEffect(() => {
    const Renderer = rendererRegistry[product.renderer];
    if (!hostRef.current || rendererRef.current || !Renderer) return;
    if (!canUseWebGl()) return;

    try {
      rendererRef.current = new Renderer(hostRef.current, {
        onError: reportRendererError,
        onPrintAnchorChange: setPrintAnchor,
        onPrintSelectionChange: handlePrintSelectionChange,
        onStatePatch,
        onStateNormalize: handleStateNormalize,
      });
      rendererRef.current.update(product, state, selected);
    } catch (error) {
      reportRendererError(error);
      console.error(error);
    }

    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [product.renderer]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.onStatePatch = onStatePatch;
    renderer.onStateNormalize = handleStateNormalize;
    renderer.onError = reportRendererError;
    renderer.onPrintAnchorChange = setPrintAnchor;
    renderer.onPrintSelectionChange = handlePrintSelectionChange;
    try {
      renderer.update(product, state, selected);
    } catch (error) {
      reportRendererError(error);
      console.error(error);
    }
  }, [
    handlePrintSelectionChange,
    handleStateNormalize,
    onStatePatch,
    product,
    reportRendererError,
    selected,
    state,
  ]);

  useEffect(() => {
    if (artworkFocusId) rendererRef.current?.focusDecoration(artworkFocusId);
  }, [artworkFocusId]);

  useEffect(() => {
    rendererRef.current?.setActivePrintId(activePrintId);
  }, [activePrintId]);

  useEffect(() => {
    rendererRef.current?.setPersonalizationMutationDisabled?.(personalizationMutationDisabled);
  }, [personalizationMutationDisabled]);

  useEffect(() => {
    rendererRef.current?.setView(view);
  }, [view]);

  useEffect(() => {
    const side = personalizationSideFocus?.side;
    if (side !== 'front' && side !== 'back') return;
    rendererRef.current?.setView(side);
  }, [personalizationSideFocus, product.renderer]);

  useEffect(() => {
    onProductionProvider?.((request) => (
      rendererRef.current?.prepareProductionArtifacts?.(request)
    ));
    return () => onProductionProvider?.(null);
  }, [onProductionProvider]);

  return (
    <section className="stage-wrap">
      <div className="stage-toolbar" aria-label="3D view tools">
        <button
          className={view === 'orbit' ? 'active' : ''}
          onClick={() => handleViewSelect('orbit')}
          title="Orbit view"
          type="button"
        >
          <Rotate3D size={17} />
        </button>
        <button
          className={view === 'top' ? 'active' : ''}
          onClick={() => handleViewSelect('top')}
          title="Top view"
          type="button"
        >
          <SlidersHorizontal size={17} />
        </button>
        <button
          className={view === 'detail' ? 'active' : ''}
          onClick={() => handleViewSelect('detail')}
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
          personalizationMutationDisabled={personalizationMutationDisabled}
          item={findPersonalizationItem(renderablePersonalizationItems, selectedPrintId)}
          onCopy={(id) => {
            if (personalizationMutationDisabled) return;
            if (!findPersonalizationItem(selectablePersonalizationItems, id)) return;
            const operationToken = ++copyTokenRef.current;
            let copyKey = null;
            void Promise.resolve(onStatePatch((latestState) => {
              const latestItems = getSelectablePersonalizationItems(latestState);
              const item = findPersonalizationItem(latestItems, id);
              if (!item) return {};
              const placement = getNextPrintPlacement(
                PERSONALIZATION_COPY_CANDIDATES,
                latestItems.map((entry) => entry.placement).filter(Boolean),
              );
              if (item.itemKind === 'text') {
                const textItems = getCustomTextItems(latestState.overrides);
                const copy = duplicateCustomTextItem(textItems, item.sourceId, placement);
                if (!copy) return {};
                copyKey = makePersonalizationKey(item.itemKind, copy.id);
                return { overrides: { customTextItems: [...textItems, copy] } };
              }
              const playerItems = getPrintItems(latestState.overrides);
              const copy = duplicatePrintItem(playerItems, item.sourceId, placement);
              if (!copy) return {};
              copyKey = makePersonalizationKey(item.itemKind, copy.id);
              const nextItems = [...playerItems, copy];
              return {
                overrides: {
                  printItems: nextItems,
                  ...legacyFirstItemFields(nextItems),
                },
              };
            })).then((result) => {
              if (
                result?.ok === false
                || !copyKey
                || !mountedRef.current
                || copyTokenRef.current !== operationToken
                || selectionIntentRef.current !== id
              ) return;
              selectionIntentRef.current = copyKey;
              setActivePrintId(copyKey);
              setSelectedPrintId(copyKey);
              onPersonalizationSelect?.(copyKey);
            });
          }}
          onDelete={onDeletePersonalization}
          onEdit={(id) => onEditPersonalization?.(id)}
          onRotate={(id, rotation) => {
            const currentItem = findPersonalizationItem(selectablePersonalizationItems, id);
            const rotationDelta = currentItem
              ? normalizeRotationDelta(rotation - (currentItem.rotation ?? 0))
              : 0;
            patchPrint(id, (latestItem) => {
              const nextItem = {
                ...latestItem,
                rotation: (latestItem.rotation ?? 0) + rotationDelta,
              };
              const finalItem = rendererRef.current?.constrainPersonalizationItem?.(
                id,
                nextItem,
              );
              return personalizationTransformPatch(finalItem, {
                rotation: nextItem.rotation,
              });
            });
          }}
          onRotationPreview={(id, rotation) => {
            rendererRef.current?.previewPersonalizationRotation?.(id, rotation);
          }}
          onRotationGestureCancel={() => {
            rendererRef.current?.cancelPersonalizationRotationPreview?.();
          }}
          onRotationGestureEnd={(id, rotation) => {
            const finalItem = rendererRef.current?.endPersonalizationRotation?.(id, rotation);
            patchPrint(id, personalizationTransformPatch(finalItem, { rotation }));
          }}
          onRotationGestureStart={(id) => {
            rendererRef.current?.beginPersonalizationRotation?.(id);
          }}
          onResizeGestureCancel={(id) => {
            rendererRef.current?.cancelPersonalizationResizePreview?.(id);
          }}
          onResizeGestureEnd={(id, scale) => {
            const finalItem = rendererRef.current?.endPersonalizationResize?.(id, scale);
            patchPrint(id, personalizationTransformPatch(finalItem, { scale }));
          }}
          onResizeGestureStart={(id) => {
            rendererRef.current?.beginPersonalizationResize?.(id);
          }}
          onScale={(id, scale) => patchPrint(id, { scale })}
          onScalePreview={(id, scale) => {
            rendererRef.current?.previewPersonalizationScale?.(id, scale);
          }}
        />
      </div>
      <div className="stage-caption">
        <strong>{selected.layout?.label}</strong>
        <span>{templateLabel} / {selected.material?.shortLabel}</span>
      </div>
    </section>
  );
}

function personalizationTransformPatch(item, fallback) {
  if (!item) return fallback;
  return {
    placement: item.placement,
    rotation: item.rotation,
    scale: item.scale,
  };
}

function normalizeRotationDelta(value) {
  return ((Number(value) + 180) % 360 + 360) % 360 - 180;
}

function BoxIcon() {
  return <span aria-hidden="true">3D</span>;
}

function canUseWebGl() {
  return typeof window !== 'undefined' && typeof window.WebGLRenderingContext !== 'undefined';
}
