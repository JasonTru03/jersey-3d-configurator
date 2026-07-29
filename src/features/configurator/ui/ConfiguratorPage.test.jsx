import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfiguratorPage, createLocalProductionFiles, shouldPrepareBottomPatternAsset } from './ConfiguratorPage.jsx';
import { productApi } from '../api/productApi.js';

const rendererHarness = vi.hoisted(() => ({
  configurationError: '',
  focusedDecorationId: null,
  options: null,
  personalizationMutationDisabled: null,
  updateStates: [],
  finalRotationItem: null,
  normalizationForUpdate: null,
}));
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
        this.onStateNormalize = options.onStateNormalize;
      }

      update(product, state) {
        rendererHarness.updateStates.push(structuredClone(state));
        const normalization = rendererHarness.normalizationForUpdate?.(state);
        if (normalization) this.onStateNormalize?.(normalization);
        this.onPrintAnchorChange?.({ visible: true, left: 180, top: 220, width: 96, height: 54 });
      }

      setActivePrintId() {}
      beginPersonalizationRotation() {}
      previewPersonalizationRotation() {}
      endPersonalizationRotation() { return rendererHarness.finalRotationItem; }
      cancelPersonalizationRotationPreview() {}
      beginPersonalizationResize() {}
      previewPersonalizationScale() {}
      endPersonalizationResize() {}
      cancelPersonalizationResizePreview() {}
      setPersonalizationMutationDisabled(disabled) {
        rendererHarness.personalizationMutationDisabled = disabled;
      }

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
  vi.useRealTimers();
  rendererHarness.focusedDecorationId = null;
  rendererHarness.options = null;
  rendererHarness.personalizationMutationDisabled = null;
  rendererHarness.updateStates = [];
  rendererHarness.finalRotationItem = null;
  rendererHarness.normalizationForUpdate = null;
  rendererHarness.configurationError = '';
  downloadClick.mockClear();
  URL.createObjectURL.mockClear();
  URL.revokeObjectURL.mockClear();
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(secureCartResponse()));
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
    expect(within(navigation).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
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

  it('locks panel and stage personalization mutations while a side update is pending', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await screen.findByLabelText('Name');
    const stageDelete = await screen.findByRole('button', { name: 'Delete personalization' });
    const quoteDeferred = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(quoteDeferred.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    try {
      await waitFor(() => {
        expect(rendererHarness.personalizationMutationDisabled).toBe(true);
        expect(screen.getByLabelText('Name')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add player set' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add text' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /^Delete player set/ })).toBeDisabled();
        expect(stageDelete).toBeDisabled();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Size' }));
      fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
      await waitFor(() => {
        expect(screen.getByLabelText('Name')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add text' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /^Delete player set/ })).toBeDisabled();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
      expect(quoteSpy).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        quoteDeferred.resolve({
          basePrice: 89,
          merchandisePrice: 89,
          customizationTotal: 18,
          optionAdjustments: [],
          total: 107,
          currency: 'USD',
        });
        await quoteDeferred.promise;
      });
      quoteSpy.mockRestore();
    }

    await waitFor(() => {
      expect(rendererHarness.personalizationMutationDisabled).toBe(false);
      expect(screen.getByLabelText('Name')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Add text' })).toBeEnabled();
      expect(stageDelete).toBeEnabled();
    });
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

  it('records one history entry for a many-move rotation gesture', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    await screen.findByLabelText('Text content');
    await waitFor(() => expect(rendererHarness.options).not.toBeNull());
    rendererHarness.finalRotationItem = {
      placement: { x: 0, y: 0.36, z: 0.5 },
      rotation: 15,
      scale: 1.0271,
    };
    act(() => rendererHarness.options.onPrintSelectionChange('text:text-1'));
    const handle = await screen.findByRole('button', { name: 'Drag to rotate personalization' });

    fireEvent.pointerDown(handle, { pointerId: 71, clientX: 228, clientY: 190 });
    for (let index = 0; index < 65; index += 1) {
      fireEvent.pointerMove(handle, {
        pointerId: 71,
        clientX: 280 + index,
        clientY: 247 + (index % 9),
      });
    }
    fireEvent.pointerUp(handle, { pointerId: 71, clientX: 344, clientY: 251 });

    await waitFor(() => expect(
      rendererHarness.updateStates.at(-1).overrides.customTextItems[0].rotation,
    ).not.toBe(0));
    const finalRotation = rendererHarness.updateStates.at(-1)
      .overrides.customTextItems[0].rotation;
    expect(rendererHarness.updateStates.at(-1).overrides.customTextItems[0].scale).toBe(1.0271);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(
      rendererHarness.updateStates.at(-1).overrides.customTextItems[0].rotation,
    ).toBe(0));
    expect(rendererHarness.updateStates.at(-1).overrides.customTextItems[0].scale).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(
      rendererHarness.updateStates.at(-1).overrides.customTextItems[0].rotation,
    ).toBe(finalRotation));
    expect(rendererHarness.updateStates.at(-1).overrides.customTextItems[0].scale).toBe(1.0271);
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

  it('loads and normalizes a legacy design without reverting its current options or quoting twice', async () => {
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration');
    rendererHarness.normalizationForUpdate = (state) => {
      const legacy = state.overrides.customTextItems?.find((item) => item.id === 'legacy');
      if (!legacy || legacy.scale !== 1.8) return null;
      return {
        overrides: {
          customTextItems: state.overrides.customTextItems.map((item) => (
            item.id === 'legacy'
              ? { ...item, placement: { x: 0, y: 0.36, z: 0.5 }, scale: 1.0271 }
              : item
          )),
        },
      };
    };
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    await waitFor(() => expect(rendererHarness.options).not.toBeNull());
    quoteSpy.mockClear();
    const file = new File([JSON.stringify({
      format: 'jersey-design',
      productId: 'fn8788-jersey',
      savedAt: '2026-07-24T00:00:00.000Z',
      version: 3,
      state: {
        colorway: 'third',
        layout: 'xl',
        lighting: 'name-number',
        overrides: {
          printItems: [{
            id: 'player',
            name: 'KEEP',
            number: '77',
            placement: { x: 0.25, y: 0.36, z: 0.5 },
          }],
          customTextItems: [{
            id: 'legacy',
            text: 'MASON',
            placement: { x: 99, y: 99, z: 99 },
            scale: 1.8,
          }],
        },
      },
    })], 'legacy-design.json', { type: 'application/json' });

    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [file] },
    });

    await waitFor(() => {
      const latest = rendererHarness.updateStates.at(-1);
      expect(latest.layout).toBe('xl');
      expect(latest.colorway).toBe('third');
      expect(latest.overrides.printItems[0]).toEqual(
        expect.objectContaining({ id: 'player', name: 'KEEP', number: '77' }),
      );
      expect(latest.overrides.customTextItems[0]).toEqual(
        expect.objectContaining({ id: 'legacy', scale: 1.0271 }),
      );
    });
    expect(quoteSpy).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    quoteSpy.mockRestore();
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
    expect(navigateToCart).toHaveBeenCalledWith(
      'https://testcsj.myshopify.com/apps/jersey-configurator/cart-handoff?token=test-token',
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body).productionFiles).toEqual({
      atlasFilename: 'fn8788-jersey-uv-atlas.png',
      atlasSha256: 'sha256:7c82602500857aa6ed0cf38c4c3e4ec645bdcaa82c00b9155eb08be100c778a9',
      bundleFilename: 'fn8788-jersey-production.zip',
      designFilename: 'fn8788-jersey-design.json',
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('requests a secure handoff without sending browser-computed pricing or variant maps', async () => {
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
      'https://testcsj.myshopify.com/apps/jersey-configurator/cart-handoff?token=test-token',
    ));
    const requestBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(requestBody.productionFiles).toBeNull();
    expect(Object.keys(requestBody).sort()).toEqual(['productionFiles', 'shop', 'state']);
    expect(JSON.stringify(requestBody)).not.toMatch(/quote|customizationTotal|variantMap|surchargeVariantMap/i);
  });

  it('keeps Review open with a finite Worker error and allows a retry', async () => {
    window.history.replaceState(
      null,
      '',
      '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&surchargeVariantMap=%7B%2210%22%3A%2249000000000010%22%7D&variantId=48039101923479',
    );
    fetch
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: 'Pricing changed. Reopen the Shopify product page.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(secureCartResponse());
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await waitFor(() => expect(screen.getAllByText('$107').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Pricing changed. Reopen the Shopify product page.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Shopify cart' })).toBeEnabled();
    expect(navigateToCart).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    await waitFor(() => expect(navigateToCart).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not navigate when secure handoff response validation fails', async () => {
    window.history.replaceState(
      null,
      '',
      '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&surchargeVariantMap=%7B%2218%22%3A%2248039101923479%22%7D&variantId=48039101923479',
    );
    fetch.mockResolvedValueOnce(secureCartResponse({
      handoffUrl: 'https://TARGET/apps/jersey-configurator/cart-handoff?token=stolen',
    }));
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await waitFor(() => expect(screen.getAllByText('$107').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Secure cart preparation failed.');
    expect(navigateToCart).not.toHaveBeenCalled();
  });

  it('allows only one cart quote request while the handoff is pending', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    let resolveRequest;
    fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    const add = screen.getByRole('button', { name: 'Add to Shopify cart' });

    fireEvent.click(add);
    fireEvent.click(add);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Preparing secure cart…' })).toBeDisabled();
    expect(navigateToCart).not.toHaveBeenCalled();

    resolveRequest(secureCartResponse());
    await waitFor(() => expect(navigateToCart).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Add to Shopify cart' })).toBeEnabled();
  });

  it('cancels a pending handoff when Review closes and ignores its late response', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    let resolveRequest;
    let requestSignal;
    fetch.mockImplementationOnce((_endpoint, options) => {
      requestSignal = options.signal;
      return new Promise((resolve) => { resolveRequest = resolve; });
    });
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));

    expect(requestSignal).toHaveProperty('aborted', true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    resolveRequest(secureCartResponse());
    await act(async () => { await Promise.resolve(); });
    expect(navigateToCart).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    expect(screen.getByRole('button', { name: 'Add to Shopify cart' })).toBeEnabled();
  });

  it('cancels a pending handoff when the design state identity changes', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    let resolveRequest;
    let requestSignal;
    fetch.mockImplementationOnce((_endpoint, options) => {
      requestSignal = options.signal;
      return new Promise((resolve) => { resolveRequest = resolve; });
    });
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    await act(async () => {
      await rendererHarness.options.onStatePatch({ overrides: { activeDecorationId: 'changed' } });
    });

    await waitFor(() => expect(requestSignal).toHaveProperty('aborted', true));
    expect(screen.getByRole('button', { name: 'Add to Shopify cart' })).toBeEnabled();
    resolveRequest(secureCartResponse());
    await act(async () => { await Promise.resolve(); });
    expect(navigateToCart).not.toHaveBeenCalled();
  });

  it('lets a new request supersede a cancelled request id without stale navigation', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    let resolveFirst;
    let resolveSecond;
    fetch
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    expect(fetch).toHaveBeenCalledTimes(2);

    resolveFirst(secureCartResponse({ handoffUrl: 'https://testcsj.myshopify.com/apps/jersey-configurator/cart-handoff?token=stale' }));
    await act(async () => { await Promise.resolve(); });
    expect(navigateToCart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Preparing secure cart…' })).toBeDisabled();

    resolveSecond(secureCartResponse());
    await waitFor(() => expect(navigateToCart).toHaveBeenCalledTimes(1));
  });

  it('restores the cart action with a retryable error after request timeout', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    fetch.mockImplementationOnce((_endpoint, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });

    expect(screen.getByRole('alert')).toHaveTextContent('Secure cart request timed out. Try again.');
    expect(screen.getByRole('button', { name: 'Add to Shopify cart' })).toBeEnabled();
    expect(navigateToCart).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not navigate or update state when a pending handoff resolves after unmount', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    let resolveRequest;
    fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const navigateToCart = vi.fn();
    const { unmount } = render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    expect(fetch).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveRequest(secureCartResponse());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigateToCart).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/state update.*unmounted|unmounted component/i);
    consoleError.mockRestore();
  });

  it('does not update state when a pending handoff rejects after unmount', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    let rejectRequest;
    fetch.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const navigateToCart = vi.fn();
    const { unmount } = render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    expect(fetch).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      rejectRequest(new Error('late network failure'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(navigateToCart).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/state update.*unmounted|unmounted component/i);
    consoleError.mockRestore();
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
    await waitFor(() => expect(rendererHarness.options).not.toBeNull());
    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit personalization' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Personalize' })).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toHaveValue('PLAYER');
    });
  });

  it('focuses the stable stage toolbar after 3D deletion and can recreate a player set', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await screen.findByLabelText('Name');
    await waitFor(() => expect(rendererHarness.options).not.toBeNull());
    act(() => rendererHarness.options.onPrintSelectionChange('player:print-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete personalization' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Edit personalization' })).not.toBeInTheDocument();
      expect(screen.getByTitle('Orbit view')).toHaveFocus();
    });
    await waitFor(() => expect(screen.getAllByText('$89').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));

    expect(await screen.findByLabelText('Name')).toHaveValue('PLAYER');
    await waitFor(() => expect(screen.getAllByText('$107').length).toBeGreaterThan(0));
  });
});

function secureCartResponse(overrides = {}) {
  return new Response(JSON.stringify({
    handoffUrl: 'https://testcsj.myshopify.com/apps/jersey-configurator/cart-handoff?token=test-token',
    designId: 'dsg_1234567890abcdef',
    bundleId: 'bun_1234567890abcdef',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createDeferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
