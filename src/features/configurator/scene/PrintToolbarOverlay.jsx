import { Maximize2, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { useRef } from 'react';

const MIN_PRINT_SCALE = 0.45;
const MAX_PRINT_SCALE = 2.5;
const PRINT_RESIZE_DISTANCE = 96;
const ROTATION_CENTER_PROTECTION_RADIUS = 32;
const ROTATION_DEGREES_PER_PIXEL = 0.5;
const MAX_ROTATION_DELTA = 24;

function getDistanceFromCenter(centerX, centerY, clientX, clientY) {
  return Math.hypot(clientX - centerX, clientY - centerY);
}

function getResizeScale(start, clientX, clientY) {
  const distance = getDistanceFromCenter(start.centerX, start.centerY, clientX, clientY);
  return Math.min(MAX_PRINT_SCALE, Math.max(MIN_PRINT_SCALE, start.scale + (distance - start.distance) / PRINT_RESIZE_DISTANCE));
}

function normalizePrintRotation(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function getRadialDirection(centerX, centerY, clientX, clientY) {
  const x = clientX - centerX;
  const y = clientY - centerY;
  const distance = Math.hypot(x, y);
  if (distance < ROTATION_CENTER_PROTECTION_RADIUS) return null;
  return { x: x / distance, y: y / distance };
}

function getClockwiseTangent(direction) {
  return { x: -direction.y, y: direction.x };
}

function clampRotationDelta(delta) {
  return Math.min(MAX_ROTATION_DELTA, Math.max(-MAX_ROTATION_DELTA, delta));
}

export function PrintToolbarOverlay({ anchor, item, onCopy, onDelete, onEdit, onRotate, onScale }) {
  const resizeStart = useRef(null);
  const rotationStart = useRef(null);
  if (!item || !anchor?.visible) return null;

  const clearResize = (event) => {
    if (!resizeStart.current || resizeStart.current.pointerId === event.pointerId) resizeStart.current = null;
  };

  const startResize = (event) => {
    if (!onScale) return;
    const centerX = anchor.left + anchor.width / 2;
    const centerY = anchor.top + anchor.height / 2;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeStart.current = {
      pointerId: event.pointerId,
      scale: item.scale ?? 1,
      centerX,
      centerY,
      distance: getDistanceFromCenter(centerX, centerY, event.clientX, event.clientY),
    };
  };

  const resize = (event) => {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId || !onScale) return;
    event.preventDefault();
    onScale(item.id, getResizeScale(start, event.clientX, event.clientY));
  };

  const clearRotation = (event) => {
    if (!rotationStart.current || rotationStart.current.pointerId === event.pointerId) rotationStart.current = null;
  };

  const startRotation = (event) => {
    if (!onRotate) return;
    const centerX = anchor.left + anchor.width / 2;
    const centerY = anchor.top + anchor.height / 2;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const radialDirection = getRadialDirection(centerX, centerY, event.clientX, event.clientY) ?? { x: 1, y: 0 };
    rotationStart.current = {
      pointerId: event.pointerId,
      centerX,
      centerY,
      lastX: event.clientX,
      lastY: event.clientY,
      radialDirection,
      rotation: normalizePrintRotation(item.rotation ?? 0),
    };
  };

  const rotate = (event) => {
    const start = rotationStart.current;
    if (!start || start.pointerId !== event.pointerId || !onRotate) return;
    event.preventDefault();
    const dx = event.clientX - start.lastX;
    const dy = event.clientY - start.lastY;
    const tangent = getClockwiseTangent(start.radialDirection);
    const delta = clampRotationDelta((dx * tangent.x + dy * tangent.y) * ROTATION_DEGREES_PER_PIXEL);
    const rotation = normalizePrintRotation(start.rotation - delta);
    const radialDirection = getRadialDirection(start.centerX, start.centerY, event.clientX, event.clientY) ?? start.radialDirection;
    rotationStart.current = { ...start, lastX: event.clientX, lastY: event.clientY, radialDirection, rotation };
    onRotate(item.id, rotation);
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
      <button
        aria-label="Rotate print"
        className="print-control print-control--rotate"
        onLostPointerCapture={clearRotation}
        onPointerCancel={clearRotation}
        onPointerDown={startRotation}
        onPointerMove={rotate}
        onPointerUp={clearRotation}
        type="button"
      ><RotateCw size={15} /></button>
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
