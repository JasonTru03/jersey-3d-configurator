import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  clampDecorationTransform,
  createDecoration,
  patchDecoration,
  removeDecoration,
  validateDecorationFile,
} from './decorations.js';

describe('decoration helpers', () => {
  it('accepts supported upload files and rejects unsupported or oversized files', () => {
    expect(validateDecorationFile({ type: 'image/png', size: 1024 })).toEqual({ ok: true });
    expect(validateDecorationFile({ type: 'image/gif', size: 1024 })).toMatchObject({ ok: false });
    expect(validateDecorationFile({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).toMatchObject({ ok: false });
  });

  it('creates and updates a bounded, serializable decoration', () => {
    const decoration = createDecoration({
      id: 'badge-1',
      kind: 'preset',
      source: 'crest-badge',
      label: 'Crest badge',
      region: 'front',
    });

    expect(patchDecoration(decoration, { x: 9, y: -9, scale: 9, rotation: 300 })).toMatchObject({
      x: 1,
      y: -1,
      scale: 2.4,
      rotation: 180,
    });
  });

  it('keeps other decorations when one is removed', () => {
    const decorations = [
      createDecoration({ id: 'a', kind: 'preset', source: 'a', label: 'A', region: 'front' }),
      createDecoration({ id: 'b', kind: 'preset', source: 'b', label: 'B', region: 'back' }),
    ];

    expect(removeDecoration(decorations, 'a')).toEqual([decorations[1]]);
  });

  it('clamps transform values without changing valid fields', () => {
    expect(clampDecorationTransform({ x: 0.4, y: -0.6, scale: 1.2, rotation: -30 })).toEqual({
      x: 0.4,
      y: -0.6,
      scale: 1.2,
      rotation: -30,
    });
  });
});
