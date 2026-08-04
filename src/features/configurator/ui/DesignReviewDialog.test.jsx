import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DesignReviewDialog } from './DesignReviewDialog.jsx';

describe('DesignReviewDialog', () => {
  it('moves focus into the dialog and loops Tab in both directions', async () => {
    render(<ReviewFocusHarness />);
    const trigger = screen.getByRole('button', { name: 'Open review' });
    trigger.focus();
    fireEvent.click(trigger);

    const close = screen.getByRole('button', { name: 'Close review' });
    const last = screen.getByRole('button', { name: 'Add to Shopify cart' });
    await waitFor(() => expect(close).toHaveFocus());

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    trigger.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
  });

  it('places Turnstile before ordinary review actions and keeps the ordinary button focus trap', async () => {
    render(<ReviewFocusHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));
    const dialog = await screen.findByRole('dialog');
    const container = screen.getByRole('group', { name: 'Security verification' });
    const actions = screen.getByRole('button', { name: 'Continue editing' }).closest('.review-actions');

    expect(dialog).toContainElement(container);
    expect(container.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const close = screen.getByRole('button', { name: 'Close review' });
    const add = screen.getByRole('button', { name: 'Add to Shopify cart' });
    add.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(add).toHaveFocus();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    render(<ReviewFocusHarness />);
    const trigger = screen.getByRole('button', { name: 'Open review' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('restores focus to the trigger after the close button is used', async () => {
    render(<ReviewFocusHarness />);
    const trigger = screen.getByRole('button', { name: 'Open review' });
    trigger.focus();
    fireEvent.click(trigger);
    const close = await screen.findByRole('button', { name: 'Close review' });

    fireEvent.click(close);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

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

  it('disables and marks the cart action busy while a secure handoff is pending', () => {
    const props = {
      cartPending: true,
      onAddToCart: vi.fn(),
      onClose: () => {},
      onSave: () => {},
      open: true,
      product: { name: 'FN8788 Match Jersey', options: { templates: [] } },
      quote: { total: 107 },
      selected: {},
      shopifyContext: { shop: 'testcsj.myshopify.com', variantMap: { m: '48039101923479' } },
      state: { overrides: {} },
    };
    const { rerender } = render(<DesignReviewDialog {...props} />);

    const pending = screen.getByRole('button', { name: 'Preparing secure cart…' });
    const save = screen.getByRole('button', { name: 'Save design file' });
    expect(pending).toBeDisabled();
    expect(save).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(pending);
    expect(props.onAddToCart).not.toHaveBeenCalled();

    rerender(<DesignReviewDialog {...props} cartPending={false} />);
    const ready = screen.getByRole('button', { name: 'Add to Shopify cart' });
    expect(ready).toBeEnabled();
    expect(save).toBeEnabled();
    expect(ready).toHaveAttribute('aria-busy', 'false');
  });

  it('disables snapshot actions while a configuration mutation is pending', () => {
    const onAddToCart = vi.fn();
    const onSave = vi.fn();
    render(
      <DesignReviewDialog
        mutationPending
        onAddToCart={onAddToCart}
        onClose={() => {}}
        onSave={onSave}
        open
        product={{ name: 'FN8788 Match Jersey', options: { templates: [] } }}
        quote={{ total: 107 }}
        selected={{}}
        shopifyContext={{ shop: 'testcsj.myshopify.com', variantMap: { m: '48039101923479' } }}
        state={{ overrides: {} }}
      />,
    );

    const save = screen.getByRole('button', { name: 'Save design file' });
    const addToCart = screen.getByRole('button', { name: 'Add to Shopify cart' });
    expect(save).toBeDisabled();
    expect(addToCart).toBeDisabled();
    expect(addToCart).toHaveAttribute('aria-busy', 'false');
    fireEvent.click(save);
    fireEvent.click(addToCart);
    expect(onSave).not.toHaveBeenCalled();
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it('disables cart when the selected size has no Shopify variant', () => {
    const onAddToCart = vi.fn();
    render(
      <DesignReviewDialog
        cartError="The selected size is unavailable in Shopify. Choose another size."
        cartUnavailable
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

    const add = screen.getByRole('button', { name: 'Add to Shopify cart' });
    expect(add).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The selected size is unavailable in Shopify.');
    fireEvent.click(add);
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it('does not require a downloaded local production file before cart upload', () => {
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

    expect(screen.queryByText('Prepare the production ZIP, then use its download link before adding this design to the cart.')).not.toBeInTheDocument();
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
        quote={{ customizationTotal: 18, total: 107 }}
        selected={{
          colorway: { label: 'Away Black' },
          extras: [{ id: 'sleeveBadge', label: 'League sleeve badge' }],
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
            customTextItems: [
              { id: 'text-1', text: 'CHELSEA FC' },
              { id: 'text-2', text: '   ' },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText('FN8788 Match Jersey')).toBeInTheDocument();
    expect(screen.queryByText('Colorway')).not.toBeInTheDocument();
    expect(screen.queryByText('Print')).not.toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Player set')).toBeInTheDocument();
    expect(screen.getByText('Custom text')).toBeInTheDocument();
    expect(screen.getByText('1 item: CHELSEA FC')).toBeInTheDocument();
    expect(screen.queryByText(/text-2/i)).not.toBeInTheDocument();
    expect(screen.getByText('1 artwork item')).toBeInTheDocument();
    expect(screen.getByText('Extras')).toBeInTheDocument();
    expect(screen.getByText('League sleeve badge')).toBeInTheDocument();
    expect(screen.getByText('Customization subtotal')).toBeInTheDocument();
    expect(screen.getByText('$18')).toBeInTheDocument();
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

function ReviewFocusHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">Open review</button>
      <DesignReviewDialog
        onAddToCart={() => {}}
        onClose={() => setOpen(false)}
        onSave={() => {}}
        open={open}
        product={{ name: 'FN8788 Match Jersey', options: { templates: [] } }}
        quote={{ customizationTotal: 0, total: 89 }}
        selected={{}}
        shopifyContext={{ shop: 'testcsj.myshopify.com', variantMap: { m: '48039101923479' } }}
        state={{ overrides: {} }}
      />
    </>
  );
}
