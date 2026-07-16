import { Maximize2, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { useRef } from 'react';

const MIN_PRINT_SCALE = 0.45;
const MAX_PRINT_SCALE = 2.5;

function getDistanceFromCenter(centerX, centerY, clientX, clientY) {
  return Math.hypot(clientX - centerX, clientY - centerY);
}

function getResizeScale(start, clientX, clientY) {
  const distance = getDistanceFromCenter(start.centerX, start.centerY, clientX, clientY);
  return Math.min(MAX_PRINT_SCALE, Math.max(MIN_PRINT_SCALE, start.scale + (distance - start.distance) / 160));
}

export function PrintToolbarOverlay({ anchor, item, onCopy, onDelete, onEdit, onRotate, onScale }) {
  const dragStart = useRef(null);
  if (!item || !anchor?.visible) return null;

  const clearResize = (event) => {
    if (!dragStart.current || dragStart.current.pointerId === event.pointerId) dragStart.current = null;
  };

  const startResize = (event) => {
    if (!onScale) return;
    const centerX = anchor.left + anchor.width / 2;
    const centerY = anchor.top + anchor.height / 2;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStart.current = {
      pointerId: event.pointerId,
      scale: item.scale ?? 1,
      centerX,
      centerY,
      distance: getDistanceFromCenter(centerX, centerY, event.clientX, event.clientY),
    };
  };

  const resize = (event) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId || !onScale) return;
    event.preventDefault();
    onScale(item.id, getResizeScale(start, event.clientX, event.clientY));
  };

  return (
    <div
      aria-label="Selected print controls"
      className="print-toolbar-overlay"
      role="group"
      style={{
        '--print-left': `${anchor.left}px`,
        '--print-top': `${anchor.top}px`,
        '--print-width': `${anchor.width}px`,
        '--print-height': `${anchor.height}px`,
      }}
    >
      <div className="print-selection-frame" data-testid="print-selection-frame" />
      <button aria-label="Edit print" className="print-control print-control--edit" onClick={() => onEdit(item.id)} type="button"><Pencil size={15} /></button>
      <button aria-label="Rotate print right" className="print-control print-control--rotate" onClick={() => onRotate(item.id, 15)} type="button"><RotateCw size={15} /></button>
      <button aria-label="Delete print" className="print-control print-control--delete" onClick={() => onDelete(item.id)} type="button"><Trash2 size={15} /></button>
      <button aria-label="Duplicate print" className="print-control print-control--duplicate" onClick={() => onCopy(item.id)} type="button">×2</button>
      <button
        aria-label="Resize print"
        className="print-control print-control--resize"
        onLostPointerCapture={clearResize}
        onPointerCancel={clearResize}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={clearResize}
        type="button"
      ><Maximize2 size={15} /></button>
    </div>
  );
}
