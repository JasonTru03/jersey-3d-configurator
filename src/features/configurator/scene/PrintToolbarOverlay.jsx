import { Maximize2, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { useRef } from 'react';

export function PrintToolbarOverlay({ anchor, item, onCopy, onDelete, onEdit, onRotate, onScale }) {
  const dragStart = useRef(null);
  if (!item || !anchor?.visible) return null;

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
        onPointerDown={(event) => { dragStart.current = { scale: item.scale, x: event.clientX, y: event.clientY }; }}
        onPointerMove={(event) => {
          if (!dragStart.current || !onScale) return;
          const distance = Math.hypot(event.clientX - dragStart.current.x, event.clientY - dragStart.current.y);
          onScale(item.id, dragStart.current.scale + distance / 160);
        }}
        onPointerUp={() => { dragStart.current = null; }}
        type="button"
      ><Maximize2 size={15} /></button>
    </div>
  );
}
