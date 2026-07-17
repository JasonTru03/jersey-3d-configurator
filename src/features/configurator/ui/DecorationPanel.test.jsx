import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
