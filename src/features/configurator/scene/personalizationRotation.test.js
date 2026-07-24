import { describe, expect, it } from 'vitest';
import {
  beginRotationGesture,
  normalizeRotation,
  updateRotationGesture,
} from './personalizationRotation.js';

const CENTER = { centerX: 400, centerY: 300 };

function pointAt(degrees, radius = 100) {
  const radians = (degrees * Math.PI) / 180;
  return {
    clientX: CENTER.centerX + Math.cos(radians) * radius,
    clientY: CENTER.centerY + Math.sin(radians) * radius,
  };
}

function beginAt(degrees, rotation = 0) {
  return beginRotationGesture({ ...CENTER, ...pointAt(degrees), rotation });
}

describe('personalization rotation gestures', () => {
  it('normalizes positive, negative, and multi-turn rotations into 0 through 359 degrees', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(765)).toBe(45);
    expect(normalizeRotation(-1)).toBe(359);
    expect(normalizeRotation(-810)).toBe(270);
  });

  it('starts a gesture with the atan2 pointer angle while preserving raw multi-turn rotation', () => {
    const gesture = beginAt(90, 450);

    expect(gesture).toMatchObject({
      lastAngle: 90,
      rawRotation: 450,
      rotation: 90,
    });
  });

  it('keeps clockwise movement monotonic when the pointer crosses 179 degrees to -179 degrees', () => {
    const next = updateRotationGesture(beginAt(179, 10), pointAt(-179));

    expect(next.rawRotation).toBeCloseTo(12, 8);
    expect(next.rotation).toBeCloseTo(12, 8);
  });

  it('keeps counter-clockwise movement monotonic when the pointer crosses -179 degrees to 179 degrees', () => {
    const next = updateRotationGesture(beginAt(-179, 10), pointAt(179));

    expect(next.rawRotation).toBeCloseTo(8, 8);
    expect(next.rotation).toBeCloseTo(8, 8);
  });

  it('does not reverse near the 180 degree boundary while screen-y coordinates increase downward', () => {
    const first = updateRotationGesture(beginAt(179, 178), pointAt(-179));
    const second = updateRotationGesture(first, pointAt(-175));

    expect(first.rawRotation).toBeGreaterThan(178);
    expect(second.rawRotation).toBeGreaterThan(first.rawRotation);
    expect(second.rawRotation).toBeCloseTo(184, 8);
    expect(second.rotation).toBe(180);
  });

  it('soft-snaps within four degrees of each 45 degree increment and releases to the accumulated angle outside it', () => {
    const nearSnap = updateRotationGesture(beginAt(0, 42), pointAt(1));
    const heldSnap = updateRotationGesture(nearSnap, pointAt(3));
    const released = updateRotationGesture(heldSnap, pointAt(8));

    expect(nearSnap.rawRotation).toBeCloseTo(43, 8);
    expect(nearSnap.rotation).toBe(45);
    expect(heldSnap.rawRotation).toBeCloseTo(45, 8);
    expect(heldSnap.rotation).toBe(45);
    expect(released.rawRotation).toBeCloseTo(50, 8);
    expect(released.rotation).toBeCloseTo(50, 8);
  });

  it('soft-snaps around 180 degrees without changing clockwise direction', () => {
    const snapped = updateRotationGesture(beginAt(0, 178), pointAt(1));
    const continued = updateRotationGesture(snapped, pointAt(5));

    expect(snapped.rawRotation).toBeCloseTo(179, 8);
    expect(snapped.rotation).toBe(180);
    expect(continued.rawRotation).toBeCloseTo(183, 8);
    expect(continued.rotation).toBe(180);
  });

  it.each([
    ['normalizeRotation', () => normalizeRotation(Number.NaN)],
    ['beginRotationGesture rotation', () => beginRotationGesture({ ...CENTER, ...pointAt(0), rotation: Infinity })],
    ['updateRotationGesture point', () => updateRotationGesture(beginAt(0), { clientX: Number.NaN, clientY: 0 })],
  ])('rejects non-finite %s inputs', (_label, invoke) => {
    expect(invoke).toThrow(TypeError);
  });
});
