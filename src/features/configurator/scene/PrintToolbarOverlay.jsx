import { Copy, Maximize2, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { useRef } from 'react';

export function PrintToolbarOverlay({ item, onCopy, onDelete, onEdit, onRotate, onScale }) {
  const dragStart = useRef(null);
  if (!item) return null;

  return (
    <div className="print-toolbar-overlay" role="group" aria-label="Selected print controls">
      <button aria-label="Edit print" onClick={() => onEdit(item.id)} type="button"><Pencil size={15} /></button>
      <button aria-label="Rotate print right" onClick={() => onRotate(item.id, 15)} type="button"><RotateCw size={15} /></button>
      <button aria-label="Delete print" onClick={() => onDelete(item.id)} type="button"><Trash2 size={15} /></button>
      <button aria-label="Duplicate print" onClick={() => onCopy(item.id)} type="button"><Copy size={15} /></button>
      <button
        aria-label="Resize print"
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
