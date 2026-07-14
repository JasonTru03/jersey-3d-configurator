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
        product={{ name: 'FN8788 Match Jersey' }}
        quote={{ total: 107 }}
        selected={{
          colorway: { label: 'Away Black' },
          extras: [{ id: 'sleeveBadge' }],
          layout: { shortLabel: 'M' },
          lighting: { shortLabel: 'Name set' },
          material: { shortLabel: 'Stadium knit' },
        }}
        state={{ overrides: { decorations: [{ id: 'crest' }] } }}
      />,
    );

    expect(screen.getByText('FN8788 Match Jersey')).toBeInTheDocument();
    expect(screen.getByText('1 artwork item')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
