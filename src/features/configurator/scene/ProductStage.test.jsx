import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductStage } from './ProductStage.jsx';

const rendererHarness = vi.hoisted(() => ({ activePrintId: null, focusedDecorationId: null, options: null, updateArgs: null }));

vi.mock('./garmentRenderer.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    GarmentRenderer: class {
      constructor(host, options) {
        rendererHarness.options = options;
        this.onPrintAnchorChange = options.onPrintAnchorChange;
      }

      update(...args) {
        rendererHarness.updateArgs = args;
        this.onPrintAnchorChange?.({ visible: true, left: 180, top: 220, width: 96, height: 54 });
      }

      setView() {}

      setActivePrintId(id) {
        rendererHarness.activePrintId = id;
      }

      focusDecoration(id) {
        rendererHarness.focusedDecorationId = id;
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
  rendererHarness.focusedDecorationId = null;
  rendererHarness.options = null;
  rendererHarness.updateArgs = null;
});

describe('ProductStage print toolbar', () => {
  it('forwards selected appearance to the garment renderer', () => {
    const appearance = { template: 'gradient', colors: { body: '#F7F5EF' } };
    render(<ProductStage onStatePatch={vi.fn()} product={product} selected={{ ...selected, appearance }} state={{ lighting: 'none', overrides: {} }} />);

    expect(rendererHarness.updateArgs[2].appearance).toBe(appearance);
  });

  it('forwards an artwork selection id to the renderer focus method', () => {
    render(<ProductStage artworkFocusId="crest-1" onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'none', overrides: {} }} />);

    expect(rendererHarness.focusedDecorationId).toBe('crest-1');
  });

  it('does not inject an artwork anchor callback into the renderer', () => {
    render(<ProductStage onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'none', overrides: {} }} />);

    expect(rendererHarness.options.onDecorationAnchorChange).toBeUndefined();
    expect(screen.queryByTestId('artwork-selection-frame')).not.toBeInTheDocument();
  });

  it('only shows controls after a print is selected and hides them after blank-stage selection clears', () => {
    render(<ProductStage onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }] } }} />);

    expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();

    act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();

    act(() => rendererHarness.options.onPrintSelectionChange(null));
    expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();
  });

  it('stores a clockwise forty-five-degree rotation from one button click', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate personalization 45 degrees' }));

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({
        printItems: [expect.objectContaining({ id: 'print-1', rotation: 45 })],
      }),
    }));
  });

  it('removes the active print through the state patch callback', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: [] }),
    }));
  });

  it('duplicates the active print at a distinct placement', async () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', placement: { x: 0, y: 0.36, z: 0.5 } }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: expect.arrayContaining([expect.objectContaining({ id: 'print-2' })]) }),
    }));

    await waitFor(() => {
      expect(rendererHarness.activePrintId).toBe('print-2');
    });
  });

  it('forwards edit to the page with the active print id', () => {
    const onEditPersonalization = vi.fn();
    render(<ProductStage onEditPersonalization={onEditPersonalization} onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit personalization' }));

    expect(onEditPersonalization).toHaveBeenCalledWith('print-1');
  });

  it('updates the active print scale from the resize handle', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
    const handle = screen.getByRole('button', { name: 'Resize personalization' });
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 10 });

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: [expect.objectContaining({ id: 'print-1', scale: expect.any(Number) })] }),
    }));
  });

  it('hides the toolbar without a visible selection rectangle', async () => {
    render(<ProductStage onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();
    });

    act(() => rendererHarness.options.onPrintAnchorChange({ visible: false }));
    expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();

    act(() => rendererHarness.options.onPrintAnchorChange({ visible: true, left: 300, top: 80, width: 96, height: 54 }));
    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();
  });

  it('rotates a custom text personalization by forty-five degrees', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON', rotation: 0 }] },
    }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('custom-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate personalization 45 degrees' }));

    expect(onStatePatch).toHaveBeenCalledWith({
      overrides: {
        customTextItems: [expect.objectContaining({ id: 'custom-id', rotation: 45 })],
      },
    });
  });

  it('duplicates custom text away from every personalization placement and selects the copy', async () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'player-id', name: 'PLAYER', number: '16', placement: { x: 0.3, y: 0.36, z: 0.5 } }],
        customTextItems: [{ id: 'custom-id', text: 'MASON', placement: { x: 0, y: 0.36, z: 0.5 } }],
      },
    }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('custom-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));

    expect(onStatePatch).toHaveBeenCalledWith({
      overrides: {
        customTextItems: expect.arrayContaining([
          expect.objectContaining({ id: 'text-2', placement: { x: -0.3, y: 0.36, z: 0.5 } }),
        ]),
      },
    });
    await waitFor(() => expect(rendererHarness.activePrintId).toBe('text-2'));
  });

  it('deletes custom text without mutating the player collection', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'player-id', name: 'PLAYER', number: '16' }],
        customTextItems: [{ id: 'custom-id', text: 'MASON' }],
      },
    }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('custom-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));

    expect(onStatePatch).toHaveBeenCalledWith({ overrides: { customTextItems: [] } });
  });

  it('notifies the parent when the renderer selection changes', () => {
    const onPersonalizationSelect = vi.fn();
    render(<ProductStage onPersonalizationSelect={onPersonalizationSelect} onStatePatch={vi.fn()} product={product} selected={selected} state={{
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON' }] },
    }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('custom-id'));
    act(() => rendererHarness.options.onPrintSelectionChange(null));

    expect(onPersonalizationSelect).toHaveBeenNthCalledWith(1, 'custom-id');
    expect(onPersonalizationSelect).toHaveBeenNthCalledWith(2, null);
  });

  it('focuses a valid external personalization id and clears a deleted focus', async () => {
    const onPersonalizationSelect = vi.fn();
    const { rerender } = render(<ProductStage
      onPersonalizationSelect={onPersonalizationSelect}
      onStatePatch={vi.fn()}
      personalizationFocusId="custom-id"
      product={product}
      selected={selected}
      state={{ lighting: 'none', overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON' }] } }}
    />);

    await waitFor(() => expect(rendererHarness.activePrintId).toBe('custom-id'));
    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();

    rerender(<ProductStage
      onPersonalizationSelect={onPersonalizationSelect}
      onStatePatch={vi.fn()}
      personalizationFocusId="custom-id"
      product={product}
      selected={selected}
      state={{ lighting: 'none', overrides: { customTextItems: [] } }}
    />);

    await waitFor(() => {
      expect(rendererHarness.activePrintId).toBeNull();
      expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();
      expect(onPersonalizationSelect).toHaveBeenCalledWith(null);
    });
  });
});
