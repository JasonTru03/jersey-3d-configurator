import { describe, expect, it } from 'vitest';
import {
  createPrintItem,
  duplicatePrintItem,
  ensurePrintItems,
  getPrintItems,
  patchPrintItem,
} from './printItems.js';

describe('print items', () => {
  it('converts legacy fields into one stable print item', () => {
    expect(getPrintItems({
      printName: 'PLAYER',
      printNumber: '16',
      printPlacement: { x: 0, y: 0.36, z: 0.5 },
    })).toMatchObject([{
      id: 'print-1',
      name: 'PLAYER',
      number: '16',
      scale: 1,
      rotation: 0,
    }]);
  });

  it('clamps transforms and creates a distinct copy', () => {
    const items = [createPrintItem({ id: 'print-1' })];
    const transformed = patchPrintItem(items, 'print-1', { rotation: 375, scale: 5 });
    const copy = duplicatePrintItem(transformed, 'print-1', { x: 0.2, y: 0.3, z: 0.4 });

    expect(transformed[0]).toMatchObject({ rotation: 15, scale: 1.8 });
    expect(copy).toMatchObject({ id: 'print-2', placement: { x: 0.2, y: 0.3, z: 0.4 } });
  });

  it('recreates a default print item when a printable option is selected after deletion', () => {
    expect(ensurePrintItems([])).toEqual([
      expect.objectContaining({ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }),
    ]);
    expect(ensurePrintItems([createPrintItem({ id: 'print-4', name: 'CUSTOM' })])).toEqual([
      expect.objectContaining({ id: 'print-4', name: 'CUSTOM' }),
    ]);
  });
});
