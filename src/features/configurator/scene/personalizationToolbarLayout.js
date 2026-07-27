const CONTROL_SIZE = 44;
const CONTROL_GAP = 4;
const CONTROL_COUNT = 3;
const DOCK_EDGE_GAP = 8;
const ROTATE_HANDLE_OFFSET = 62;

export function getPersonalizationDockLayout(candidate, anchor, stageArea) {
  if (!stageArea) {
    return {
      columns: CONTROL_COUNT,
      left: candidate.left,
      top: Math.max(DOCK_EDGE_GAP, candidate.top),
    };
  }

  const availableWidth = Math.max(0, stageArea.width - DOCK_EDGE_GAP * 2);
  const fullWidth = getGridSize(CONTROL_COUNT);
  const doubleWidth = getGridSize(2);
  const columns = availableWidth >= fullWidth
    ? CONTROL_COUNT
    : (availableWidth >= doubleWidth ? 2 : 1);
  const rows = Math.ceil(CONTROL_COUNT / columns);
  const width = getGridSize(columns);
  const height = getGridSize(rows);
  const halfWidth = width / 2;
  const hasHorizontalMargins = stageArea.width >= width + DOCK_EDGE_GAP * 2;
  const minLeft = hasHorizontalMargins ? DOCK_EDGE_GAP + halfWidth : stageArea.width / 2;
  const maxLeft = hasHorizontalMargins
    ? stageArea.width - DOCK_EDGE_GAP - halfWidth
    : stageArea.width / 2;
  const left = clamp(candidate.left, minLeft, maxLeft);
  const maxTop = Math.max(DOCK_EDGE_GAP, stageArea.height - DOCK_EDGE_GAP - height);
  let top = clamp(candidate.top, DOCK_EDGE_GAP, maxTop);

  if (stageArea.obstacle && rectanglesIntersect(
    { left: left - halfWidth, right: left + halfWidth, top, bottom: top + height },
    stageArea.obstacle,
  )) {
    const clearTop = Math.max(
      stageArea.obstacle.bottom + DOCK_EDGE_GAP,
      anchor.top + anchor.height + DOCK_EDGE_GAP,
    );
    top = clamp(clearTop, DOCK_EDGE_GAP, maxTop);
  }

  return { columns, left, top };
}

export function getPersonalizationRotateHandleLayout(anchor, stageArea) {
  const candidate = {
    left: anchor.left + anchor.width,
    top: anchor.top - ROTATE_HANDLE_OFFSET,
  };
  if (!stageArea) {
    return {
      left: candidate.left,
      top: Math.max(DOCK_EDGE_GAP, candidate.top),
    };
  }

  const halfSize = CONTROL_SIZE / 2;
  const left = clamp(
    candidate.left,
    DOCK_EDGE_GAP + halfSize,
    Math.max(DOCK_EDGE_GAP + halfSize, stageArea.width - DOCK_EDGE_GAP - halfSize),
  );
  const maxTop = Math.max(DOCK_EDGE_GAP, stageArea.height - DOCK_EDGE_GAP - CONTROL_SIZE);
  let top = clamp(candidate.top, DOCK_EDGE_GAP, maxTop);

  if (stageArea.obstacle && rectanglesIntersect(
    {
      bottom: top + CONTROL_SIZE,
      left: left - halfSize,
      right: left + halfSize,
      top,
    },
    stageArea.obstacle,
  )) {
    top = clamp(
      Math.max(stageArea.obstacle.bottom + DOCK_EDGE_GAP, anchor.top + anchor.height + DOCK_EDGE_GAP),
      DOCK_EDGE_GAP,
      maxTop,
    );
  }

  return { left, top };
}

export function measurePersonalizationStageArea(overlay) {
  const overlayRect = overlay.getBoundingClientRect();
  if (!(overlayRect.width > 0) || !(overlayRect.height > 0)) return null;
  const toolbar = overlay.closest('.stage-wrap')?.querySelector('.stage-toolbar');
  const toolbarRect = toolbar?.getBoundingClientRect();
  const obstacle = toolbarRect?.width > 0 && toolbarRect?.height > 0
    ? {
        bottom: toolbarRect.bottom - overlayRect.top,
        left: toolbarRect.left - overlayRect.left,
        right: toolbarRect.right - overlayRect.left,
        top: toolbarRect.top - overlayRect.top,
      }
    : null;
  return {
    height: overlayRect.height,
    obstacle,
    width: overlayRect.width,
  };
}

export function personalizationStageAreasEqual(first, second) {
  if (first === second) return true;
  if (!first || !second) return false;
  return first.width === second.width
    && first.height === second.height
    && first.obstacle?.left === second.obstacle?.left
    && first.obstacle?.right === second.obstacle?.right
    && first.obstacle?.top === second.obstacle?.top
    && first.obstacle?.bottom === second.obstacle?.bottom;
}

function getGridSize(count) {
  return count * CONTROL_SIZE + (count - 1) * CONTROL_GAP;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rectanglesIntersect(first, second) {
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}
