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

    expect(updateState).toHaveBeenCalledWith({
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

      await waitFor(() => {
        expect(updateState).toHaveBeenCalledWith({
          overrides: {
            decorations: [expect.objectContaining({ kind: 'upload', region: 'front', source: result })],
            activeDecorationId: expect.any(String),
          },
        });
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

  it('shows the added artwork library and changes only the active artwork when selecting another item', () => {
    const updateState = vi.fn();
    const onArtworkSelect = vi.fn();
    const decorations = [
      createDecoration({ id: 'crest-1', kind: 'badge', source: 'crest', label: 'Crest Badge', region: 'front' }),
      createDecoration({ id: 'roundel-1', kind: 'badge', source: 'roundel', label: 'Roundel Badge', region: 'front' }),
    ];

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

    expect(updateState).toHaveBeenCalledWith({
      overrides: { decorations, activeDecorationId: 'roundel-1' },
    });
    expect(onArtworkSelect).toHaveBeenCalledWith('roundel-1');
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
    expect(updateState).toHaveBeenLastCalledWith({
      overrides: { decorations: [first], activeDecorationId: 'crest-1' },
    });

    fireEvent.click(within(library).getByRole('button', { name: 'Delete Crest Badge' }));
    expect(updateState).toHaveBeenLastCalledWith({
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
});
