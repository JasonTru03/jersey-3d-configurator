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

export function getPersonalizationRotateHandleLayout(anchor, stageArea, dockRect = null) {
  const preferred = {
    left: anchor.left + anchor.width,
    top: anchor.top - ROTATE_HANDLE_OFFSET,
  };
  const candidates = dockRect
    ? [
        preferred,
        {
          left: dockRect.right + DOCK_EDGE_GAP + CONTROL_SIZE / 2,
          top: dockRect.top,
        },
        {
          left: dockRect.left - DOCK_EDGE_GAP - CONTROL_SIZE / 2,
          top: dockRect.top,
        },
        {
          left: anchor.left + anchor.width,
          top: dockRect.bottom + DOCK_EDGE_GAP,
        },
      ]
    : [preferred];
  const resolveCandidate = (candidate) => {
    if (!stageArea) {
      return {
        left: candidate.left,
        top: Math.max(DOCK_EDGE_GAP, candidate.top),
      };
    }

    const halfSize = CONTROL_SIZE / 2;
    return {
      left: clamp(
        candidate.left,
        DOCK_EDGE_GAP + halfSize,
        Math.max(DOCK_EDGE_GAP + halfSize, stageArea.width - DOCK_EDGE_GAP - halfSize),
      ),
      top: clamp(
        candidate.top,
        DOCK_EDGE_GAP,
        Math.max(DOCK_EDGE_GAP, stageArea.height - DOCK_EDGE_GAP - CONTROL_SIZE),
      ),
    };
  };
  const resolved = candidates.map(resolveCandidate);
  const isClearCandidate = (layout) => {
    const rectangle = getControlRect(layout);
    return (!stageArea || rectangleIsInsideStage(rectangle, stageArea))
      && (!dockRect || rectanglesHaveGap(rectangle, dockRect))
      && (!stageArea?.obstacle || !rectanglesIntersect(rectangle, stageArea.obstacle));
  };
  const clearCandidate = resolved.find(isClearCandidate);
  if (clearCandidate) return clearCandidate;

  if (stageArea) {
    const fallbackCandidate = getSafeControlCandidates(
      preferred,
      dockRect,
      stageArea,
    )
      .map(resolveCandidate)
      .sort((first, second) => (
        getSquaredDistance(first, preferred) - getSquaredDistance(second, preferred)
      ))
      .find(isClearCandidate);
    if (fallbackCandidate) return fallbackCandidate;
  }

  throw new RangeError('Unable to place personalization rotation control within the stage');
}

export function getPersonalizationControlsLayout(candidate, anchor, stageArea) {
  const dock = getPersonalizationDockLayout(candidate, anchor, stageArea);
  const dockRect = getDockRect(dock);
  const rotateHandle = getPersonalizationRotateHandleLayout(
    anchor,
    stageArea,
    dockRect,
  );
  return { dock, rotateHandle };
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

function getDockRect(layout) {
  const rows = Math.ceil(CONTROL_COUNT / layout.columns);
  const width = getGridSize(layout.columns);
  const height = getGridSize(rows);
  return {
    bottom: layout.top + height,
    left: layout.left - width / 2,
    right: layout.left + width / 2,
    top: layout.top,
  };
}

function getControlRect(layout) {
  const halfSize = CONTROL_SIZE / 2;
  return {
    bottom: layout.top + CONTROL_SIZE,
    left: layout.left - halfSize,
    right: layout.left + halfSize,
    top: layout.top,
  };
}

function getSafeControlCandidates(preferred, dockRect, stageArea) {
  const halfSize = CONTROL_SIZE / 2;
  const horizontalPositions = [
    preferred.left,
    DOCK_EDGE_GAP + halfSize,
    stageArea.width - DOCK_EDGE_GAP - halfSize,
  ];
  const verticalPositions = [
    preferred.top,
    DOCK_EDGE_GAP,
    stageArea.height - DOCK_EDGE_GAP - CONTROL_SIZE,
  ];

  if (dockRect) {
    horizontalPositions.push(
      dockRect.left - DOCK_EDGE_GAP - halfSize,
      dockRect.right + DOCK_EDGE_GAP + halfSize,
    );
    verticalPositions.push(
      dockRect.top - DOCK_EDGE_GAP - CONTROL_SIZE,
      dockRect.bottom + DOCK_EDGE_GAP,
    );
  }

  if (stageArea.obstacle) {
    horizontalPositions.push(
      stageArea.obstacle.left - halfSize,
      stageArea.obstacle.right + halfSize,
    );
    verticalPositions.push(
      stageArea.obstacle.top - CONTROL_SIZE,
      stageArea.obstacle.bottom,
    );
  }

  return verticalPositions.flatMap((top) => (
    horizontalPositions.map((left) => ({ left, top }))
  ));
}

function getSquaredDistance(first, second) {
  return (first.left - second.left) ** 2 + (first.top - second.top) ** 2;
}

function rectangleIsInsideStage(rectangle, stageArea) {
  return rectangle.left >= DOCK_EDGE_GAP
    && rectangle.right <= stageArea.width - DOCK_EDGE_GAP
    && rectangle.top >= DOCK_EDGE_GAP
    && rectangle.bottom <= stageArea.height - DOCK_EDGE_GAP;
}

function rectanglesHaveGap(first, second, gap = DOCK_EDGE_GAP) {
  return first.right + gap <= second.left
    || first.left >= second.right + gap
    || first.bottom + gap <= second.top
    || first.top >= second.bottom + gap;
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
