import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductStage } from './ProductStage.jsx';

const rendererHarness = vi.hoisted(() => ({ activePrintId: null, options: null }));

vi.mock('./garmentRenderer.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    GarmentRenderer: class {
      constructor(host, options) {
        rendererHarness.options = options;
        this.onPrintAnchorChange = options.onPrintAnchorChange;
      }

      update() {
        this.onPrintAnchorChange?.({ visible: true, x: 180, y: 220, placement: 'right-top' });
      }

      setView() {}

      setActivePrintId(id) {
        rendererHarness.activePrintId = id;
      }

      dispose() {}
    },
  };
});

const product = { name: 'Chelsea Match Jersey', renderer: 'garmentRenderer' };
const selected = { colorway: { label: 'Home White' }, layout: { label: 'Medium' }, material: { shortLabel: 'Stadium knit' } };

beforeAll(() => {
  vi.stubGlobal('WebGLRenderingContext', class WebGLRenderingContext {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  rendererHarness.activePrintId = null;
  rendererHarness.options = null;
});

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

  it('duplicates the active print at a distinct placement', async () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', placement: { x: 0, y: 0.36, z: 0.5 } }] } }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate print' }));

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: expect.arrayContaining([expect.objectContaining({ id: 'print-2' })]) }),
    }));

    await waitFor(() => {
      expect(rendererHarness.activePrintId).toBe('print-2');
    });
  });

  it('forwards edit to the page with the active print id', () => {
    const onEditPrint = vi.fn();
    render(<ProductStage onEditPrint={onEditPrint} onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }] } }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit print' }));

    expect(onEditPrint).toHaveBeenCalledWith('print-1');
  });

  it('updates the active print scale from the resize handle', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } }} />);

    const handle = screen.getByRole('button', { name: 'Resize print' });
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 10 });

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: [expect.objectContaining({ id: 'print-1', scale: expect.any(Number) })] }),
    }));
  });

  it('hides the toolbar without an anchor and positions it beside the selected print', async () => {
    render(<ProductStage onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }] } }} />);

    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Selected print controls' })).toHaveClass('is-right-top');
    });

    act(() => rendererHarness.options.onPrintAnchorChange({ visible: false }));
    expect(screen.queryByRole('group', { name: 'Selected print controls' })).not.toBeInTheDocument();

    act(() => rendererHarness.options.onPrintAnchorChange({ visible: true, x: 300, y: 80, placement: 'left-bottom' }));
    expect(screen.getByRole('group', { name: 'Selected print controls' })).toHaveClass('is-left-bottom');
  });
});
