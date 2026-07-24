import { Maximize2, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  beginRotationGesture,
  normalizeRotation,
  updateRotationGesture,
} from './personalizationRotation.js';
import {
  getPersonalizationDockLayout,
  measurePersonalizationStageArea,
  personalizationStageAreasEqual,
} from './personalizationToolbarLayout.js';

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

function releaseGesturePointer(start) {
  const target = start?.target;
  if (!target?.releasePointerCapture) return;
  if (target.hasPointerCapture && !target.hasPointerCapture(start.pointerId)) return;
  target.releasePointerCapture(start.pointerId);
}

export function PersonalizationToolbarOverlay({
  anchor,
  deleteDisabled = false,
  item,
  onCopy,
  onDelete,
  onEdit,
  onRotate,
  onRotationPreview,
  onRotationGestureCancel,
  onRotationGestureEnd,
  onRotationGestureStart,
  onResizeGestureCancel,
  onResizeGestureEnd,
  onResizeGestureStart,
  onScale,
  onScalePreview,
  personalizationMutationDisabled,
}) {
  const mutationDisabled = personalizationMutationDisabled ?? deleteDisabled;
  const overlayRef = useRef(null);
  const deleteFocusRef = useRef(null);
  const resizeStart = useRef(null);
  const rotationStart = useRef(null);
  const rotationGestureEndRef = useRef(onRotationGestureEnd);
  const rotationGestureCancelRef = useRef(onRotationGestureCancel);
  const resizeGestureCancelRef = useRef(onResizeGestureCancel);
  rotationGestureEndRef.current = onRotationGestureEnd;
  rotationGestureCancelRef.current = onRotationGestureCancel;
  resizeGestureCancelRef.current = onResizeGestureCancel;
  const [stageArea, setStageArea] = useState(null);
  const [frozenDockLayout, setFrozenDockLayout] = useState(null);
  const [isRotating, setIsRotating] = useState(false);
  const itemKey = item?.key ?? item?.id ?? null;
  const anchorVisible = Boolean(anchor?.visible);

  useEffect(() => () => {
    const rotation = rotationStart.current;
    const resizeGesture = resizeStart.current;
    rotationStart.current = null;
    resizeStart.current = null;
    if (rotation) {
      rotationGestureCancelRef.current?.(rotation.itemKey);
    }
    if (resizeGesture) {
      resizeGestureCancelRef.current?.(resizeGesture.itemKey);
    }
    releaseGesturePointer(rotation);
    releaseGesturePointer(resizeGesture);
    setFrozenDockLayout(null);
    setIsRotating(false);
  }, [anchorVisible, itemKey, mutationDisabled]);

  useEffect(() => {
    const pending = deleteFocusRef.current;
    if (mutationDisabled || !pending?.failed || typeof document === 'undefined') return;
    deleteFocusRef.current = null;
    const activeElement = document.activeElement;
    if (
      pending.hadFocus
      && pending.trigger.isConnected
      && (activeElement === pending.trigger || activeElement === document.body)
    ) {
      pending.trigger.focus();
    }
  }, [mutationDisabled]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!anchorVisible || !overlay) {
      setStageArea((current) => (current === null ? current : null));
      return undefined;
    }

    const updateStageArea = () => {
      const next = measurePersonalizationStageArea(overlay);
      setStageArea((current) => (personalizationStageAreasEqual(current, next) ? current : next));
    };
    updateStageArea();

    const toolbar = overlay.closest('.stage-wrap')?.querySelector('.stage-toolbar');
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateStageArea);
    resizeObserver?.observe(overlay);
    if (toolbar) resizeObserver?.observe(toolbar);
    window.addEventListener('resize', updateStageArea);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateStageArea);
    };
  }, [anchorVisible, itemKey]);

  if (!item || !anchorVisible) return null;
  const dockPosition = getDockPosition(anchor);
  const dockLayout = frozenDockLayout
    ?? getPersonalizationDockLayout(dockPosition, anchor, stageArea);

  const finishResize = (event, mode) => {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    let finalStart = start;
    if (mode === 'commit') {
      const scale = getResizeScale(start, event.clientX, event.clientY);
      finalStart = {
        ...start,
        hasMoved: start.hasMoved || Math.abs(scale - start.scale) > 0.000001,
        latestScale: scale,
      };
      if (finalStart.hasMoved) onScalePreview?.(start.itemKey, scale);
    }
    resizeStart.current = null;
    releaseGesturePointer(finalStart);
    if (mode === 'commit' && finalStart.hasMoved) {
      onResizeGestureEnd?.(finalStart.itemKey, finalStart.latestScale);
    } else {
      onResizeGestureCancel?.(finalStart.itemKey);
    }
  };

  const startResize = (event) => {
    if (mutationDisabled || (!onScalePreview && !onScale) || resizeStart.current || rotationStart.current) return;
    const { centerX, centerY } = getAnchorCenter(anchor);
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeStart.current = {
      itemKey,
      pointerId: event.pointerId,
      target: event.currentTarget,
      scale: item.scale ?? 1,
      centerX,
      centerY,
      distance: getDistanceFromCenter(centerX, centerY, event.clientX, event.clientY),
      hasMoved: false,
      latestScale: item.scale ?? 1,
    };
    onResizeGestureStart?.(itemKey);
  };

  const resize = (event) => {
    const start = resizeStart.current;
    if (
      mutationDisabled
      || !start
      || start.pointerId !== event.pointerId
      || start.itemKey !== itemKey
      || (!onScalePreview && !onScale)
    ) return;
    event.preventDefault();
    const scale = getResizeScale(start, event.clientX, event.clientY);
    resizeStart.current = {
      ...start,
      hasMoved: start.hasMoved || Math.abs(scale - start.scale) > 0.000001,
      latestScale: scale,
    };
    (onScalePreview ?? onScale)?.(start.itemKey, scale);
  };

  const applyRotationPoint = (event) => {
    const start = rotationStart.current;
    if (
      mutationDisabled
      || !start
      || start.pointerId !== event.pointerId
      || start.itemKey !== itemKey
      || (start.lastClientX === event.clientX && start.lastClientY === event.clientY)
    ) return;

    event.preventDefault();
    const hasMoved = start.hasMoved || Math.hypot(
      event.clientX - start.startClientX,
      event.clientY - start.startClientY,
    ) >= ROTATION_DRAG_THRESHOLD;
    const nextStart = {
      ...start,
      hasMoved,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    if (!hasMoved) {
      rotationStart.current = nextStart;
      return;
    }

    const gesture = updateRotationGesture(start.gesture, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
    rotationStart.current = { ...nextStart, gesture };
    (onRotationPreview ?? onRotate)?.(start.itemKey, gesture.rotation);
  };

  const finishRotation = (event, mode) => {
    const start = rotationStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (mode === 'commit') applyRotationPoint(event);
    const finalStart = rotationStart.current ?? start;
    rotationStart.current = null;
    releaseGesturePointer(finalStart);
    if (mode === 'commit' && finalStart.hasMoved) {
      onRotationGestureEnd?.(finalStart.itemKey, finalStart.gesture.rotation);
    } else {
      onRotationGestureCancel?.(finalStart.itemKey);
    }
    setFrozenDockLayout(null);
    setIsRotating(false);
  };

  const startRotation = (event) => {
    if (mutationDisabled || rotationStart.current || resizeStart.current) return;
    const { centerX, centerY } = getAnchorCenter(anchor);
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    rotationStart.current = {
      itemKey,
      pointerId: event.pointerId,
      target: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      gesture: beginRotationGesture({
        centerX,
        centerY,
        clientX: event.clientX,
        clientY: event.clientY,
        rotation: item.rotation ?? 0,
      }),
      hasMoved: false,
    };
    onRotationGestureStart?.(itemKey);
    setFrozenDockLayout(dockLayout);
    setIsRotating(true);
  };

  const rotate = (event) => {
    applyRotationPoint(event);
  };

  const rotateWithKeyboard = (event) => {
    if (mutationDisabled || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? -1 : 1;
    onRotate?.(itemKey, normalizeRotation((item.rotation ?? 0) + direction * KEYBOARD_ROTATION_STEP));
  };

  const deleteItem = (event) => {
    const trigger = event.currentTarget;
    const pendingFocus = {
      failed: false,
      hadFocus: typeof document !== 'undefined' && document.activeElement === trigger,
      stableTarget: overlayRef.current
        ?.closest('.stage-wrap')
        ?.querySelector('.stage-toolbar button'),
      trigger,
    };
    onDelete?.(itemKey, {
      onFailure: () => {
        pendingFocus.failed = true;
      },
      onStart: () => {
        deleteFocusRef.current = pendingFocus;
      },
      onSuccess: () => {
        setTimeout(() => {
          if (typeof document === 'undefined') return;
          const activeElement = document.activeElement;
          if (
            pendingFocus.stableTarget?.isConnected
            && (
              activeElement === pendingFocus.trigger
              || activeElement === document.body
            )
          ) {
            pendingFocus.stableTarget.focus();
          }
        }, 0);
      },
    });
  };

  return (
    <div
      aria-label="Selected personalization controls"
      className="print-toolbar-overlay"
      ref={overlayRef}
      role="group"
      style={{
        '--print-left': `${anchor.left}px`,
        '--print-top': `${anchor.top}px`,
        '--print-width': `${anchor.width}px`,
        '--print-height': `${anchor.height}px`,
      }}
    >
      <div className="print-selection-frame" data-testid="print-selection-frame" />
      <div
        className="print-control-dock"
        data-testid="print-control-dock"
        style={{
          '--print-dock-columns': dockLayout.columns,
          '--print-dock-position-left': `${dockLayout.left}px`,
          '--print-dock-position-top': `${dockLayout.top}px`,
        }}
      >
        <button aria-label="Edit personalization" className="print-control print-control--edit" disabled={mutationDisabled} onClick={() => onEdit?.(itemKey)} type="button"><Pencil size={15} /></button>
        <button
          aria-label="Drag to rotate personalization"
          className={`print-control print-control--rotate${isRotating ? ' is-dragging' : ''}`}
          disabled={mutationDisabled}
          onKeyDown={rotateWithKeyboard}
          onLostPointerCapture={(event) => finishRotation(event, 'cancel')}
          onPointerCancel={(event) => finishRotation(event, 'cancel')}
          onPointerDown={startRotation}
          onPointerMove={rotate}
          onPointerUp={(event) => finishRotation(event, 'commit')}
          type="button"
        ><RotateCw size={15} /></button>
        <button aria-label="Duplicate personalization" className="print-control print-control--duplicate" disabled={mutationDisabled} onClick={() => onCopy?.(itemKey)} type="button">×2</button>
        <button aria-label="Delete personalization" className="print-control print-control--delete" disabled={mutationDisabled} onClick={deleteItem} type="button"><Trash2 size={15} /></button>
      </div>
      <button
        aria-label="Resize personalization"
        className="print-control print-control--resize"
        disabled={mutationDisabled}
        onLostPointerCapture={(event) => finishResize(event, 'cancel')}
        onPointerCancel={(event) => finishResize(event, 'cancel')}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={(event) => finishResize(event, 'commit')}
        type="button"
      ><Maximize2 size={15} /></button>
    </div>
  );
}
