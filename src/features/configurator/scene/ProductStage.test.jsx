import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductStage } from './ProductStage.jsx';

const rendererHarness = vi.hoisted(() => ({
  activePrintId: null,
  constructorError: null,
  rotationGestureEnds: [],
  rotationGestureStarts: [],
  rotationPreviews: [],
  rotationCancels: [],
  constrainedRotationItem: null,
  constrainedRotationPatches: [],
  finalRotationItem: null,
  finalResizeItem: null,
  resizePreviews: [],
  focusedDecorationId: null,
  instance: null,
  options: null,
  personalizationMutationDisabled: null,
  productionRequests: [],
  productionResult: null,
  updateError: null,
  normalizationForUpdate: null,
  updateArgs: null,
  viewCalls: [],
}));

function resolveLastStatePatch(onStatePatch, state) {
  const patch = onStatePatch.mock.calls.at(-1)[0];
  return typeof patch === 'function' ? patch(state) : patch;
}

vi.mock('./garmentRenderer.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    GarmentRenderer: class {
      constructor(host, options) {
        rendererHarness.options = options;
        rendererHarness.instance = this;
        if (rendererHarness.constructorError) throw rendererHarness.constructorError;
        this.onPrintAnchorChange = options.onPrintAnchorChange;
        this.onStateNormalize = options.onStateNormalize;
      }

      update(...args) {
        if (rendererHarness.updateError) throw rendererHarness.updateError;
        rendererHarness.updateArgs = args;
        const normalization = rendererHarness.normalizationForUpdate?.(args[1]);
        if (normalization) this.onStateNormalize?.(normalization);
        this.onPrintAnchorChange?.({ visible: true, left: 180, top: 220, width: 96, height: 54 });
      }

      setView(view) {
        rendererHarness.viewCalls.push(view);
      }

      setActivePrintId(id) {
        rendererHarness.activePrintId = id;
      }

      beginPersonalizationRotation(id) {
        rendererHarness.rotationGestureStarts.push(id);
      }

      endPersonalizationRotation(id, rotation) {
        rendererHarness.rotationGestureEnds.push([id, rotation]);
        return rendererHarness.finalRotationItem;
      }

      previewPersonalizationRotation(id, rotation) {
        rendererHarness.rotationPreviews.push([id, rotation]);
      }

      cancelPersonalizationRotationPreview() {
        rendererHarness.rotationCancels.push(true);
      }

      constrainPersonalizationItem(id, patch) {
        rendererHarness.constrainedRotationPatches.push([id, patch]);
        return typeof rendererHarness.constrainedRotationItem === 'function'
          ? rendererHarness.constrainedRotationItem(patch)
          : rendererHarness.constrainedRotationItem;
      }

      beginPersonalizationResize() {}

      previewPersonalizationScale(id, scale) {
        rendererHarness.resizePreviews.push([id, scale]);
      }

      endPersonalizationResize() {
        return rendererHarness.finalResizeItem;
      }

      cancelPersonalizationResizePreview() {}

      setPersonalizationMutationDisabled(disabled) {
        rendererHarness.personalizationMutationDisabled = disabled;
      }

      focusDecoration(id) {
        rendererHarness.focusedDecorationId = id;
      }

      prepareProductionArtifacts(request) {
        rendererHarness.productionRequests.push(request);
        return rendererHarness.productionResult;
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
  rendererHarness.constructorError = null;
  rendererHarness.rotationGestureEnds = [];
  rendererHarness.rotationGestureStarts = [];
  rendererHarness.rotationPreviews = [];
  rendererHarness.rotationCancels = [];
  rendererHarness.constrainedRotationItem = null;
  rendererHarness.constrainedRotationPatches = [];
  rendererHarness.finalRotationItem = null;
  rendererHarness.finalResizeItem = null;
  rendererHarness.resizePreviews = [];
  rendererHarness.focusedDecorationId = null;
  rendererHarness.instance = null;
  rendererHarness.options = null;
  rendererHarness.personalizationMutationDisabled = null;
  rendererHarness.productionRequests = [];
  rendererHarness.productionResult = null;
  rendererHarness.updateError = null;
  rendererHarness.normalizationForUpdate = null;
  rendererHarness.updateArgs = null;
  rendererHarness.viewCalls = [];
});

describe('ProductStage production provider', () => {
  it('registers the renderer provider and unregisters it on unmount', async () => {
    const onProductionProvider = vi.fn();
    rendererHarness.productionResult = Promise.resolve({ atlas: 'ready' });
    const state = { lighting: 'none', overrides: {} };
    const view = render(
      <ProductStage
        onProductionProvider={onProductionProvider}
        onStatePatch={vi.fn()}
        product={product}
        selected={selected}
        state={state}
      />,
    );
    const provider = onProductionProvider.mock.calls.at(-1)[0];
    const request = { model: { id: 'chelsea' }, stateSnapshot: state };

    await expect(provider(request)).resolves.toEqual({ atlas: 'ready' });
    expect(rendererHarness.productionRequests).toEqual([request]);

    view.unmount();
    expect(onProductionProvider).toHaveBeenLastCalledWith(null);
  });
});

describe('ProductStage renderer errors', () => {
  it.each(['constructor', 'update'])('reports a synchronous renderer %s error', (phase) => {
    const error = new Error(`${phase} failed`);
    rendererHarness[`${phase}Error`] = error;
    const onRendererError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ProductStage
        onRendererError={onRendererError}
        onStatePatch={vi.fn()}
        product={product}
        selected={selected}
        state={{ lighting: 'none', overrides: {} }}
      />,
    );

    expect(onRendererError).toHaveBeenCalledWith(error);
    consoleError.mockRestore();
  });

  it('uses the latest renderer error handler after the prop changes', () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const props = {
      onStatePatch: vi.fn(),
      product,
      selected,
      state: { lighting: 'none', overrides: {} },
    };
    const { rerender } = render(
      <ProductStage {...props} onRendererError={firstHandler} />,
    );

    act(() => rendererHarness.instance.onError(new Error('first error')));
    rerender(<ProductStage {...props} onRendererError={secondHandler} />);
    act(() => rendererHarness.instance.onError(new Error('second error')));

    expect(firstHandler).toHaveBeenCalledWith(expect.objectContaining({ message: 'first error' }));
    expect(secondHandler).toHaveBeenCalledWith(expect.objectContaining({ message: 'second error' }));
  });

  it('reports an unsupported renderer once and keeps the provider unavailable', () => {
    const onProductionProvider = vi.fn();
    const onRendererError = vi.fn();

    render(
      <StrictMode>
        <ProductStage
          onProductionProvider={onProductionProvider}
          onRendererError={onRendererError}
          onStatePatch={vi.fn()}
          product={{ ...product, renderer: 'missing' }}
          selected={selected}
          state={{ lighting: 'none', overrides: {} }}
        />
      </StrictMode>,
    );

    expect(onRendererError).toHaveBeenCalledTimes(1);
    expect(onRendererError).toHaveBeenCalledWith(expect.objectContaining({
      message: '当前产品的 3D 渲染器不可用。',
    }));
    expect(onProductionProvider).toHaveBeenLastCalledWith(null);
  });

  it('reports unavailable WebGL once and keeps the provider unavailable', () => {
    const WebGLRenderingContext = window.WebGLRenderingContext;
    const onProductionProvider = vi.fn();
    const onRendererError = vi.fn();
    vi.stubGlobal('WebGLRenderingContext', undefined);

    try {
      render(
        <StrictMode>
          <ProductStage
            onProductionProvider={onProductionProvider}
            onRendererError={onRendererError}
            onStatePatch={vi.fn()}
            product={product}
            selected={selected}
            state={{ lighting: 'none', overrides: {} }}
          />
        </StrictMode>,
      );

      expect(onRendererError).toHaveBeenCalledTimes(1);
      expect(onRendererError).toHaveBeenCalledWith(expect.objectContaining({
        message: '当前浏览器无法使用 3D 定制功能。',
      }));
      expect(onProductionProvider).toHaveBeenLastCalledWith(null);
    } finally {
      vi.stubGlobal('WebGLRenderingContext', WebGLRenderingContext);
    }
  });
});

describe('ProductStage print toolbar', () => {
  it('applies an initial back side-focus request after the renderer initializes', async () => {
    render(
      <ProductStage
        onStatePatch={vi.fn()}
        personalizationSideFocus={{ id: 1, side: 'back' }}
        product={product}
        selected={selected}
        state={{ lighting: 'none', overrides: {} }}
      />,
    );

    await waitFor(() => expect(rendererHarness.viewCalls.at(-1)).toBe('back'));
    expect(screen.getByTitle('Orbit view')).toHaveClass('active');
  });

  it('applies repeated requests for the same side when their ids change', async () => {
    const baseProps = {
      onStatePatch: vi.fn(),
      product,
      selected,
      state: { lighting: 'none', overrides: {} },
    };
    const { rerender } = render(
      <ProductStage
        {...baseProps}
        personalizationSideFocus={{ id: 1, side: 'back' }}
      />,
    );
    await waitFor(() => {
      expect(rendererHarness.viewCalls.filter((view) => view === 'back')).toHaveLength(1);
    });

    rerender(
      <ProductStage
        {...baseProps}
        personalizationSideFocus={{ id: 2, side: 'back' }}
      />,
    );

    await waitFor(() => {
      expect(rendererHarness.viewCalls.filter((view) => view === 'back')).toHaveLength(2);
    });
  });

  it.each([
    ['Orbit', 'orbit'],
    ['Top', 'top'],
    ['Detail', 'detail'],
  ])('reapplies the active %s toolbar view after a temporary side focus', async (label, view) => {
    const baseProps = {
      onStatePatch: vi.fn(),
      product,
      selected,
      state: { lighting: 'none', overrides: {} },
    };
    const { rerender } = render(<ProductStage {...baseProps} />);
    if (view !== 'orbit') {
      rendererHarness.viewCalls = [];
      fireEvent.click(screen.getByTitle(`${label} view`));
      await waitFor(() => expect(rendererHarness.viewCalls).toEqual([view]));
    }
    rendererHarness.viewCalls = [];

    rerender(
      <ProductStage
        {...baseProps}
        personalizationSideFocus={{ id: 1, side: 'back' }}
      />,
    );
    await waitFor(() => expect(rendererHarness.viewCalls.at(-1)).toBe('back'));
    rendererHarness.viewCalls = [];

    fireEvent.click(screen.getByTitle(`${label} view`));

    expect(rendererHarness.viewCalls).toEqual([view]);
    expect(screen.getByTitle(`${label} view`)).toHaveClass('active');
  });

  it('replays the current side-focus request when its renderer becomes available', async () => {
    const sideFocus = { id: 1, side: 'back' };
    const baseProps = {
      onStatePatch: vi.fn(),
      personalizationSideFocus: sideFocus,
      selected,
      state: { lighting: 'none', overrides: {} },
    };
    const { rerender } = render(
      <ProductStage {...baseProps} product={{ ...product, renderer: 'missing' }} />,
    );
    expect(rendererHarness.viewCalls).toEqual([]);

    rerender(<ProductStage {...baseProps} product={product} />);

    await waitFor(() => expect(rendererHarness.viewCalls.at(-1)).toBe('back'));
  });

  it('ignores an invalid side-focus request', () => {
    render(
      <ProductStage
        onStatePatch={vi.fn()}
        personalizationSideFocus={{ id: 1, side: 'left' }}
        product={product}
        selected={selected}
        state={{ lighting: 'none', overrides: {} }}
      />,
    );

    expect(rendererHarness.viewCalls).toEqual(['orbit']);
  });

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

  it('accumulates two queued five-degree rotations from the keyboard control', () => {
    const onStatePatch = vi.fn();
    rendererHarness.constrainedRotationItem = (patch) => ({
      ...patch,
      placement: { x: patch.rotation / 100, y: 0.36, z: 0.5 },
    });
    const state = { lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } };
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={state} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    const rotate = screen.getByRole('button', { name: 'Drag to rotate personalization' });
    fireEvent.keyDown(rotate, { key: 'ArrowLeft' });
    fireEvent.keyDown(rotate, { key: 'ArrowLeft' });

    let latestState = state;
    for (const [patch] of onStatePatch.mock.calls) {
      expect(patch).toEqual(expect.any(Function));
      const resolved = patch(latestState);
      latestState = {
        ...latestState,
        ...resolved,
        overrides: { ...latestState.overrides, ...resolved.overrides },
      };
    }
    expect(latestState.overrides.printItems[0].rotation).toBe(10);
    expect(latestState.overrides.printItems[0].placement).toEqual({ x: 0.1, y: 0.36, z: 0.5 });
    expect(rendererHarness.constrainedRotationPatches.map(([, patch]) => patch.rotation)).toEqual([5, 10]);
  });

  it('previews 60 drag moves transiently and commits the final rotation once', () => {
    const onStatePatch = vi.fn();
    const state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'custom-id',
          text: 'MASON',
          placement: { x: 0, y: 0.36, z: 0.5 },
          rotation: 0,
          scale: 1,
        }],
      },
    };
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={state} />);
    act(() => rendererHarness.options.onPrintSelectionChange('text:custom-id'));
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 29, clientX: 228, clientY: 190 });
    for (let index = 0; index < 60; index += 1) {
      fireEvent.pointerMove(handle, {
        pointerId: 29,
        clientX: 280 + index,
        clientY: 247 + (index % 7),
      });
    }
    expect(onStatePatch).not.toHaveBeenCalled();
    expect(rendererHarness.rotationPreviews).toHaveLength(60);
    fireEvent.pointerUp(handle, { pointerId: 29, clientX: 280, clientY: 247 });

    const finalRotation = resolveLastStatePatch(onStatePatch, state).overrides.customTextItems[0].rotation;
    expect(rendererHarness.rotationGestureStarts).toEqual(['text:custom-id']);
    expect(rendererHarness.rotationGestureEnds).toEqual([['text:custom-id', finalRotation]]);
    expect(onStatePatch).toHaveBeenCalledOnce();
  });

  it('commits the constrained rotation, scale, and placement atomically on release', () => {
    const onStatePatch = vi.fn();
    rendererHarness.finalRotationItem = {
      placement: { x: 0, y: 0.36, z: 0.5 },
      rotation: 15,
      scale: 1.0261,
    };
    const state = {
      lighting: 'none',
      overrides: {
        customTextItems: [{
          id: 'custom-id',
          text: 'MASON',
          placement: { x: 0, y: 0.36, z: 0.5 },
          rotation: 0,
          scale: 1.0676,
        }],
      },
    };
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={state} />);
    act(() => rendererHarness.options.onPrintSelectionChange('text:custom-id'));
    const handle = screen.getByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 81, clientX: 228, clientY: 190 });
    fireEvent.pointerMove(handle, { pointerId: 81, clientX: 280, clientY: 247 });
    expect(onStatePatch).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 81, clientX: 280, clientY: 247 });

    expect(onStatePatch).toHaveBeenCalledOnce();
    expect(resolveLastStatePatch(onStatePatch, state)).toEqual({
      overrides: {
        customTextItems: [expect.objectContaining({
          placement: { x: 0, y: 0.36, z: 0.5 },
          rotation: 15,
          scale: 1.0261,
        })],
      },
    });
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
    const state = { lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', placement: { x: 0, y: 0.36, z: 0.5 } }] } };
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={state} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));

    expect(resolveLastStatePatch(onStatePatch, state)).toEqual(expect.objectContaining({
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

  it('previews resize moves and commits the constrained scale once on release', () => {
    const onStatePatch = vi.fn();
    rendererHarness.finalResizeItem = {
      placement: { x: 0, y: 0.36, z: 0.5 },
      rotation: 0,
      scale: 1.0676,
    };
    const state = { lighting: 'name-number', overrides: { printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', scale: 1, rotation: 0 }] } };
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={state} />);

    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    const handle = screen.getByRole('button', { name: 'Resize personalization' });
    fireEvent.pointerDown(handle, { pointerId: 83, clientX: 10, clientY: 10 });
    for (let index = 0; index < 60; index += 1) {
      fireEvent.pointerMove(handle, { pointerId: 83, clientX: 50 + index, clientY: 10 });
    }
    expect(onStatePatch).not.toHaveBeenCalled();
    expect(rendererHarness.resizePreviews).toHaveLength(60);
    fireEvent.pointerUp(handle, { pointerId: 83, clientX: 109, clientY: 10 });

    expect(onStatePatch).toHaveBeenCalledOnce();
    expect(resolveLastStatePatch(onStatePatch, state)).toEqual(expect.objectContaining({
      overrides: expect.objectContaining({ printItems: [expect.objectContaining({ id: 'print-1', scale: 1.0676 })] }),
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
    const state = {
      lighting: 'none',
      overrides: { customTextItems: [{ id: 'custom-id', text: 'MASON', rotation: 0 }] },
    };
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={state} />);

    act(() => rendererHarness.options.onPrintSelectionChange('text:custom-id'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag to rotate personalization' }), { key: 'ArrowLeft' });

    expect(resolveLastStatePatch(onStatePatch, state)).toEqual({
      overrides: {
        customTextItems: [expect.objectContaining({ id: 'custom-id', rotation: 5 })],
      },
    });
  });

  it('does not let a late copy completion reclaim a newer personalization selection', async () => {
    const deferred = createDeferred();
    const onPersonalizationSelect = vi.fn();
    const state = {
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'print-1', name: 'PLAYER', number: '16', placement: { x: 0, y: 0.36, z: 0.5 } }],
        customTextItems: [{ id: 'text-1', text: 'MASON', placement: { x: 0.3, y: 0.36, z: 0.5 } }],
      },
    };
    const onStatePatch = vi.fn((patch) => {
      patch(state);
      return deferred.promise;
    });
    render(
      <ProductStage
        onPersonalizationSelect={onPersonalizationSelect}
        onStatePatch={onStatePatch}
        product={product}
        selected={selected}
        state={state}
      />,
    );
    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));
    act(() => rendererHarness.options.onPrintSelectionChange('text:text-1'));

    await act(async () => {
      deferred.resolve({ ok: true });
      await deferred.promise;
    });

    expect(rendererHarness.activePrintId).toBe('text:text-1');
    expect(onPersonalizationSelect).not.toHaveBeenCalledWith('player:print-2');
  });

  it('duplicates custom text away from every personalization placement and selects the copy', async () => {
    const onStatePatch = vi.fn();
    const state = {
      lighting: 'name-number',
      overrides: {
        printItems: [{ id: 'player-id', name: 'PLAYER', number: '16', placement: { x: 0.3, y: 0.36, z: 0.5 } }],
        customTextItems: [{ id: 'custom-id', text: 'MASON', placement: { x: 0, y: 0.36, z: 0.5 } }],
      },
    };
    render(<ProductStage onStatePatch={onStatePatch} product={product} selected={selected} state={state} />);

    act(() => rendererHarness.options.onPrintSelectionChange('text:custom-id'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate personalization' }));

    expect(resolveLastStatePatch(onStatePatch, state)).toEqual({
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
    expect(resolveLastStatePatch(onStatePatch, state)).toEqual({
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

  it('uses the current render callback when renderer update normalizes a newly loaded state', async () => {
    let latestState;
    rendererHarness.normalizationForUpdate = (state) => {
      const legacy = state.overrides.customTextItems?.find((item) => item.id === 'legacy');
      if (!legacy || legacy.scale !== 1.8) return null;
      return {
        overrides: {
          customTextItems: state.overrides.customTextItems.map((item) => (
            item.id === 'legacy'
              ? { ...item, placement: { x: 0, y: 0.36, z: 0.5 }, scale: 1.0271 }
              : item
          )),
        },
      };
    };

    function StatefulStage() {
      const [stageState, setStageState] = useState({
        colorway: 'home',
        layout: 'm',
        lighting: 'none',
        overrides: { customTextItems: [{ id: 'existing', text: 'KEEP ME', scale: 1 }] },
      });
      latestState = stageState;
      const onStatePatch = (patch) => setStageState({
        ...stageState,
        overrides: { ...stageState.overrides, ...patch.overrides },
      });
      return <>
        <button
          onClick={() => setStageState({
            colorway: 'third',
            layout: 'xl',
            lighting: 'none',
            overrides: {
              customTextItems: [
                { id: 'existing', text: 'KEEP ME', scale: 1 },
                {
                  id: 'legacy',
                  text: 'MASON',
                  placement: { x: 99, y: 99, z: 99 },
                  scale: 1.8,
                },
              ],
            },
          })}
          type="button"
        >
          Load legacy state
        </button>
        <ProductStage
          onStatePatch={onStatePatch}
          product={product}
          selected={selected}
          state={stageState}
        />
      </>;
    }

    render(<StatefulStage />);
    fireEvent.click(screen.getByRole('button', { name: 'Load legacy state' }));

    await waitFor(() => {
      expect(latestState.colorway).toBe('third');
      expect(latestState.layout).toBe('xl');
      expect(latestState.overrides.customTextItems).toEqual([
        expect.objectContaining({ id: 'existing', text: 'KEEP ME' }),
        expect.objectContaining({
          id: 'legacy',
          placement: { x: 0, y: 0.36, z: 0.5 },
          scale: 1.0271,
        }),
      ]);
    });
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
        onStatePatch={(patch) => setStageState((current) => {
          const resolvedPatch = typeof patch === 'function' ? patch(current) : patch;
          return {
            ...current,
            ...resolvedPatch,
            overrides: { ...current.overrides, ...resolvedPatch.overrides },
          };
        })}
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

function createDeferred() {
  let resolve;
  const promise = new Promise((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}
