import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopifyConfiguratorSection } from './ShopifyConfiguratorSection.jsx';

const rendererHarness = vi.hoisted(() => ({ focusedDecorationId: null, options: null }));

vi.mock('../scene/garmentRenderer.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    GarmentRenderer: class {
      constructor(host, options) {
        rendererHarness.options = options;
        this.onPrintAnchorChange = options.onPrintAnchorChange;
      }
      update() {
        this.onPrintAnchorChange?.({ visible: true, left: 180, top: 220, width: 96, height: 54 });
      }
      setActivePrintId() {}
      setView() {}
      focusDecoration(id) { rendererHarness.focusedDecorationId = id; }
      dispose() {}
    },
  };
});

beforeAll(() => {
  vi.stubGlobal('WebGLRenderingContext', class WebGLRenderingContext {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  rendererHarness.focusedDecorationId = null;
  rendererHarness.options = null;
});

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
    fireEvent.click(screen.getByRole('button', { name: /Crest Badge/i }));

    await waitFor(() => {
      const config = JSON.parse(document.querySelector('input[name="properties[_3D Config JSON]"]').value);
      expect(config.state.overrides.decorations[0]).toMatchObject({
        kind: 'badge',
        source: 'crest-badge',
        region: 'front',
      });
    });
  });

  it('forwards an artwork list click to the 3D stage without focusing on add', async () => {
    document.body.innerHTML = '<form action="/cart/add" method="post"><input name="id" value="47824466051223"></form><div id="mount"></div>';
    render(<ShopifyConfiguratorSection />, { container: document.getElementById('mount') });
    await screen.findByText('Customize your match jersey');

    fireEvent.click(screen.getByRole('button', { name: /^Crest Badge$/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Roundel Badge$/ }));
    expect(rendererHarness.focusedDecorationId).toBeNull();

    fireEvent.click(within(screen.getByLabelText('Added artwork')).getByRole('button', { name: 'Crest Badge' }));

    await waitFor(() => {
      expect(rendererHarness.focusedDecorationId).toMatch(/^preset-crest-badge-/);
    });
  });

  it('deletes the selected personalization through the Shopify 3D toolbar', async () => {
    document.body.innerHTML = '<form action="/cart/add" method="post"><input name="id" value="47824466051223"></form><div id="mount"></div>';
    render(
      <ShopifyConfiguratorSection settings={{ defaultLighting: 'name-number' }} />,
      { container: document.getElementById('mount') },
    );
    await screen.findByText('Customize your match jersey');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'DELETE ME' } });
    await waitFor(() => {
      expect(document.querySelector('input[name="properties[Print Name]"]').value).toBe('DELETE ME');
    });
    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete personalization' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete personalization' })).not.toBeInTheDocument();
      expect(document.querySelector('input[name="properties[Print Name]"]').value).toBe('');
    });
  });
});
