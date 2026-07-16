import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfiguratorPage } from './ConfiguratorPage.jsx';

describe('ConfiguratorPage', () => {
  it('loads the jersey product and updates the quote when an extra is toggled', async () => {
    render(<ConfiguratorPage />);

    expect(await screen.findByText('Chelsea Match Jersey')).toBeInTheDocument();
    expect(screen.getAllByText('$89').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Extras' }));
    fireEvent.click(screen.getByRole('button', { name: /League sleeve badge/i }));

    await waitFor(() => {
      expect(screen.getAllByText('$99').length).toBeGreaterThan(0);
    });
  });

  it('adds a preset decoration and exposes edit controls', async () => {
    render(<ConfiguratorPage />);

    expect(await screen.findByText('Chelsea Match Jersey')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Artwork' }));
    fireEvent.click(screen.getByRole('button', { name: /Golden Stripe/i }));

    expect(await screen.findByText('Golden Stripe added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete artwork' })).toBeInTheDocument();
  });

  it('lets a shopper undo an option change and open the design review', async () => {
    render(<ConfiguratorPage />);

    expect(await screen.findByText('Chelsea Match Jersey')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Colorway' }));
    fireEvent.click(screen.getByRole('button', { name: /Away Black/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Away Black/i })).toHaveAttribute('aria-pressed', 'true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Home White/i })).toHaveAttribute('aria-pressed', 'true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));

    expect(screen.getByRole('dialog', { name: 'Review your design' })).toBeInTheDocument();
  });

  it('focuses the name field when editing a selected print', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByRole('button', { name: /Name set/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit print' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveFocus();
    });
  });

  it('recreates a name set after its only print is deleted', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByRole('button', { name: /Name set/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete print' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Edit print' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Name set/i }));

    expect(await screen.findByRole('button', { name: 'Edit print' })).toBeInTheDocument();
  });
});
