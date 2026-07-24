import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfiguratorPage, createLocalProductionFiles, shouldPrepareBottomPatternAsset } from './ConfiguratorPage.jsx';

const rendererHarness = vi.hoisted(() => ({ configurationError: '', focusedDecorationId: null, options: null }));
let downloadClick;

vi.mock('../hooks/useConfigurator.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useConfigurator: (...args) => ({
      ...actual.useConfigurator(...args),
      configurationError: rendererHarness.configurationError,
    }),
  };
});

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

      ensureLatestBottomPatternBake() {
        return {
          blob: new Blob(['atlas'], { type: 'image/png' }),
          metadata: { bakeKey: 'bottom-pattern-atlas:test', atlasSize: 2048 },
        };
      }

      focusDecoration(id) {
        rendererHarness.focusedDecorationId = id;
      }

      dispose() {}
    },
  };
});

beforeAll(() => {
  vi.stubGlobal('WebGLRenderingContext', class WebGLRenderingContext {});
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:local-production-file'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterAll(() => {
  downloadClick.mockRestore();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  rendererHarness.focusedDecorationId = null;
  rendererHarness.options = null;
  rendererHarness.configurationError = '';
  downloadClick.mockClear();
  URL.createObjectURL.mockClear();
  URL.revokeObjectURL.mockClear();
  window.history.replaceState(null, '', '/');
});

describe('ConfiguratorPage', () => {
  it('shows the six task-based navigation sections', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    const navigation = screen.getByRole('navigation', { name: 'Configurator sections' });
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Size',
      'Design',
      'Fabric',
      'Personalize',
      'Artwork',
      'Extras',
    ]);
    expect(within(navigation).queryByRole('button', { name: 'Colorway' })).not.toBeInTheDocument();
    expect(within(navigation).queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  });

  it('keeps jersey appearance controls together under Design', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Design' }));

    expect(screen.getByRole('region', { name: 'Jersey templates' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Zone colors' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Continuous bottom pattern' })).toBeInTheDocument();
  });

  it('adds custom text from Personalize and updates the total by eight dollars', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));

    await waitFor(() => expect(screen.getAllByText('$97').length).toBeGreaterThan(0));
    expect(await screen.findByLabelText('Text content')).toHaveValue('YOUR TEXT');
  });

  it('shows total and review action in a fixed footer instead of the top bar', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    const topbar = document.querySelector('.topbar');
    const panel = document.querySelector('.config-panel');
    const footer = screen.getByTestId('panel-checkout');
    const panelScroll = document.querySelector('.panel-scroll');

    expect(within(topbar).queryByRole('button', { name: 'Review design' })).not.toBeInTheDocument();
    expect(topbar.querySelector('.price-pill')).not.toBeInTheDocument();
    expect(panel.children[0]).toHaveClass('panel-header');
    expect(panel.children[1]).toBe(panelScroll);
    expect(panel.children[2]).toBe(footer);
    expect(footer).toHaveTextContent('$89');

    fireEvent.click(within(footer).getByRole('button', { name: 'Review design' }));
    expect(screen.getByRole('dialog', { name: 'Review your design' })).toBeInTheDocument();
  });

  it('updates the fixed footer price through add text, undo, and redo', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    await waitFor(() => expect(screen.getByTestId('panel-checkout')).toHaveTextContent('$97'));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByTestId('panel-checkout')).toHaveTextContent('$89'));

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(screen.getByTestId('panel-checkout')).toHaveTextContent('$97'));
  });

  it('shows the active design and fabric in the stage caption', async () => {
    render(<ConfiguratorPage />);

    expect(await screen.findByText('Solid / Stadium knit')).toBeInTheDocument();
  });

  it('announces configuration update errors', async () => {
    rendererHarness.configurationError = 'Custom text items must be an array.';
    render(<ConfiguratorPage />);

    const alert = await screen.findByRole('alert');
    const statusRegion = screen.getByRole('region', { name: 'Configurator status' });
    expect(alert).toHaveTextContent('Custom text items must be an array.');
    expect(statusRegion).toContainElement(alert);
    expect(statusRegion.parentElement).toHaveClass('app-shell');
    expect(statusRegion.parentElement.querySelector('.topbar')).toBeInTheDocument();
    expect(statusRegion.nextElementSibling).toHaveClass('workspace-grid');
  });

  it('keeps a prepared download in the status row above the main workspace', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    expect(screen.queryByRole('region', { name: 'Configurator status' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save design' }));

    const download = await screen.findByRole('link', { name: 'Download design JSON' });
    const statusRegion = screen.getByRole('region', { name: 'Configurator status' });
    expect(statusRegion).toContainElement(download);
    expect(statusRegion.nextElementSibling).toHaveClass('workspace-grid');
  });

  it('only requires a baked asset when the bottom pattern is enabled', () => {
    expect(shouldPrepareBottomPatternAsset({ overrides: { bottomPattern: { enabled: false } } })).toBe(false);
    expect(shouldPrepareBottomPatternAsset({ overrides: { bottomPattern: { enabled: true } } })).toBe(true);
  });

  it('prepares local production references without an upload URL or credential', async () => {
    await expect(createLocalProductionFiles({
      productId: 'fn8788-jersey',
      bake: { blob: new Blob(['atlas'], { type: 'image/png' }), metadata: { atlasSize: 2048 } },
    })).resolves.toMatchObject({
      atlasFilename: 'fn8788-jersey-uv-atlas.png',
      designFilename: 'fn8788-jersey-design.json',
      atlasSha256: 'sha256:7c82602500857aa6ed0cf38c4c3e4ec645bdcaa82c00b9155eb08be100c778a9',
    });
  });

  it('initializes the layout from the Shopify-selected XL variant', async () => {
    window.history.replaceState(
      null,
      '',
      '/?shop=testcsj.myshopify.com&variantMap=%7B%22s%22%3A%2248039101890711%22%2C%22m%22%3A%2248039101923479%22%2C%22l%22%3A%2248039101956247%22%2C%22xl%22%3A%2248039101989015%22%7D&variantId=48039101989015',
    );

    render(<ConfiguratorPage />);

    expect(await screen.findByText('Chelsea Match Jersey')).toBeInTheDocument();
    expect(document.querySelector('[data-option-group="layout"][data-option-id="xl"]'))
      .toHaveAttribute('aria-pressed', 'true');
  });

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
    fireEvent.click(screen.getByRole('button', { name: /Crest Badge/i }));

    expect(await screen.findByText('Crest Badge added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete artwork' })).toBeInTheDocument();
  });

  it('focuses the selected artwork only after a shopper clicks its list name', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Artwork' }));
    fireEvent.click(screen.getByRole('button', { name: /^Crest Badge$/ }));
    await waitFor(() => expect(within(screen.getByLabelText('Added artwork')).getByRole('button', { name: 'Crest Badge' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Roundel Badge$/ }));
    await waitFor(() => expect(within(screen.getByLabelText('Added artwork')).getByRole('button', { name: 'Crest Badge' })).toBeInTheDocument());
    expect(rendererHarness.focusedDecorationId).toBeNull();

    fireEvent.click(within(screen.getByLabelText('Added artwork')).getByRole('button', { name: 'Crest Badge' }));

    await waitFor(() => {
      expect(rendererHarness.focusedDecorationId).toMatch(/^preset-crest-badge-/);
    });
  });

  it('lets a shopper undo an option change and open the design review', async () => {
    render(<ConfiguratorPage />);

    expect(await screen.findByText('Chelsea Match Jersey')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Fabric' }));
    fireEvent.click(screen.getByRole('button', { name: /Player mesh/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Player mesh/i })).toHaveAttribute('aria-pressed', 'true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Stadium knit/i })).toHaveAttribute('aria-pressed', 'true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));

    expect(screen.getByRole('dialog', { name: 'Review your design' })).toBeInTheDocument();
  });

  it('blocks a patterned cart handoff until the production files are saved', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable continuous bottom pattern' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Enable continuous bottom pattern' })).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Save the current design before adding it to the Shopify cart.',
    );
    expect(navigateToCart).not.toHaveBeenCalled();
  });

  it('allows the saved patterned design to enter the cart with its production references', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable continuous bottom pattern' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Enable continuous bottom pattern' })).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'Save design' }));
    const productionDownload = await screen.findByRole('link', { name: 'Download production ZIP' });
    expect(productionDownload).toHaveAttribute('download', 'fn8788-jersey-production.zip');
    expect(downloadClick).not.toHaveBeenCalled();
    fireEvent.click(productionDownload);
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    await waitFor(() => expect(navigateToCart).toHaveBeenCalledTimes(1));
    expect(readCartProperties(navigateToCart.mock.calls[0][0])).toMatchObject({
        'Production Files': 'Local ZIP download',
        'Bundle File': 'fn8788-jersey-production.zip',
      'Design File': 'fn8788-jersey-design.json',
      'UV Atlas SHA-256': 'sha256:7c82602500857aa6ed0cf38c4c3e4ec645bdcaa82c00b9155eb08be100c778a9',
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('adds the jersey and exact customization surcharge for a 107-dollar quote', async () => {
    window.history.replaceState(
      null,
      '',
      '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&surchargeVariantMap=%7B%2218%22%3A%2249000000000018%22%7D&variantId=48039101923479',
    );
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await waitFor(() => expect(screen.getAllByText('$107').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));

    expect(screen.getByText('Shopify cart total: $107')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    await waitFor(() => expect(navigateToCart).toHaveBeenCalledWith(
      expect.stringContaining('/cart/48039101923479:1,49000000000018:1'),
    ));
  });

  it('blocks the cart after the saved patterned design changes', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable continuous bottom pattern' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Enable continuous bottom pattern' })).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'Save design' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Download production ZIP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(document.querySelector('[data-option-group="layout"][data-option-id="xl"]'));
    await waitFor(() => expect(document.querySelector('[data-option-group="layout"][data-option-id="xl"]')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The design changed after the production files were saved. Save the design again.',
    );
    expect(navigateToCart).not.toHaveBeenCalled();
  });

  it('preserves the selected template when a sleeves color change is undone', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diagonal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sleeves' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use #C84F3D' }));

    await waitFor(() => {
      expect(screen.getByText('#C84F3D')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      expect(screen.getByText('#F7F5EF')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Diagonal' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('opens the matching Personalize editor from the 3D toolbar', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await screen.findByLabelText('Name');
    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit personalization' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Personalize' })).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toHaveValue('PLAYER');
    });
  });

  it('focuses the element list after deletion and can recreate a player set', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await screen.findByLabelText('Name');
    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete personalization' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Edit personalization' })).not.toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Personalization elements' })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));

    expect(await screen.findByLabelText('Name')).toHaveValue('PLAYER');
    await waitFor(() => expect(screen.getAllByText('$107').length).toBeGreaterThan(0));
  });
});

function readCartProperties(url) {
  const encoded = new URL(url).searchParams.get('properties');
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  return JSON.parse(atob(base64));
}
