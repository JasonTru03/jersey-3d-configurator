import { describe, expect, it } from 'vitest';
import {
  LEGACY_PATTERN_ASSET_URLS,
  MAX_UPLOAD_BYTES,
  clampDecorationTransform,
  createDecoration,
  patchDecoration,
  removeDecoration,
  resolveDecorationAsset,
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

    expect(decoration.placement).toBeNull();

    expect(patchDecoration(decoration, { x: 9, y: -9, scale: 9, rotation: 300 })).toMatchObject({
      x: 1,
      y: -1,
      scale: 2.4,
      rotation: 180,
    });
  });

  it('preserves a saved mesh placement but clears it after a region change', () => {
    const decoration = createDecoration({ id: 'badge-1', kind: 'preset', source: 'crest', label: 'Crest', region: 'front' });
    const placement = {
      region: 'front',
      position: { x: 0.1, y: 0.2, z: 0.3 },
      normal: { x: 0, y: 0, z: 1 },
    };

    expect(patchDecoration(decoration, { placement }).placement).toEqual(placement);
    expect(patchDecoration({ ...decoration, placement }, { region: 'back' }).placement).toBeNull();
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

  it('resolves the current preset asset instead of its source id', () => {
    const assetUrl = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E';

    expect(resolveDecorationAsset(
      { kind: 'badge', source: 'crest-badge' },
      [{ source: 'crest-badge', assetUrl }],
    )).toBe(assetUrl);
  });

  it.each(Object.entries(LEGACY_PATTERN_ASSET_URLS))('resolves the legacy %s pattern when it is no longer an active preset', (source, expectedAssetUrl) => {
    const activePresets = [
      { source: 'crest-badge', assetUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' },
      { source: 'roundel-badge', assetUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E' },
    ];

    expect(resolveDecorationAsset({ kind: 'pattern', source }, activePresets)).toBe(expectedAssetUrl);
  });

  it('prefers an active preset asset over a legacy source mapping', () => {
    const activeAssetUrl = 'data:image/svg+xml,%3Csvg%3E%3Cpath id="active"/%3E%3C/svg%3E';

    expect(resolveDecorationAsset(
      { kind: 'pattern', source: 'golden-stripe' },
      [{ source: 'golden-stripe', assetUrl: activeAssetUrl }],
    )).toBe(activeAssetUrl);
  });

  it('returns uploaded artwork data URLs unchanged', () => {
    const uploadDataUrl = 'data:image/png;base64,uploaded-artwork';

    expect(resolveDecorationAsset(
      { kind: 'upload', source: uploadDataUrl },
      [{ source: 'golden-stripe', assetUrl: LEGACY_PATTERN_ASSET_URLS['golden-stripe'] }],
    )).toBe(uploadDataUrl);
  });
});
