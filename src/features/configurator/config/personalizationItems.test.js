import { describe, expect, it } from 'vitest';
import {
  findPersonalizationItem,
  getPersonalizationRemovalPatch,
  getRenderablePersonalizationItems,
  getSelectablePersonalizationItems,
  makePersonalizationKey,
  PERSONALIZATION_COPY_CANDIDATES,
} from './personalizationItems.js';

describe('personalization item identity', () => {
  it('keeps player and custom text identities distinct when their raw ids match', () => {
    const state = {
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'same-id', name: 'PLAYER', number: '16' }],
        customTextItems: [{ id: 'same-id', text: 'MASON' }],
      },
    };

    const items = getSelectablePersonalizationItems(state);

    expect(items).toEqual([
      expect.objectContaining({
        itemKind: 'player',
        sourceId: 'same-id',
        key: 'player:same-id',
      }),
      expect.objectContaining({
        itemKind: 'text',
        sourceId: 'same-id',
        key: 'text:same-id',
      }),
    ]);
    expect(findPersonalizationItem(items, makePersonalizationKey('text', 'same-id')))
      .toMatchObject({ itemKind: 'text', sourceId: 'same-id' });
  });

  it('keeps blank custom text selectable while excluding it from rendered layers', () => {
    const state = {
      lighting: 'none',
      overrides: {
        customTextItems: [
          { id: 'blank-id', text: '   ' },
          { id: 'visible-id', text: 'MASON' },
        ],
      },
    };

    expect(getSelectablePersonalizationItems(state).map((item) => item.key))
      .toEqual(['text:blank-id', 'text:visible-id']);
    expect(getRenderablePersonalizationItems(state).map((item) => item.key))
      .toEqual(['text:visible-id']);
  });

  it('provides enough mutually separated copy placements for sixteen items', () => {
    expect(PERSONALIZATION_COPY_CANDIDATES.length).toBeGreaterThanOrEqual(15);
    PERSONALIZATION_COPY_CANDIDATES.forEach((candidate, index) => {
      PERSONALIZATION_COPY_CANDIDATES.slice(index + 1).forEach((other) => {
        expect(Math.hypot(
          candidate.x - other.x,
          candidate.y - other.y,
          candidate.z - other.z,
        )).toBeGreaterThanOrEqual(0.24);
      });
    });
  });
});

describe('personalization removal patches', () => {
  const state = {
    lighting: 'name-number',
    overrides: {
      printItems: [
        { id: 'print-1', name: 'FIRST', number: '10', placement: { x: 0 } },
        { id: 'print-2', name: 'SECOND', number: '20', placement: { x: 1 } },
      ],
      customTextItems: [
        { id: 'text-1', text: 'FRONT' },
        { id: 'text-2', text: 'BACK' },
      ],
    },
  };

  it('removes custom text by its composite key', () => {
    expect(getPersonalizationRemovalPatch(state, 'text:text-1')).toEqual({
      overrides: {
        customTextItems: [expect.objectContaining({ id: 'text-2', text: 'BACK' })],
      },
    });
  });

  it('removes a player set and refreshes its legacy first-item fields', () => {
    expect(getPersonalizationRemovalPatch(state, 'player:print-1')).toEqual({
      overrides: {
        printItems: [expect.objectContaining({ id: 'print-2' })],
        printName: 'SECOND',
        printNumber: '20',
        printPlacement: { x: 1 },
      },
    });
  });

  it('returns null when the composite key is missing or malformed', () => {
    expect(getPersonalizationRemovalPatch(state, 'text:missing')).toBeNull();
    expect(getPersonalizationRemovalPatch(state, 'missing')).toBeNull();
  });
});
