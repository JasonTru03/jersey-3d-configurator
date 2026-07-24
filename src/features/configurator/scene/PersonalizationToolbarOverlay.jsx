import { Maximize2, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  beginRotationGesture,
  normalizeRotation,
  updateRotationGesture,
} from './personalizationRotation.js';

const MIN_PRINT_SCALE = 0.45;
const MAX_PRINT_SCALE = 2.5;
const PRINT_RESIZE_DISTANCE = 96;
const KEYBOARD_ROTATION_STEP = 5;
const ROTATION_DRAG_THRESHOLD = 3;

function getDistanceFromCenter(centerX, centerY, clientX, clientY) {
  return Math.hypot(clientX - centerX, clientY - centerY);
}

function getResizeScale(start, clientX, clientY) {
  const distance = getDistanceFromCenter(start.centerX, start.centerY, clientX, clientY);
  return Math.min(MAX_PRINT_SCALE, Math.max(MIN_PRINT_SCALE, start.scale + (distance - start.distance) / PRINT_RESIZE_DISTANCE));
}

function getAnchorCenter(anchor) {
  return {
    centerX: anchor.left + anchor.width / 2,
    centerY: anchor.top + anchor.height / 2,
  };
}

function getDockPosition(anchor) {
  return {
    left: anchor.left + anchor.width / 2,
    top: anchor.top - 52,
  };
}

export function PersonalizationToolbarOverlay({ anchor, item, onCopy, onDelete, onEdit, onRotate, onScale }) {
  const resizeStart = useRef(null);
  const rotationStart = useRef(null);
  const [frozenDock, setFrozenDock] = useState(null);
  const [isRotating, setIsRotating] = useState(false);
  if (!item || !anchor?.visible) return null;
  const itemKey = item.key ?? item.id;
  const dockPosition = frozenDock ?? getDockPosition(anchor);

  const clearResize = (event) => {
    if (!resizeStart.current || resizeStart.current.pointerId === event.pointerId) resizeStart.current = null;
  };

  const startResize = (event) => {
    if (!onScale) return;
    const { centerX, centerY } = getAnchorCenter(anchor);
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
    onScale(itemKey, getResizeScale(start, event.clientX, event.clientY));
  };

  const clearRotation = (event) => {
    const start = rotationStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    rotationStart.current = null;
    setFrozenDock(null);
    setIsRotating(false);
  };

  const startRotation = (event) => {
    const { centerX, centerY } = getAnchorCenter(anchor);
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    rotationStart.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      gesture: beginRotationGesture({
        centerX,
        centerY,
        clientX: event.clientX,
        clientY: event.clientY,
        rotation: item.rotation ?? 0,
      }),
      hasMoved: false,
    };
    setFrozenDock(getDockPosition(anchor));
    setIsRotating(true);
  };

  const rotate = (event) => {
    const start = rotationStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    const hasMoved = start.hasMoved || Math.hypot(
      event.clientX - start.startClientX,
      event.clientY - start.startClientY,
    ) >= ROTATION_DRAG_THRESHOLD;
    if (!hasMoved) return;

    const gesture = updateRotationGesture(start.gesture, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
    rotationStart.current = { ...start, gesture, hasMoved };
    onRotate?.(itemKey, gesture.rotation);
  };

  const rotateWithKeyboard = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? -1 : 1;
    onRotate?.(itemKey, normalizeRotation((item.rotation ?? 0) + direction * KEYBOARD_ROTATION_STEP));
  };

  return (
    <div
      aria-label="Selected personalization controls"
      className="print-toolbar-overlay"
      role="group"
      style={{
        '--print-left': `${anchor.left}px`,
        '--print-top': `${anchor.top}px`,
        '--print-width': `${anchor.width}px`,
        '--print-height': `${anchor.height}px`,
        '--print-dock-left': `${dockPosition.left}px`,
        '--print-dock-top': `${dockPosition.top}px`,
      }}
    >
      <div className="print-selection-frame" data-testid="print-selection-frame" />
      <div className="print-control-dock" data-testid="print-control-dock">
        <button aria-label="Edit personalization" className="print-control print-control--edit" onClick={() => onEdit?.(itemKey)} type="button"><Pencil size={15} /></button>
        <button
          aria-label="Drag to rotate personalization"
          className={`print-control print-control--rotate${isRotating ? ' is-dragging' : ''}`}
          onKeyDown={rotateWithKeyboard}
          onLostPointerCapture={clearRotation}
          onPointerCancel={clearRotation}
          onPointerDown={startRotation}
          onPointerMove={rotate}
          onPointerUp={clearRotation}
          type="button"
        ><RotateCw size={15} /></button>
        <button aria-label="Duplicate personalization" className="print-control print-control--duplicate" onClick={() => onCopy?.(itemKey)} type="button">×2</button>
        <button aria-label="Delete personalization" className="print-control print-control--delete" onClick={() => onDelete?.(itemKey)} type="button"><Trash2 size={15} /></button>
      </div>
      <button
        aria-label="Resize personalization"
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
