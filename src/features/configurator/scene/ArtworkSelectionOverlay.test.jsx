import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArtworkSelectionOverlay } from './ArtworkSelectionOverlay.jsx';

describe('ArtworkSelectionOverlay', () => {
  it('renders a visible artwork selection frame using pixel bounds without accepting pointer events', () => {
    render(<ArtworkSelectionOverlay anchor={{ visible: true, left: 180, top: 220, width: 96, height: 54 }} />);

    expect(screen.getByTestId('artwork-selection-frame')).toHaveStyle({
      left: '180px',
      top: '220px',
      width: '96px',
      height: '54px',
      pointerEvents: 'none',
    });
  });

  it('does not render when the artwork anchor is not visible', () => {
    render(<ArtworkSelectionOverlay anchor={{ visible: false }} />);

    expect(screen.queryByTestId('artwork-selection-frame')).not.toBeInTheDocument();
  });
});
