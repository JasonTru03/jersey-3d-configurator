import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
});
