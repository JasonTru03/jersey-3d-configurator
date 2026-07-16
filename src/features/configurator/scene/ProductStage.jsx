import { Rotate3D, SlidersHorizontal, ZoomIn } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { GarmentRenderer } from './garmentRenderer.js';
import { KeyboardRenderer } from './keyboardRenderer.js';
import { PrintToolbarOverlay } from './PrintToolbarOverlay.jsx';
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

export function ProductStage({ onEditPrint, onStatePatch, product, state, selected }) {
  const hostRef = useRef(null);
  const rendererRef = useRef(null);
  const [view, setView] = useState('orbit');
  const printItems = state?.lighting && state.lighting !== 'none' ? getPrintItems(state.overrides) : [];
  const [activePrintId, setActivePrintId] = useState(null);
  const [printAnchor, setPrintAnchor] = useState({ visible: false });

  useEffect(() => {
    setActivePrintId((current) => printItems.some((item) => item.id === current) ? current : printItems[0]?.id ?? null);
  }, [state]);

  const patchPrint = (id, patch) => {
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
        onPrintSelectionChange: setActivePrintId,
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
    rendererRef.current?.setActivePrintId(activePrintId);
  }, [activePrintId]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.onStatePatch = onStatePatch;
      rendererRef.current.onPrintAnchorChange = setPrintAnchor;
      rendererRef.current.onPrintSelectionChange = setActivePrintId;
    }
  }, [onStatePatch]);

  useEffect(() => {
    rendererRef.current?.setView(view);
  }, [view]);

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
        <PrintToolbarOverlay
          anchor={printAnchor}
          item={printItems.find((item) => item.id === activePrintId)}
          onCopy={(id) => {
            const placement = getNextPrintPlacement(printCopyCandidates, printItems.map((item) => item.placement).filter(Boolean));
            const copy = duplicatePrintItem(printItems, id, placement);
            if (!copy) return;
            const nextItems = [...printItems, copy];
            onStatePatch({ overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) } });
            setActivePrintId(copy.id);
          }}
          onDelete={(id) => {
            const nextItems = removePrintItem(printItems, id);
            setActivePrintId(null);
            setPrintAnchor({ visible: false });
            onStatePatch({ overrides: { printItems: nextItems, ...legacyFirstItemFields(nextItems) } });
          }}
          onEdit={(id) => onEditPrint?.(id)}
          onRotate={(id, degrees) => patchPrint(id, { rotation: (printItems.find((item) => item.id === id)?.rotation ?? 0) + degrees })}
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
