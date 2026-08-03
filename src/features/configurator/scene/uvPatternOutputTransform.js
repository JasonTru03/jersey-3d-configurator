export function resolvePatternOutputTransform(uvLayout) {
  const transform = uvLayout?.patternOutputTransform;
  if (transform === undefined) return { rotation: 0, mirrorX: false };
  return { rotation: transform.rotation, mirrorX: transform.mirrorX };
}

export function transformPatternOutputPoint(point, {
  width,
  height,
  rotation,
  mirrorX,
}) {
  let rotatedPoint;
  switch (rotation) {
    case 90:
      rotatedPoint = { x: height - point.y, y: point.x };
      break;
    case 180:
      rotatedPoint = { x: width - point.x, y: height - point.y };
      break;
    case 270:
      rotatedPoint = { x: point.y, y: width - point.x };
      break;
    default:
      rotatedPoint = { x: point.x, y: point.y };
  }

  const outputWidth = rotation === 90 || rotation === 270 ? height : width;
  return mirrorX
    ? { x: outputWidth - rotatedPoint.x, y: rotatedPoint.y }
    : rotatedPoint;
}

export function transformPatternOutputBounds(bounds, transform) {
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  ].map((point) => transformPatternOutputPoint(point, transform));
  const minimumX = Math.min(...corners.map(({ x }) => x));
  const maximumX = Math.max(...corners.map(({ x }) => x));
  const minimumY = Math.min(...corners.map(({ y }) => y));
  const maximumY = Math.max(...corners.map(({ y }) => y));

  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  };
}

export function applyPatternOutputTransform(context, {
  width,
  height,
  rotation,
  mirrorX,
}) {
  const outputWidth = rotation === 90 || rotation === 270 ? height : width;
  if (mirrorX) {
    context.translate(outputWidth, 0);
    context.scale(-1, 1);
  }
  switch (rotation) {
    case 90:
      context.translate(height, 0);
      context.rotate(Math.PI / 2);
      break;
    case 180:
      context.translate(width, height);
      context.rotate(Math.PI);
      break;
    case 270:
      context.translate(0, width);
      context.rotate(Math.PI * 3 / 2);
      break;
    default:
      break;
  }
}
