import { fireEvent, render, screen } from '@testing-library/react';
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
