import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductStage } from './ProductStage.jsx';

const product = { name: 'Chelsea Match Jersey', renderer: 'garmentRenderer' };
const selected = { colorway: { label: 'Home White' }, layout: { label: 'Medium' }, material: { shortLabel: 'Stadium knit' } };

describe('ProductStage print toolbar', () => {
  it('rotates the active print through the state patch callback', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rotate print right' }));

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({
        printItems: [expect.objectContaining({ id: 'print-1', rotation: 15 })],
      }),
    }));
  });

  it('removes the active print through the state patch callback', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete print' }));

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: [] }),
    }));
  });

  it('duplicates the active print at a distinct placement', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', placement: { x: 0, y: 0.36, z: 0.5 } }] } }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate print' }));

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: expect.arrayContaining([expect.objectContaining({ id: 'print-2' })]) }),
    }));
  });

  it('forwards edit to the page with the active print id', () => {
    const onEditPrint = vi.fn();
    render(<ProductStage onEditPrint={onEditPrint} onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }] } }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit print' }));

    expect(onEditPrint).toHaveBeenCalledWith('print-1');
  });
});
