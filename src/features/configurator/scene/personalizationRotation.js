const FULL_TURN = 360;
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
  const rawRotation = gesture.rawRotation + normalizeAngleDelta(angle - gesture.lastAngle);

  return {
    ...gesture,
    lastAngle: angle,
    rawRotation,
    rotation: getSnappedRotation(rawRotation),
  };
}

function getPointerAngle(centerX, centerY, clientX, clientY) {
  return Math.atan2(clientY - centerY, clientX - centerX) * (180 / Math.PI);
}

function normalizeAngleDelta(delta) {
  const normalized = ((delta + 180) % FULL_TURN + FULL_TURN) % FULL_TURN - 180;
  return normalized === -180 && delta > 0 ? 180 : normalized;
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
  assertFiniteNumber(gesture.lastAngle, 'gesture.lastAngle');
  assertFiniteNumber(gesture.rawRotation, 'gesture.rawRotation');
}

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
}
