import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductStage } from './ProductStage.jsx';

const rendererHarness = vi.hoisted(() => ({
  activePrintId: null,
  focusedDecorationId: null,
  options: null,
  personalizationMutationDisabled: null,
  updateArgs: null,
}));

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

      setPersonalizationMutationDisabled(disabled) {
        rendererHarness.personalizationMutationDisabled = disabled;
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
  rendererHarness.personalizationMutationDisabled = null;
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

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();

    act(() => rendererHarness.options.onPrintSelectionChange(null));
    expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();
  });

  it('stores a five-degree rotation from the rotate handle keyboard control', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag to rotate personalization' }), { key: 'ArrowLeft' });

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({
        printItems: [expect.objectContaining({ id: 'print-1', rotation: 5 })],
      }),
    }));
  });

  it('routes active print deletion through the shared executor', () => {
    const onDeletePersonalization = vi.fn();
    render(<ProductStage onDeletePersonalization={onDeletePersonalization} onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));

    expect(onDeletePersonalization).toHaveBeenCalledWith(
      'player:print-1',
      expect.objectContaining({ onFailure: expect.any(Function), onStart: expect.any(Function) }),
    );
  });

  it('duplicates the active print at a distinct placement', async () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', placement: { x: 0, y: 0.36, z: 0.5 } }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: expect.arrayContaining([expect.objectContaining({ id: 'print-2' })]) }),
    }));

    await waitFor(() => {
      expect(rendererHarness.activePrintId).toBe('player:print-2');
    });
  });

  it('forwards edit to the page with the active print id', () => {
    const onEditPersonalization = vi.fn();
    render(<ProductStage onEditPersonalization={onEditPersonalization} onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit personalization' }));

    expect(onEditPersonalization).toHaveBeenCalledWith('player:print-1');
  });

  it('updates the active print scale from the resize handle', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    const handle = screen.getByRole('button', { name: 'Resize personalization' });
    fireEvent.pointerDown(handle, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 10 });

    expect(onStatePatch).toHaveBeenCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: [expect.objectContaining({ id: 'print-1', scale: expect.any(Number) })] }),
    }));
  });

  it('hides the toolbar without a visible selection rectangle', async () => {
    render(<ProductStage onStatePatch={vi.fn()} product={product} selected={selected} state={{ lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }] } }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();
    });

    act(() => rendererHarness.options.onPrintAnchorChange({ visible: false }));
    expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();

    act(() => rendererHarness.options.onPrintAnchorChange({ visible: true, left: 300, top: 80, width: 96, height: 54 }));
    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();
  });

  it('uses the shared deletion executor and disables the overlay while it is pending', () => {
    const onDeletePersonalization = vi.fn();
    const props = {
      onDeletePersonalization,
      onStatePatch: vi.fn(),
      product,
      personalizationMutationDisabled: true,
      selected,
      state: {
        lighting: 'name-number',
        overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16' }] },
      },
    };
    const { rerender } = render(<ProductStage {...props} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    expect(rendererHarness.personalizationMutationDisabled).toBe(true);
    expect(screen.getByTitle('Orbit view')).toBeEnabled();
    expect(screen.getAllByRole('button', { name: /personalization/i })).not.toEqual([]);
    screen.getAllByRole('button', { name: /personalization/i }).forEach((button) => {
      expect(button).toBeDisabled();
    });

    rerender(<ProductStage {...props} personalizationMutationDisabled={false} />);
    expect(rendererHarness.personalizationMutationDisabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));

    expect(onDeletePersonalization).toHaveBeenCalledWith(
      'player:print-1',
      expect.objectContaining({ onFailure: expect.any(Function), onStart: expect.any(Function) }),
    );
    expect(props.onStatePatch).not.toHaveBeenCalled();
  });

  it('rotates a custom text personalization by five degrees from the keyboard', () => {
    const onStatePatch = vi.fn();
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={{
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON', rotation: 0 }] },
    }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('text:custom-id'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag to rotate personalization' }), { key: 'ArrowLeft' });

    expect(onStatePatch).toHaveBeenCalledWith({
      overrides: {
        customTextItems: [expect.objectContaining({ id: 'custom-id', rotation: 5 })],
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

    act(() => rendererHarness.options.onPrintSelectionChange('text:custom-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));

    expect(onStatePatch).toHaveBeenCalledWith({
      overrides: {
        customTextItems: expect.arrayContaining([
          expect.objectContaining({ id: 'text-2', placement: { x: -0.3, y: 0.36, z: 0.5 } }),
        ]),
      },
    });
    await waitFor(() => expect(rendererHarness.activePrintId).toBe('text:text-2'));
  });

  it('routes custom text deletion through its composite key', () => {
    const onDeletePersonalization = vi.fn();
    render(<ProductStage onDeletePersonalization={onDeletePersonalization} onStatePatch={vi.fn()} product={product} selected={selected} state={{
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'player-id', name: 'PLAYER', number: '16' }],
        customTextItems: [{ id: 'custom-id', text: 'MASON' }],
      },
    }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('text:custom-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));

    expect(onDeletePersonalization).toHaveBeenCalledWith(
      'text:custom-id',
      expect.objectContaining({ onFailure: expect.any(Function), onStart: expect.any(Function) }),
    );
  });

  it('notifies the parent when the renderer selection changes', () => {
    const onPersonalizationSelect = vi.fn();
    render(<ProductStage onPersonalizationSelect={onPersonalizationSelect} onStatePatch={vi.fn()} product={product} selected={selected} state={{
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON' }] },
    }} />);

    act(() => rendererHarness.options.onPrintSelectionChange('text:custom-id'));
    act(() => rendererHarness.options.onPrintSelectionChange(null));

    expect(onPersonalizationSelect).toHaveBeenNthCalledWith(1, 'text:custom-id');
    expect(onPersonalizationSelect).toHaveBeenNthCalledWith(2, null);
  });

  it('focuses a valid external personalization id and clears a deleted focus', async () => {
    const onPersonalizationSelect = vi.fn();
    const { rerender } = render(<ProductStage
      onPersonalizationSelect={onPersonalizationSelect}
      onStatePatch={vi.fn()}
      personalizationFocusId="text:custom-id"
      product={product}
      selected={selected}
      state={{ lighting: 'none', overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON' }] } }}
    />);

    await waitFor(() => expect(rendererHarness.activePrintId).toBe('text:custom-id'));
    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();

    rerender(<ProductStage
      onPersonalizationSelect={onPersonalizationSelect}
      onStatePatch={vi.fn()}
      personalizationFocusId="text:custom-id"
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

  it('keeps blank custom text selected while hiding its 3D toolbar', async () => {
    const onPersonalizationSelect = vi.fn();
    const { rerender } = render(<ProductStage
      onPersonalizationSelect={onPersonalizationSelect}
      onStatePatch={vi.fn()}
      personalizationFocusId="text:custom-id"
      product={product}
      selected={selected}
      state={{ lighting: 'none', overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON' }] } }}
    />);

    await waitFor(() => expect(rendererHarness.activePrintId).toBe('text:custom-id'));
    expect(screen.getByRole('group', { name: 'Selected personalization controls' })).toBeInTheDocument();

    rerender(<ProductStage
      onPersonalizationSelect={onPersonalizationSelect}
      onStatePatch={vi.fn()}
      personalizationFocusId="text:custom-id"
      product={product}
      selected={selected}
      state={{ lighting: 'none', overrides: { customTextItems: [{ id: 'custom-id', text: '   ' }] } }}
    />);

    await waitFor(() => {
      expect(rendererHarness.activePrintId).toBe('text:custom-id');
      expect(screen.queryByRole('group', { name: 'Selected personalization controls' })).not.toBeInTheDocument();
    });
    expect(onPersonalizationSelect).not.toHaveBeenCalledWith(null);
  });

  it('reports an initially invalid non-empty focus once in StrictMode', async () => {
    const onPersonalizationSelect = vi.fn();
    const props = {
      onPersonalizationSelect,
      onStatePatch: vi.fn(),
      personalizationFocusId: 'text:missing',
      product,
      selected,
      state: {
        lighting: 'none',
        overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON' }] },
      },
    };
    const { rerender } = render(<StrictMode><ProductStage {...props} /></StrictMode>);

    await waitFor(() => {
      expect(onPersonalizationSelect.mock.calls.filter(([id]) => id === null)).toHaveLength(1);
    });
    rerender(<StrictMode><ProductStage {...props} /></StrictMode>);
    expect(onPersonalizationSelect.mock.calls.filter(([id]) => id === null)).toHaveLength(1);
  });

  it('mutates player and text items independently when their raw ids match', () => {
    const state = {
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'same-id', name: 'PLAYER', number: '16', rotation: 0 }],
        customTextItems: [{ id: 'same-id', text: 'MASON', rotation: 0 }],
      },
    };
    const onStatePatch = vi.fn();
    const onDeletePersonalization = vi.fn();
    render(<ProductStage onDeletePersonalization={onDeletePersonalization} onStatePatch={onStatePatch} product={product} selected={selected} state={state} />);

    act(() => rendererHarness.options.onPrintSelectionChange('text:same-id'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag to rotate personalization' }), { key: 'ArrowLeft' });
    expect(onStatePatch).toHaveBeenLastCalledWith({
      overrides: {
        customTextItems: [expect.objectContaining({ id: 'same-id', rotation: 5 })],
      },
    });

    act(() => rendererHarness.options.onPrintSelectionChange('player:same-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));
    expect(onDeletePersonalization).toHaveBeenCalledWith(
      'player:same-id',
      expect.objectContaining({ onFailure: expect.any(Function), onStart: expect.any(Function) }),
    );
  });

  it('reports a deleted selection once in StrictMode without render-phase updates', async () => {
    const selections = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    function StatefulStage() {
      const [focusId, setFocusId] = useState(null);
      const [stageState, setStageState] = useState({
        lighting: 'none',
        overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON' }] },
      });
      const handleSelect = (id) => {
        selections(id);
        setFocusId(id);
      };
      return <>
        <button
          onClick={() => setStageState((current) => ({
            ...current,
            overrides: { ...current.overrides, customTextItems: [] },
          }))}
          type="button"
        >
          Remove selected item externally
        </button>
        <ProductStage
          onPersonalizationSelect={handleSelect}
          onStatePatch={vi.fn()}
          personalizationFocusId={focusId}
          product={product}
          selected={selected}
          state={stageState}
        />
      </>;
    }

    render(<StrictMode><StatefulStage /></StrictMode>);
    act(() => rendererHarness.options.onPrintSelectionChange('text:custom-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected item externally' }));

    await waitFor(() => {
      expect(selections.mock.calls.filter(([id]) => id === null)).toHaveLength(1);
    });
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/render|different component|updat/i);
    consoleError.mockRestore();
  });

  it('copies mixed personalization items until both type limits are reached', async () => {
    let latestState;

    function StatefulStage() {
      const [stageState, setStageState] = useState({
        lighting: 'name-number',
        overrides: {
          printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', placement: { x: 0, y: 0.36, z: 0.5 } }],
          customTextItems: [{ id: 'text-1', text: 'MASON', placement: { x: 0, y: 0.64, z: 0.5 } }],
        },
      });
      latestState = stageState;
      return <ProductStage
        onStatePatch={(patch) => setStageState((current) => ({
          ...current,
          overrides: { ...current.overrides, ...patch.overrides },
        }))}
        product={product}
        selected={selected}
        state={stageState}
      />;
    }

    render(<StatefulStage />);
    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    for (let index = 0; index < 7; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));
      await waitFor(() => expect(latestState.overrides.printItems).toHaveLength(index + 2));
    }

    act(() => rendererHarness.options.onPrintSelectionChange('text:text-1'));
    for (let index = 0; index < 7; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));
      await waitFor(() => expect(latestState.overrides.customTextItems).toHaveLength(index + 2));
    }

    expect(latestState.overrides.printItems).toHaveLength(8);
    expect(latestState.overrides.customTextItems).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));
    expect(latestState.overrides.customTextItems).toHaveLength(8);
  });
});
