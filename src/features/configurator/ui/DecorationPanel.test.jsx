import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDecoration } from '../config/decorations.js';
import { jerseyProduct } from '../config/productDefinitions.js';
import { DecorationPanel } from './DecorationPanel.jsx';

const product = {
  decorationPresets: [{
    id: 'crest',
    kind: 'badge',
    label: 'Crest Badge',
    source: 'crest',
    assetUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
  }],
};

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('DecorationPanel', () => {
  function applyQueuedUpdates(initialState, updateState) {
    return updateState.mock.calls.reduce((latestState, [patch]) => {
      const resolved = typeof patch === 'function' ? patch(latestState) : patch;
      return {
        ...latestState,
        ...resolved,
        overrides: {
          ...latestState.overrides,
          ...resolved.overrides,
        },
      };
    }, initialState);
  }

  it('does not expose artwork region controls and creates presets on the front', () => {
    const updateState = vi.fn();

    render(
      <DecorationPanel
        product={product}
        state={{ overrides: { decorations: [] } }}
        updateState={updateState}
      />,
    );

    expect(screen.queryByLabelText('Artwork region')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Front' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Crest Badge' }));

    const patch = updateState.mock.lastCall[0];
    expect(patch).toEqual(expect.any(Function));
    expect(patch({ overrides: { decorations: [] } })).toEqual({
      overrides: {
        decorations: [expect.objectContaining({ label: 'Crest Badge', region: 'front' })],
        activeDecorationId: expect.any(String),
      },
    });
  });

  it('only exposes the two badge artwork presets', () => {
    expect(jerseyProduct).not.toHaveProperty('decorationRegions');
    expect(jerseyProduct.decorationPresets.map(({ id }) => id)).toEqual(['crest-badge', 'roundel-badge']);
  });

  it('uploads valid artwork onto the front and selects it', async () => {
    const updateState = vi.fn();
    const result = 'data:image/png;base64,uploaded-artwork';

    vi.stubGlobal('FileReader', class {
      readAsDataURL() {
        setTimeout(() => {
          this.result = result;
          this.onload();
        }, 0);
      }
    });

    try {
      const { container } = render(
        <DecorationPanel
          product={product}
          state={{ overrides: { decorations: [] } }}
          updateState={updateState}
        />,
      );
      const file = new File(['image-content'], 'crest.png', { type: 'image/png' });

      fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });

      await waitFor(() => expect(updateState).toHaveBeenCalledWith(expect.any(Function)));
      expect(updateState.mock.lastCall[0]({ overrides: { decorations: [] } })).toEqual({
        overrides: {
          decorations: [expect.objectContaining({ kind: 'upload', region: 'front', source: result })],
          activeDecorationId: expect.any(String),
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('explains the artwork limit instead of silently disabling preset selection', () => {
    const updateState = vi.fn();
    const decorations = Array.from({ length: 8 }, (_, index) => createDecoration({
      id: `badge-${index}`,
      kind: 'badge',
      source: 'crest',
      label: `Crest ${index}`,
      region: 'front',
    }));

    render(
      <DecorationPanel
        product={product}
        state={{ overrides: { decorations } }}
        updateState={updateState}
      />,
    );

    expect(screen.getByText('8 / 8 artwork slots used')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crest Badge' }));
    expect(screen.getByText('You can add up to 8 artworks. Remove one to continue.')).toBeInTheDocument();
    expect(updateState).not.toHaveBeenCalled();
  });

  it('shows the added artwork library and changes only the active artwork when selecting another item', async () => {
    const onArtworkSelect = vi.fn();
    const decorations = [
      createDecoration({ id: 'crest-1', kind: 'badge', source: 'crest', label: 'Crest Badge', region: 'front' }),
      createDecoration({ id: 'roundel-1', kind: 'badge', source: 'roundel', label: 'Roundel Badge', region: 'front' }),
    ];
    const updateState = vi.fn((patch) => Promise.resolve({
      ok: Boolean(patch({ overrides: { decorations, activeDecorationId: 'crest-1' } })),
    }));

    render(
      <DecorationPanel
        product={{
          decorationPresets: [
            { id: 'crest', source: 'crest', assetUrl: 'data:image/svg+xml,crest' },
            { id: 'roundel', source: 'roundel', assetUrl: 'data:image/svg+xml,roundel' },
          ],
        }}
        onArtworkSelect={onArtworkSelect}
        state={{ overrides: { decorations, activeDecorationId: 'crest-1' } }}
        updateState={updateState}
      />,
    );

    const library = screen.getByLabelText('Added artwork');
    expect(within(library).getByRole('button', { name: 'Crest Badge' })).toHaveAttribute('aria-pressed', 'true');
    expect(library.querySelector('img')).not.toBeInTheDocument();
    fireEvent.click(within(library).getByRole('button', { name: 'Roundel Badge' }));

    expect(updateState).toHaveBeenCalledWith(expect.any(Function));
    expect(updateState.mock.lastCall[0]({ overrides: { decorations, activeDecorationId: 'crest-1' } })).toEqual({
      overrides: { activeDecorationId: 'roundel-1' },
    });
    await waitFor(() => expect(onArtworkSelect).toHaveBeenCalledWith('roundel-1'));
    expect(updateState.mock.invocationCallOrder[0]).toBeLessThan(onArtworkSelect.mock.invocationCallOrder[0]);
  });

  it('clears the active artwork only when deleting the active library item', () => {
    const first = createDecoration({ id: 'crest-1', kind: 'badge', source: 'crest', label: 'Crest Badge', region: 'front' });
    const second = createDecoration({ id: 'roundel-1', kind: 'badge', source: 'roundel', label: 'Roundel Badge', region: 'front' });
    const updateState = vi.fn();
    const onArtworkSelect = vi.fn();

    render(
      <DecorationPanel
        product={{ decorationPresets: [] }}
        onArtworkSelect={onArtworkSelect}
        state={{ overrides: { decorations: [first, second], activeDecorationId: 'crest-1' } }}
        updateState={updateState}
      />,
    );

    const library = screen.getByLabelText('Added artwork');
    fireEvent.click(within(library).getByRole('button', { name: 'Delete Roundel Badge' }));
    expect(updateState.mock.lastCall[0]({
      overrides: { decorations: [first, second], activeDecorationId: 'crest-1' },
    })).toEqual({
      overrides: { decorations: [first], activeDecorationId: 'crest-1' },
    });

    fireEvent.click(within(library).getByRole('button', { name: 'Delete Crest Badge' }));
    expect(updateState.mock.lastCall[0]({
      overrides: { decorations: [first, second], activeDecorationId: 'crest-1' },
    })).toEqual({
      overrides: { decorations: [second], activeDecorationId: null },
    });
    expect(onArtworkSelect).not.toHaveBeenCalled();
  });

  it('moves only the active preset artwork to the back and clears its placement', async () => {
    const active = {
      ...createDecoration({
        id: 'crest-1',
        kind: 'badge',
        source: 'crest',
        label: 'Crest Badge',
        region: 'front',
      }),
      placement: { x: 0.2, y: 0.4, z: 0.5 },
    };
    const other = {
      ...createDecoration({
        id: 'roundel-1',
        kind: 'badge',
        source: 'roundel',
        label: 'Roundel Badge',
        region: 'front',
      }),
      placement: { x: -0.2, y: 0.3, z: 0.5 },
    };
    const updateState = vi.fn().mockResolvedValue({ ok: true });
    const onSideFocus = vi.fn();

    render(
      <DecorationPanel
        onSideFocus={onSideFocus}
        product={{ decorationPresets: [] }}
        state={{ overrides: { decorations: [active, other], activeDecorationId: active.id } }}
        updateState={updateState}
      />,
    );

    expect(screen.getByRole('button', { name: 'Front' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    const patch = updateState.mock.lastCall[0];
    expect(patch).toEqual(expect.any(Function));
    expect(patch({ overrides: { decorations: [active, other] } })).toEqual({
      overrides: {
        decorations: [
          expect.objectContaining({ id: active.id, placement: null, region: 'back' }),
          other,
        ],
      },
    });
    await waitFor(() => expect(onSideFocus).toHaveBeenCalledWith('back'));
  });

  it('moves an active uploaded artwork by sourceId without changing another artwork', async () => {
    const upload = {
      ...createDecoration({
        id: 'upload-1',
        kind: 'upload',
        source: 'data:image/png;base64,upload',
        label: 'upload.png',
        region: 'back',
      }),
      placement: { x: 0.1, y: 0.2, z: -0.5 },
    };
    const other = createDecoration({
      id: 'crest-1',
      kind: 'badge',
      source: 'crest',
      label: 'Crest Badge',
      region: 'front',
    });
    const selectedUpload = { ...upload, id: 'selected-upload', sourceId: upload.id };
    const updateState = vi.fn().mockResolvedValue({ ok: true });
    const onSideFocus = vi.fn();

    render(
      <DecorationPanel
        onSideFocus={onSideFocus}
        product={{ decorationPresets: [] }}
        state={{
          overrides: {
            decorations: [selectedUpload, other],
            activeDecorationId: selectedUpload.id,
          },
        }}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Front' }));
    const patch = updateState.mock.lastCall[0];
    expect(patch({
      overrides: {
        decorations: [upload, other],
      },
    })).toEqual({
      overrides: {
        decorations: [
          expect.objectContaining({ id: upload.id, placement: null, region: 'front' }),
          other,
        ],
      },
    });
    await waitFor(() => expect(onSideFocus).toHaveBeenCalledWith('front'));
  });

  it('prefers the active exact id without patching an artwork whose id collides with its alias', async () => {
    const active = {
      ...createDecoration({
        id: 'selected-upload',
        kind: 'upload',
        source: 'data:image/png;base64,upload',
        label: 'upload.png',
        region: 'front',
      }),
      sourceId: 'canonical-upload',
    };
    const aliasCollision = createDecoration({
      id: 'canonical-upload',
      kind: 'badge',
      source: 'crest',
      label: 'Crest Badge',
      region: 'front',
    });
    const updateState = vi.fn().mockResolvedValue({ ok: true });

    render(
      <DecorationPanel
        product={{ decorationPresets: [] }}
        state={{
          overrides: {
            decorations: [active, aliasCollision],
            activeDecorationId: active.id,
          },
        }}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    const patch = updateState.mock.lastCall[0];

    expect(patch({
      overrides: { decorations: [active, aliasCollision] },
    })).toEqual({
      overrides: {
        decorations: [
          expect.objectContaining({ id: active.id, region: 'back' }),
          aliasCollision,
        ],
      },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    });
  });

  it('keeps the latest decorations unchanged and does not focus when the target disappeared', async () => {
    const active = createDecoration({
      id: 'removed-upload',
      kind: 'upload',
      source: 'data:image/png;base64,upload',
      label: 'upload.png',
      region: 'front',
    });
    const remaining = createDecoration({
      id: 'remaining-crest',
      kind: 'badge',
      source: 'crest',
      label: 'Crest Badge',
      region: 'front',
    });
    let appliedPatch;
    const updateState = vi.fn((patch) => {
      appliedPatch = patch({
        overrides: { decorations: [remaining] },
      });
      return Promise.resolve({ ok: true });
    });
    const onSideFocus = vi.fn();

    render(
      <DecorationPanel
        onSideFocus={onSideFocus}
        product={{ decorationPresets: [] }}
        state={{
          overrides: {
            decorations: [active, remaining],
            activeDecorationId: active.id,
          },
        }}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    });
    expect(appliedPatch).toEqual({
      overrides: { decorations: [remaining] },
    });
    expect(onSideFocus).not.toHaveBeenCalled();
  });

  it('focuses the current derived side without updating or clearing placement', () => {
    const placement = { x: 0.25, y: 0.5, z: 0.48 };
    const active = {
      ...createDecoration({
        id: 'sleeve-1',
        kind: 'badge',
        source: 'crest',
        label: 'Sleeve Badge',
        region: 'left-sleeve',
      }),
      placement,
    };
    const updateState = vi.fn();
    const onSideFocus = vi.fn();

    render(
      <DecorationPanel
        onSideFocus={onSideFocus}
        product={{ decorationPresets: [] }}
        state={{ overrides: { decorations: [active], activeDecorationId: active.id } }}
        updateState={updateState}
      />,
    );

    expect(screen.getByRole('button', { name: 'Front' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Front' }));

    expect(updateState).not.toHaveBeenCalled();
    expect(onSideFocus).toHaveBeenCalledWith('front');
    expect(active.placement).toEqual(placement);
  });

  it('applies a side change to the latest decorations so a queued array update is preserved', () => {
    const active = createDecoration({
      id: 'upload-1',
      kind: 'upload',
      source: 'data:image/png;base64,upload',
      label: 'upload.png',
      region: 'front',
    });
    const other = createDecoration({
      id: 'crest-1',
      kind: 'badge',
      source: 'crest',
      label: 'Crest Badge',
      region: 'front',
    });
    const latestOther = { ...other, rotation: 45 };
    const updateState = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <DecorationPanel
        product={{ decorationPresets: [] }}
        state={{ overrides: { decorations: [active, other], activeDecorationId: active.id } }}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    const patch = updateState.mock.lastCall[0];
    expect(patch({
      overrides: { decorations: [active, latestOther] },
    })).toEqual({
      overrides: {
        decorations: [
          expect.objectContaining({ id: active.id, region: 'back' }),
          latestOther,
        ],
      },
    });
  });

  it('disables both sides while pending and does not focus when the update fails', async () => {
    const active = createDecoration({
      id: 'crest-1',
      kind: 'badge',
      source: 'crest',
      label: 'Crest Badge',
      region: 'front',
    });
    const deferred = createDeferred();
    const updateState = vi.fn().mockReturnValue(deferred.promise);
    const onSideFocus = vi.fn();

    render(
      <DecorationPanel
        onSideFocus={onSideFocus}
        product={{ decorationPresets: [] }}
        state={{ overrides: { decorations: [active], activeDecorationId: active.id } }}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Front' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(updateState).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve({ message: 'Quote failed', ok: false });
      await deferred.promise;
    });

    expect(onSideFocus).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Front' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });

  it('does not focus a stale artwork when the active selection changes while pending', async () => {
    const first = createDecoration({
      id: 'crest-1',
      kind: 'badge',
      source: 'crest',
      label: 'Crest Badge',
      region: 'front',
    });
    const second = createDecoration({
      id: 'upload-1',
      kind: 'upload',
      source: 'data:image/png;base64,upload',
      label: 'upload.png',
      region: 'front',
    });
    const deferred = createDeferred();
    const updateState = vi.fn().mockReturnValue(deferred.promise);
    const onSideFocus = vi.fn();
    const { rerender } = render(
      <DecorationPanel
        onSideFocus={onSideFocus}
        product={{ decorationPresets: [] }}
        state={{ overrides: { decorations: [first, second], activeDecorationId: first.id } }}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    rerender(
      <DecorationPanel
        onSideFocus={onSideFocus}
        product={{ decorationPresets: [] }}
        state={{ overrides: { decorations: [first, second], activeDecorationId: second.id } }}
        updateState={updateState}
      />,
    );

    await act(async () => {
      deferred.resolve({ ok: true });
      await deferred.promise;
    });

    expect(onSideFocus).not.toHaveBeenCalled();
  });

  it('does not focus after a pending artwork panel is hidden', async () => {
    const active = createDecoration({
      id: 'crest-1',
      kind: 'badge',
      source: 'crest',
      label: 'Crest Badge',
      region: 'front',
    });
    const deferred = createDeferred();
    const updateState = vi.fn().mockReturnValue(deferred.promise);
    const onSideFocus = vi.fn();
    const { unmount } = render(
      <DecorationPanel
        onSideFocus={onSideFocus}
        product={{ decorationPresets: [] }}
        state={{ overrides: { decorations: [active], activeDecorationId: active.id } }}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    unmount();

    await act(async () => {
      deferred.resolve({ ok: true });
      await deferred.promise;
    });

    expect(onSideFocus).not.toHaveBeenCalled();
  });

  it('accumulates two queued rotations against the latest artwork state', () => {
    const active = createDecoration({
      id: 'crest-1',
      kind: 'badge',
      source: 'crest',
      label: 'Crest Badge',
      region: 'front',
    });
    const state = { overrides: { decorations: [active], activeDecorationId: active.id } };
    const updateState = vi.fn();
    render(
      <DecorationPanel
        product={{ decorationPresets: [] }}
        state={state}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rotate right' }));

    expect(updateState.mock.calls.map(([patch]) => patch)).toEqual([
      expect.any(Function),
      expect.any(Function),
    ]);
    expect(applyQueuedUpdates(state, updateState).overrides.decorations[0].rotation).toBe(30);
  });

  it('does not resurrect either artwork when two queued deletions run', () => {
    const first = createDecoration({ id: 'crest-1', kind: 'badge', source: 'crest', label: 'Crest', region: 'front' });
    const second = createDecoration({ id: 'roundel-1', kind: 'badge', source: 'roundel', label: 'Roundel', region: 'front' });
    const state = { overrides: { decorations: [first, second], activeDecorationId: first.id } };
    const updateState = vi.fn();
    render(
      <DecorationPanel
        product={{ decorationPresets: [] }}
        state={state}
        updateState={updateState}
      />,
    );

    const library = screen.getByLabelText('Added artwork');
    fireEvent.click(within(library).getByRole('button', { name: 'Delete Crest' }));
    fireEvent.click(within(library).getByRole('button', { name: 'Delete Roundel' }));

    expect(applyQueuedUpdates(state, updateState).overrides.decorations).toEqual([]);
  });

  it('preserves an uploaded artwork when another queued artwork update follows it', () => {
    const state = { overrides: { decorations: [] } };
    const updateState = vi.fn();
    let finishRead;
    vi.stubGlobal('FileReader', class {
      readAsDataURL() {
        this.result = 'data:image/png;base64,uploaded';
        finishRead = () => this.onload();
      }
    });

    try {
      const { container } = render(
        <DecorationPanel
          product={product}
          state={state}
          updateState={updateState}
        />,
      );
      fireEvent.change(container.querySelector('input[type="file"]'), {
        target: { files: [new File(['image'], 'upload.png', { type: 'image/png' })] },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Crest Badge' }));
      finishRead();

      expect(applyQueuedUpdates(state, updateState).overrides.decorations).toEqual([
        expect.objectContaining({ label: 'Crest Badge' }),
        expect.objectContaining({ kind: 'upload' }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('enforces the artwork capacity inside two queued additions', () => {
    const decorations = Array.from({ length: 7 }, (_, index) => createDecoration({
      id: `badge-${index}`,
      kind: 'badge',
      source: 'crest',
      label: `Crest ${index}`,
      region: 'front',
    }));
    const state = { overrides: { decorations } };
    const updateState = vi.fn();
    render(
      <DecorationPanel
        product={product}
        state={state}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Crest Badge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crest Badge' }));

    expect(applyQueuedUpdates(state, updateState).overrides.decorations).toHaveLength(8);
  });

  it('does not focus artwork after its queued selection completes post-unmount', async () => {
    const deferred = createDeferred();
    const decoration = createDecoration({
      id: 'crest-1',
      kind: 'badge',
      source: 'crest',
      label: 'Crest',
      region: 'front',
    });
    const onArtworkSelect = vi.fn();
    const updateState = vi.fn((patch) => {
      patch({ overrides: { decorations: [decoration] } });
      return deferred.promise;
    });
    const { unmount } = render(
      <DecorationPanel
        onArtworkSelect={onArtworkSelect}
        product={{ decorationPresets: [] }}
        state={{ overrides: { decorations: [decoration] } }}
        updateState={updateState}
      />,
    );
    fireEvent.click(within(screen.getByLabelText('Added artwork')).getByRole('button', { name: 'Crest' }));
    unmount();

    await act(async () => {
      deferred.resolve({ ok: true });
      await deferred.promise;
    });

    expect(onArtworkSelect).not.toHaveBeenCalled();
  });

  it('does not focus a pending side after a newer library selection intent is queued', async () => {
    const firstQuote = createDeferred();
    const first = createDecoration({
      id: 'crest-1',
      kind: 'badge',
      source: 'crest',
      label: 'Crest',
      region: 'front',
    });
    const second = createDecoration({
      id: 'roundel-1',
      kind: 'badge',
      source: 'roundel',
      label: 'Roundel',
      region: 'front',
    });
    let latestState = {
      overrides: {
        decorations: [first, second],
        activeDecorationId: first.id,
      },
    };
    let queue = Promise.resolve();
    let callCount = 0;
    const updateState = vi.fn((patch) => {
      callCount += 1;
      const callNumber = callCount;
      const result = queue.then(async () => {
        const resolved = typeof patch === 'function' ? patch(latestState) : patch;
        latestState = {
          ...latestState,
          ...resolved,
          overrides: { ...latestState.overrides, ...resolved.overrides },
        };
        if (callNumber === 1) await firstQuote.promise;
        return { ok: true };
      });
      queue = result;
      return result;
    });
    const onArtworkSelect = vi.fn();
    const onSideFocus = vi.fn();
    render(
      <DecorationPanel
        onArtworkSelect={onArtworkSelect}
        onSideFocus={onSideFocus}
        product={{ decorationPresets: [] }}
        state={latestState}
        updateState={updateState}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(within(screen.getByLabelText('Added artwork')).getByRole('button', { name: 'Roundel' }));
    expect(updateState).toHaveBeenCalledTimes(2);

    await act(async () => {
      firstQuote.resolve();
      await queue;
    });

    expect(onSideFocus).not.toHaveBeenCalled();
    expect(onArtworkSelect).toHaveBeenCalledWith(second.id);
    expect(latestState.overrides.activeDecorationId).toBe(second.id);
  });
});
