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

  it('starts a gesture with a y-up atan2 pointer angle while preserving raw multi-turn rotation', () => {
    const gesture = beginAt(90, 450);

    expect(gesture).toMatchObject({
      lastAngle: -90,
      rawRotation: 450,
      rotation: 90,
    });
  });

  it('maps a clockwise screen drag to the negative rotation used by the renderer', () => {
    const next = updateRotationGesture(beginAt(0), pointAt(90));

    expect(next.rawRotation).toBeCloseTo(-90, 8);
    expect(next.rotation).toBe(270);
  });

  it('keeps clockwise movement decreasing when the pointer crosses 179 degrees to -179 degrees', () => {
    const next = updateRotationGesture(beginAt(179, 10), pointAt(-179));

    expect(next.rawRotation).toBeCloseTo(8, 8);
    expect(next.rotation).toBeCloseTo(8, 8);
  });

  it('keeps counter-clockwise movement increasing when the pointer crosses -179 degrees to 179 degrees', () => {
    const next = updateRotationGesture(beginAt(-179, 10), pointAt(179));

    expect(next.rawRotation).toBeCloseTo(12, 8);
    expect(next.rotation).toBeCloseTo(12, 8);
  });

  it('does not reverse near the 180 degree boundary with y-up renderer angles', () => {
    const first = updateRotationGesture(beginAt(179, 178), pointAt(-179));
    const second = updateRotationGesture(first, pointAt(-175));

    expect(first.rawRotation).toBeLessThan(178);
    expect(second.rawRotation).toBeLessThan(first.rawRotation);
    expect(second.rawRotation).toBeCloseTo(172, 8);
    expect(second.rotation).toBeCloseTo(172, 8);
  });

  it('soft-snaps within four degrees of each 45 degree increment and releases to the accumulated angle outside it', () => {
    const nearSnap = updateRotationGesture(beginAt(0, 48), pointAt(1));
    const heldSnap = updateRotationGesture(nearSnap, pointAt(3));
    const released = updateRotationGesture(heldSnap, pointAt(8));

    expect(nearSnap.rawRotation).toBeCloseTo(47, 8);
    expect(nearSnap.rotation).toBe(45);
    expect(heldSnap.rawRotation).toBeCloseTo(45, 8);
    expect(heldSnap.rotation).toBe(45);
    expect(released.rawRotation).toBeCloseTo(40, 8);
    expect(released.rotation).toBeCloseTo(40, 8);
  });

  it('soft-snaps around 180 degrees without changing counter-clockwise direction', () => {
    const snapped = updateRotationGesture(beginAt(0, 178), pointAt(-1));
    const continued = updateRotationGesture(snapped, pointAt(5));

    expect(snapped.rawRotation).toBeCloseTo(179, 8);
    expect(snapped.rotation).toBe(180);
    expect(continued.rawRotation).toBeCloseTo(173, 8);
    expect(continued.rotation).toBeCloseTo(173, 8);
  });

  it('re-arms without rotating when a gesture starts at the center and first moves outside the dead zone', () => {
    const started = beginRotationGesture({
      ...CENTER,
      clientX: CENTER.centerX,
      clientY: CENTER.centerY,
      rotation: 37,
    });
    const armed = updateRotationGesture(started, pointAt(45));

    expect(started.lastAngle).toBeNull();
    expect(armed.lastAngle).toBeCloseTo(-45, 8);
    expect(armed.rawRotation).toBe(37);
    expect(armed.rotation).toBe(37);
  });

  it('re-arms across the center without jumping from 179 degrees to -179 degrees', () => {
    const enteredCenter = updateRotationGesture(beginAt(179, 10), {
      clientX: CENTER.centerX,
      clientY: CENTER.centerY,
    });
    const leftCenter = updateRotationGesture(enteredCenter, pointAt(-179));

    expect(enteredCenter).toMatchObject({ lastAngle: null, rawRotation: 10, rotation: 10 });
    expect(leftCenter.rawRotation).toBe(10);
    expect(leftCenter.rotation).toBe(10);
  });

  it.each([180, 180 - 1e-10])('ignores an ambiguous %s degree single-step turn', (degrees) => {
    const next = updateRotationGesture(beginAt(0, 25), pointAt(degrees));

    expect(next.rawRotation).toBe(25);
    expect(next.rotation).toBe(25);
    expect(Math.abs(next.lastAngle)).toBeCloseTo(degrees, 8);
  });

  it('accumulates three complete screen rotations through incremental pointer moves', () => {
    let gesture = beginAt(0);

    for (let degrees = 15; degrees <= 1080; degrees += 15) {
      gesture = updateRotationGesture(gesture, pointAt(degrees));
    }

    expect(gesture.rawRotation).toBeCloseTo(-1080, 8);
    expect(gesture.rotation).toBeCloseTo(0, 8);
  });

  it('does not mutate gesture or pointer inputs', () => {
    const gesture = Object.freeze(beginAt(15, 12));
    const pointer = Object.freeze(pointAt(30));
    const gestureSnapshot = { ...gesture };
    const pointerSnapshot = { ...pointer };

    const next = updateRotationGesture(gesture, pointer);

    expect(gesture).toEqual(gestureSnapshot);
    expect(pointer).toEqual(pointerSnapshot);
    expect(next).not.toBe(gesture);
  });

  it.each([
    ['normalizeRotation', () => normalizeRotation(Number.NaN)],
    ['beginRotationGesture rotation', () => beginRotationGesture({ ...CENTER, ...pointAt(0), rotation: Infinity })],
    ['updateRotationGesture point', () => updateRotationGesture(beginAt(0), { clientX: Number.NaN, clientY: 0 })],
  ])('rejects non-finite %s inputs', (_label, invoke) => {
    expect(invoke).toThrow(TypeError);
  });
});
