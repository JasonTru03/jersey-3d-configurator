import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfiguratorPage } from './ConfiguratorPage.jsx';

describe('ConfiguratorPage', () => {
  it('loads the jersey product and updates the quote when an extra is toggled', async () => {
    render(<ConfiguratorPage />);

    expect(await screen.findByText('FN8788 Match Jersey')).toBeInTheDocument();
    expect(screen.getAllByText('$89').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Extras' }));
    fireEvent.click(screen.getByRole('button', { name: /League sleeve badge/i }));

    await waitFor(() => {
      expect(screen.getAllByText('$99').length).toBeGreaterThan(0);
    });
  });

  it('adds a preset decoration and exposes edit controls', async () => {
    render(<ConfiguratorPage />);

    expect(await screen.findByText('FN8788 Match Jersey')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Artwork' }));
    fireEvent.click(screen.getByRole('button', { name: /Golden Stripe/i }));

    expect(await screen.findByText('Golden Stripe added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete artwork' })).toBeInTheDocument();
  });
});
