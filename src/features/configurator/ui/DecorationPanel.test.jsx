import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDecoration } from '../config/decorations.js';
import { DecorationPanel } from './DecorationPanel.jsx';

const product = {
  decorationRegions: [{ id: 'front', label: 'Front' }],
  decorationPresets: [{
    id: 'crest',
    kind: 'badge',
    label: 'Crest Badge',
    source: 'crest',
    assetUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
  }],
};

describe('DecorationPanel', () => {
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
        state={{ overrides: { decorations, activeDecorationRegion: 'front' } }}
        updateState={updateState}
      />,
    );

    expect(screen.getByText('8 / 8 artwork slots used')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crest Badge' }));
    expect(screen.getByText('You can add up to 8 artworks. Remove one to continue.')).toBeInTheDocument();
    expect(updateState).not.toHaveBeenCalled();
  });
});
