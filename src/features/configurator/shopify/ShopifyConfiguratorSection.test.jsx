import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShopifyConfiguratorSection } from './ShopifyConfiguratorSection.jsx';

describe('ShopifyConfiguratorSection', () => {
  it('renders from section settings and syncs configuration to the native product form', async () => {
    document.body.innerHTML = `
      <form action="/cart/add" method="post">
        <input name="id" value="47824466051223">
      </form>
      <div id="mount"></div>
    `;

    render(
      <ShopifyConfiguratorSection
        settings={{
          heading: 'Build your jersey',
          subheading: 'Pick a size and finish before adding to cart.',
          defaultLayout: 'xl',
          defaultColorway: 'third',
          defaultMaterial: 'player',
          defaultLighting: 'name-number',
          modelUrl: '/assets/fn8788-jersey.glb',
          productHandle: 'balance-explorer',
          productId: '9611626905751',
          variantId: '47824466051223',
        }}
      />,
      { container: document.getElementById('mount') },
    );

    expect(await screen.findByText('Build your jersey')).toBeInTheDocument();
    expect(screen.getAllByText('$135').length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'FKK16' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '88' } });
    fireEvent.click(screen.getByRole('button', { name: /League sleeve badge/i }));

    await waitFor(() => {
      expect(document.querySelector('input[name="properties[Size]"]').value).toBe('Extra Large');
      expect(document.querySelector('input[name="properties[Colorway]"]').value).toBe('Third Green');
      expect(document.querySelector('input[name="properties[Fabric]"]').value).toBe('Player mesh');
      expect(document.querySelector('input[name="properties[Print]"]').value).toBe('Name set');
      expect(document.querySelector('input[name="properties[Print Name]"]').value).toBe('FKK16');
      expect(document.querySelector('input[name="properties[Print Number]"]').value).toBe('88');
      expect(document.querySelector('input[name="properties[Print Placement]"]').value).toContain('"x":0');
      expect(document.querySelector('input[name="properties[Extras]"]').value).toBe('League sleeve badge');
      expect(document.querySelector('input[name="properties[_3D Config JSON]"]').value).toContain('"productHandle":"balance-explorer"');
    });
  });

  it('serializes preset artwork into the native product form', async () => {
    document.body.innerHTML = `
      <form action="/cart/add" method="post"><input name="id" value="47824466051223"></form>
      <div id="mount"></div>
    `;

    render(<ShopifyConfiguratorSection />, { container: document.getElementById('mount') });

    expect(await screen.findByText('Customize your match jersey')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Golden Stripe/i }));

    await waitFor(() => {
      const config = JSON.parse(document.querySelector('input[name="properties[_3D Config JSON]"]').value);
      expect(config.state.overrides.decorations[0]).toMatchObject({
        kind: 'pattern',
        source: 'golden-stripe',
        region: 'front',
      });
    });
  });
});
