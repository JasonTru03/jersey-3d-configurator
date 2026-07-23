import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DesignReviewDialog } from './DesignReviewDialog.jsx';

describe('DesignReviewDialog', () => {
  it('shows a cart generation error inside the open review dialog', () => {
    function CartErrorHarness() {
      const [cartError, setCartError] = useState('');
      return (
        <DesignReviewDialog
          cartError={cartError}
          onAddToCart={() => setCartError('No Shopify variant exists for the selected size.')}
          onClose={() => {}}
          onSave={() => {}}
          open
          product={{ name: 'FN8788 Match Jersey', options: { templates: [] } }}
          quote={{ total: 107 }}
          selected={{}}
          shopifyContext={{ shop: 'testcsj.myshopify.com', variantMap: { m: '48039101923479' } }}
          state={{ overrides: {} }}
        />
      );
    }

    render(<CartErrorHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No Shopify variant exists for the selected size.');
  });

  it('adds the design to a connected Shopify cart at the displayed total', () => {
    const onAddToCart = vi.fn();
    render(
      <DesignReviewDialog
        onAddToCart={onAddToCart}
        onClose={() => {}}
        onSave={() => {}}
        open
        product={{ name: 'FN8788 Match Jersey', options: { templates: [] } }}
        quote={{ total: 107 }}
        selected={{}}
        shopifyContext={{ shop: 'testcsj.myshopify.com', variantMap: { m: '48039101923479' } }}
        state={{ overrides: {} }}
      />,
    );

    expect(screen.getByText('Shopify cart total: $107')).toBeInTheDocument();
    const addToCart = screen.getByRole('button', { name: 'Add to Shopify cart' });
    expect(addToCart).toBeEnabled();
    fireEvent.click(addToCart);
    expect(onAddToCart).toHaveBeenCalledWith();
  });

  it('explains that bottom-pattern production uses the downloaded local files', () => {
    render(
      <DesignReviewDialog
        onAddToCart={() => {}}
        onClose={() => {}}
        onSave={() => {}}
        open
        product={{ name: 'FN8788 Match Jersey', options: { templates: [] } }}
        quote={{ total: 107 }}
        selected={{}}
        shopifyContext={{ shop: 'testcsj.myshopify.com', variantMap: { m: '48039101923479' } }}
        state={{ overrides: { bottomPattern: { enabled: true } } }}
      />,
    );

    expect(screen.getByText('Prepare the production ZIP, then use its download link before adding this design to the cart.')).toBeInTheDocument();
  });

  it('explains when the configurator was not launched from Shopify', () => {
    render(
      <DesignReviewDialog
        onAddToCart={() => {}}
        onClose={() => {}}
        onSave={() => {}}
        open
        product={{ name: 'FN8788 Match Jersey', options: { templates: [] } }}
        quote={{ total: 107 }}
        selected={{}}
        shopifyContext={null}
        state={{ overrides: {} }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add to Shopify cart' })).toBeDisabled();
    expect(screen.getByText('Open the configurator from a connected Shopify product page to add this design to your cart.')).toBeInTheDocument();
  });

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
