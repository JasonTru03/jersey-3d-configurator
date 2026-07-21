import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DesignReviewDialog } from './DesignReviewDialog.jsx';

describe('DesignReviewDialog', () => {
  it('summarizes the design and sends the shopper back to editing', () => {
    const onClose = vi.fn();
    render(
      <DesignReviewDialog
        onClose={onClose}
        onSave={() => {}}
        open
        product={{
          name: 'FN8788 Match Jersey',
          options: { templates: [{ id: 'vertical-stripes', label: 'Vertical Stripes' }] },
        }}
        quote={{ total: 107 }}
        selected={{
          colorway: { label: 'Away Black' },
          extras: [{ id: 'sleeveBadge' }],
          layout: { shortLabel: 'M' },
          lighting: { shortLabel: 'Name set' },
          material: { shortLabel: 'Stadium knit' },
        }}
        state={{
          overrides: {
            appearance: {
              template: 'vertical-stripes',
              colors: {
                body: '#FFFFFF',
                sleeves: '#20242A',
                shoulderSide: '#1F5B4F',
                collar: '#F4EFE4',
                pattern: '#D1B05D',
                number: '#FFCC00',
              },
            },
            decorations: [{ id: 'crest' }],
          },
        }}
      />,
    );

    expect(screen.getByText('FN8788 Match Jersey')).toBeInTheDocument();
    expect(screen.getByText('1 artwork item')).toBeInTheDocument();
    expect(screen.getByText('Vertical Stripes')).toBeInTheDocument();
    expect(screen.getByText('Body: #FFFFFF')).toBeInTheDocument();
    expect(screen.getByText('Sleeves: #20242A')).toBeInTheDocument();
    expect(screen.getByText('Shoulder and side panels: #1F5B4F')).toBeInTheDocument();
    expect(screen.getByText('Collar: #F4EFE4')).toBeInTheDocument();
    expect(screen.getByText('Pattern: #D1B05D')).toBeInTheDocument();
    expect(screen.getByText('Name and number: #FFCC00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
