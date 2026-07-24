const FULL_TURN = 360;
const HALF_TURN = 180;
const HALF_TURN_EPSILON = 1e-6;
const DEAD_RADIUS = 8;
const SNAP_INCREMENT = 45;
const SNAP_RANGE = 4;

export function normalizeRotation(degrees) {
  assertFiniteNumber(degrees, 'degrees');
  return ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

export function beginRotationGesture({ centerX, centerY, clientX, clientY, rotation }) {
  assertFiniteNumber(centerX, 'centerX');
  assertFiniteNumber(centerY, 'centerY');
  assertFiniteNumber(clientX, 'clientX');
  assertFiniteNumber(clientY, 'clientY');
  assertFiniteNumber(rotation, 'rotation');

  return {
    centerX,
    centerY,
    lastAngle: getPointerAngle(centerX, centerY, clientX, clientY),
    rawRotation: rotation,
    rotation: normalizeRotation(rotation),
  };
}

export function updateRotationGesture(gesture, { clientX, clientY }) {
  assertGesture(gesture);
  assertFiniteNumber(clientX, 'clientX');
  assertFiniteNumber(clientY, 'clientY');

  const angle = getPointerAngle(gesture.centerX, gesture.centerY, clientX, clientY);
  if (angle === null || gesture.lastAngle === null) {
    return {
      ...gesture,
      lastAngle: angle,
    };
  }

  const delta = normalizeAngleDelta(angle - gesture.lastAngle);
  if (Math.abs(Math.abs(delta) - HALF_TURN) <= HALF_TURN_EPSILON) {
    return {
      ...gesture,
      lastAngle: angle,
    };
  }

  const rawRotation = gesture.rawRotation + delta;

  return {
    ...gesture,
    lastAngle: angle,
    rawRotation,
    rotation: getSnappedRotation(rawRotation),
  };
}

function getPointerAngle(centerX, centerY, clientX, clientY) {
  const offsetX = clientX - centerX;
  const offsetY = centerY - clientY;
  if (Math.hypot(offsetX, offsetY) < DEAD_RADIUS) return null;
  return Math.atan2(offsetY, offsetX) * (180 / Math.PI);
}

function normalizeAngleDelta(delta) {
  const normalized = ((delta + HALF_TURN) % FULL_TURN + FULL_TURN) % FULL_TURN - HALF_TURN;
  return normalized === -HALF_TURN && delta > 0 ? HALF_TURN : normalized;
}

function getSnappedRotation(rawRotation) {
  const snapTarget = Math.round(rawRotation / SNAP_INCREMENT) * SNAP_INCREMENT;
  const rotation = Math.abs(rawRotation - snapTarget) <= SNAP_RANGE ? snapTarget : rawRotation;
  return normalizeRotation(rotation);
}

function assertGesture(gesture) {
  if (!gesture || typeof gesture !== 'object') throw new TypeError('gesture must be an object');
  assertFiniteNumber(gesture.centerX, 'gesture.centerX');
  assertFiniteNumber(gesture.centerY, 'gesture.centerY');
  if (gesture.lastAngle !== null) assertFiniteNumber(gesture.lastAngle, 'gesture.lastAngle');
  assertFiniteNumber(gesture.rawRotation, 'gesture.rawRotation');
  assertFiniteNumber(gesture.rotation, 'gesture.rotation');
}

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
}
