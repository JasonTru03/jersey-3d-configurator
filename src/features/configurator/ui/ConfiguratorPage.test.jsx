import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfiguratorPage } from './ConfiguratorPage.jsx';
import { productApi } from '../api/productApi.js';

const rendererHarness = vi.hoisted(() => ({
  bakeResult: null,
  configurationError: '',
  constructorError: null,
  focusedDecorationId: null,
  options: null,
  personalizationMutationDisabled: null,
  productionRequests: [],
  productionResult: null,
  updateStates: [],
  finalRotationItem: null,
  normalizationForUpdate: null,
  viewCalls: [],
}));
const productionPackageHarness = vi.hoisted(() => ({
  events: [],
  requests: [],
  result: null,
}));
const cloudDraftHarness = vi.hoisted(() => ({
  tokenRequests: [],
  tokenResult: null,
  uploadRequests: [],
  uploadResult: null,
}));
let downloadClick;

vi.mock('../designs/productionPackage.js', () => ({
  createProductionPackage: vi.fn(async (request) => {
    productionPackageHarness.events.push('package');
    productionPackageHarness.requests.push(request);
    if (typeof productionPackageHarness.result === 'function') {
      return productionPackageHarness.result(request);
    }
    return productionPackageHarness.result;
  }),
}));

vi.mock('../api/turnstile.js', () => ({
  getDesignUploadTurnstileToken: vi.fn(async (request) => {
    productionPackageHarness.events.push('turnstile');
    cloudDraftHarness.tokenRequests.push(request);
    if (typeof cloudDraftHarness.tokenResult === 'function') {
      return cloudDraftHarness.tokenResult(request);
    }
    return cloudDraftHarness.tokenResult;
  }),
}));

vi.mock('../api/productionDraftApi.js', () => ({
  uploadProductionDraft: vi.fn(async (request) => {
    productionPackageHarness.events.push('upload');
    cloudDraftHarness.uploadRequests.push(request);
    if (typeof cloudDraftHarness.uploadResult === 'function') {
      return cloudDraftHarness.uploadResult(request);
    }
    return cloudDraftHarness.uploadResult;
  }),
}));

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
        if (rendererHarness.constructorError) throw rendererHarness.constructorError;
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

      setView(view) {
        rendererHarness.viewCalls.push(view);
      }

      ensureLatestBottomPatternBake() {
        return rendererHarness.bakeResult ?? {
          blob: new Blob(['atlas'], { type: 'image/png' }),
          metadata: { bakeKey: 'bottom-pattern-atlas:test', atlasSize: 2048 },
        };
      }

      prepareProductionArtifacts(request) {
        rendererHarness.productionRequests.push(request);
        if (typeof rendererHarness.productionResult === 'function') {
          return rendererHarness.productionResult(request);
        }
        return rendererHarness.productionResult;
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
  rendererHarness.bakeResult = null;
  rendererHarness.constructorError = null;
  rendererHarness.focusedDecorationId = null;
  rendererHarness.options = null;
  rendererHarness.personalizationMutationDisabled = null;
  rendererHarness.productionRequests = [];
  rendererHarness.productionResult = null;
  rendererHarness.updateStates = [];
  rendererHarness.finalRotationItem = null;
  rendererHarness.normalizationForUpdate = null;
  rendererHarness.configurationError = '';
  rendererHarness.viewCalls = [];
  productionPackageHarness.requests = [];
  productionPackageHarness.events = [];
  productionPackageHarness.result = createProductionResult();
  cloudDraftHarness.tokenRequests = [];
  cloudDraftHarness.tokenResult = 'verified-turnstile-token';
  cloudDraftHarness.uploadRequests = [];
  cloudDraftHarness.uploadResult = createProductionDraftResult();
  downloadClick.mockClear();
  URL.createObjectURL.mockClear();
  URL.revokeObjectURL.mockClear();
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(secureCartResponse()));
});

describe('ConfiguratorPage', () => {
  it('shows a renderer error in the user-visible alert', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    await getReadySaveButton();

    expect(rendererHarness.options.onError).toBeTypeOf('function');
    act(() => rendererHarness.options.onError(new Error('服装模型加载失败。')));

    expect(screen.getByRole('alert')).toHaveTextContent('服装模型加载失败。');
  });

  it('keeps save disabled while the renderer production provider is unavailable', async () => {
    rendererHarness.constructorError = new Error('renderer unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    const save = screen.getByRole('button', { name: 'Save design' });
    expect(save).toBeDisabled();
    expect(await screen.findByRole('alert')).toHaveTextContent('renderer unavailable');
    fireEvent.click(save);
    expect(productionPackageHarness.requests).toHaveLength(0);
    consoleError.mockRestore();
  });

  it('shows an unavailable renderer alert and keeps save disabled', async () => {
    const definition = await productApi.getProductDefinition('fn8788-jersey');
    const definitionSpy = vi.spyOn(productApi, 'getProductDefinition').mockResolvedValueOnce({
      ...definition,
      renderer: 'missing',
    });

    try {
      render(<ConfiguratorPage />);
      await screen.findByText('Chelsea Match Jersey');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        '当前产品的 3D 渲染器不可用。',
      );
      expect(screen.getByRole('button', { name: 'Save design' })).toBeDisabled();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    } finally {
      definitionSpy.mockRestore();
    }
  });

  it('shows a WebGL unavailable alert and keeps save disabled', async () => {
    const WebGLRenderingContext = window.WebGLRenderingContext;
    vi.stubGlobal('WebGLRenderingContext', undefined);

    try {
      render(<ConfiguratorPage />);
      await screen.findByText('Chelsea Match Jersey');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        '当前浏览器无法使用 3D 定制功能。',
      );
      expect(screen.getByRole('button', { name: 'Save design' })).toBeDisabled();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    } finally {
      vi.stubGlobal('WebGLRenderingContext', WebGLRenderingContext);
    }
  });

  it('shows a Chinese fallback for an unknown renderer error', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    await getReadySaveButton();

    act(() => rendererHarness.options.onError({ message: '   ' }));

    expect(screen.getByRole('alert')).toHaveTextContent('3D 服装预览加载失败，请稍后重试。');
  });

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

  it('keeps only the simple jersey appearance controls under Design', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Design' }));

    expect(screen.getByRole('region', { name: 'Jersey templates' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Zone colors' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Continuous bottom pattern' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Enable continuous bottom pattern' }),
    ).not.toBeInTheDocument();
  });

  it('adds custom text from Personalize and updates the total by eight dollars', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));

    await waitFor(() => expect(screen.getAllByText('$97').length).toBeGreaterThan(0));
    expect(await screen.findByLabelText('Text content')).toHaveValue('YOUR TEXT');
  });

  it('focuses the back camera for two consecutive current-side player requests', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await screen.findByLabelText('Name');
    rendererHarness.viewCalls = [];

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-pressed', 'true');
      expect(rendererHarness.viewCalls.filter((view) => view === 'back')).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => {
      expect(rendererHarness.viewCalls.filter((view) => view === 'back')).toHaveLength(2);
    });
  });

  it('focuses the requested side when artwork changes side', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Artwork' }));
    fireEvent.click(screen.getByRole('button', { name: /^Crest Badge$/ }));
    await screen.findByText('Crest Badge added');
    rendererHarness.viewCalls = [];

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => {
      expect(rendererHarness.viewCalls).toContain('back');
    });
  });

  it('queues ordinary configuration updates while a side update keeps personalization and snapshot actions locked', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await screen.findByLabelText('Name');
    const stageDelete = await screen.findByRole('button', { name: 'Delete personalization' });
    const sideQuote = createDeferred();
    const layoutQuote = createDeferred();
    const quoteResponse = {
      basePrice: 89,
      merchandisePrice: 89,
      customizationTotal: 18,
      optionAdjustments: [],
      total: 107,
      currency: 'USD',
    };
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(sideQuote.promise)
      .mockReturnValueOnce(layoutQuote.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    try {
      await waitFor(() => {
        expect(rendererHarness.personalizationMutationDisabled).toBe(true);
        expect(screen.getByLabelText('Name')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add player set' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add text' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /^Delete player set/ })).toBeDisabled();
        expect(stageDelete).toBeDisabled();
        expect(document.querySelector('.config-panel')).not.toHaveAttribute('aria-busy');
        expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Open design' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Save design' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Review design' })).toBeDisabled();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Save design' }));
      fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
      expect(screen.queryByRole('link', { name: 'Download design JSON' })).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Review your design' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Size' }));
      const xl = document.querySelector('[data-option-group="layout"][data-option-id="xl"]');
      fireEvent.click(xl);
      expect(xl).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
      await waitFor(() => {
        expect(screen.getByLabelText('Name')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Add text' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /^Delete player set/ })).toBeDisabled();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
      expect(quoteSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        sideQuote.resolve(quoteResponse);
        await sideQuote.promise;
      });
      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(rendererHarness.personalizationMutationDisabled).toBe(false);
        expect(screen.getByLabelText('Name')).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Save design' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Review design' })).toBeDisabled();
      });

      await act(async () => {
        layoutQuote.resolve(quoteResponse);
        await layoutQuote.promise;
      });
    } finally {
      await act(async () => {
        sideQuote.resolve(quoteResponse);
        layoutQuote.resolve(quoteResponse);
        await Promise.allSettled([sideQuote.promise, layoutQuote.promise]);
      });
      quoteSpy.mockRestore();
    }

    await waitFor(() => {
      expect(rendererHarness.personalizationMutationDisabled).toBe(false);
      expect(screen.getByLabelText('Name')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Add text' })).toBeEnabled();
      expect(stageDelete).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Open design' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Save design' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Review design' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    await waitFor(() => {
      expect(document.querySelector('[data-option-group="layout"][data-option-id="xl"]'))
        .toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('preserves a queued drag transform when a later player side change runs', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await screen.findByLabelText('Name');
    const currentItems = structuredClone(
      rendererHarness.updateStates.at(-1).overrides.printItems,
    );
    const quoteDeferred = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(quoteDeferred.promise);
    let dragUpdate;

    try {
      act(() => {
        dragUpdate = rendererHarness.options.onStatePatch({
          overrides: {
            printItems: currentItems.map((item) => (
              item.id === 'print-1' ? { ...item, rotation: 37 } : item
            )),
          },
        });
      });
      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(quoteSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        quoteDeferred.resolve({
          basePrice: 89,
          merchandisePrice: 89,
          customizationTotal: 18,
          optionAdjustments: [],
          total: 107,
          currency: 'USD',
        });
        await dragUpdate;
      });
      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(2));
    } finally {
      quoteDeferred.resolve({
        basePrice: 89,
        merchandisePrice: 89,
        customizationTotal: 18,
        optionAdjustments: [],
        total: 107,
        currency: 'USD',
      });
      await Promise.allSettled([quoteDeferred.promise, dragUpdate]);
      quoteSpy.mockRestore();
    }

    await waitFor(() => {
      const player = rendererHarness.updateStates.at(-1).overrides.printItems
        .find((item) => item.id === 'print-1');
      expect(player.rotation).toBe(37);
      expect(player.placement).toMatchObject({
        normal: { x: 0, y: 0, z: -1 },
        x: 0,
        y: 0.36,
        z: -0.5,
      });
    });
  });

  it('restores snapshot actions when a side update fails', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Personalize' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await screen.findByLabelText('Name');
    const quoteDeferred = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(quoteDeferred.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    try {
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Open design' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Save design' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Review design' })).toBeDisabled();
      });
      await act(async () => {
        quoteDeferred.reject(new Error('Side update failed.'));
        await expect(quoteDeferred.promise).rejects.toThrow('Side update failed.');
      });
    } finally {
      quoteSpy.mockRestore();
    }

    await waitFor(() => {
      expect(rendererHarness.personalizationMutationDisabled).toBe(false);
      expect(screen.getByRole('button', { name: 'Front' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Open design' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Save design' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Review design' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    expect(screen.getByRole('dialog', { name: 'Review your design' })).toBeInTheDocument();
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

    fireEvent.click(await getReadySaveButton());

    const download = await screen.findByRole('link', { name: 'Download production ZIP' });
    const statusRegion = screen.getByRole('region', { name: 'Configurator status' });
    expect(statusRegion).toContainElement(download);
    expect(statusRegion.nextElementSibling).toHaveClass('workspace-grid');
    expect(download).toHaveAttribute('download', 'fn8788-jersey-design-12ab34cd.zip');
    expect(productionPackageHarness.requests).toHaveLength(1);
    expect(productionPackageHarness.requests[0]).toEqual(expect.objectContaining({
      artifactProvider: expect.any(Function),
      product: expect.objectContaining({ id: 'fn8788-jersey' }),
      state: expect.objectContaining({ layout: 'm' }),
      variantId: null,
    }));
  });

  it('keeps the registered production provider stable across save rerenders', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    const save = await getReadySaveButton();
    fireEvent.click(save);
    await screen.findByRole('link', { name: 'Download production ZIP' });
    const firstProvider = productionPackageHarness.requests[0].artifactProvider;

    fireEvent.click(save);
    await waitFor(() => expect(productionPackageHarness.requests).toHaveLength(2));

    expect(firstProvider).toEqual(expect.any(Function));
    expect(productionPackageHarness.requests[1].artifactProvider).toBe(firstProvider);
  });

  it('keeps Save disabled until Atlas, pieces, PDF, and ZIP generation all finish', async () => {
    const atlasDeferred = createDeferred();
    const piecesDeferred = createDeferred();
    const pdfDeferred = createDeferred();
    const zipDeferred = createDeferred();
    rendererHarness.productionResult = async () => {
      await atlasDeferred.promise;
      await piecesDeferred.promise;
      return { atlas: {}, pieces: {}, previews: {} };
    };
    productionPackageHarness.result = async (request) => {
      await request.artifactProvider({ model: {}, stateSnapshot: {} });
      await pdfDeferred.promise;
      await zipDeferred.promise;
      return createProductionResult();
    };
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    const save = await getReadySaveButton();
    fireEvent.click(save);
    expect(save).toBeDisabled();
    expect(downloadClick).not.toHaveBeenCalled();

    await act(async () => {
      atlasDeferred.resolve();
      await atlasDeferred.promise;
    });
    expect(save).toBeDisabled();

    await act(async () => {
      piecesDeferred.resolve();
      await piecesDeferred.promise;
    });
    expect(save).toBeDisabled();

    await act(async () => {
      pdfDeferred.resolve();
      await pdfDeferred.promise;
    });
    expect(save).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Download production ZIP' })).not.toBeInTheDocument();

    await act(async () => {
      zipDeferred.resolve();
      await zipDeferred.promise;
    });
    expect(await screen.findByRole('link', { name: 'Download production ZIP' })).toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(downloadClick).not.toHaveBeenCalled();
  });

  it('disables duplicate saves and discards a production ZIP when the design changes while generation is pending', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    const packageDeferred = createDeferred();
    let packageAttempt = 0;
    productionPackageHarness.result = () => {
      packageAttempt += 1;
      return packageAttempt === 1 ? packageDeferred.promise : createProductionResult();
    };

    const save = await getReadySaveButton();
    fireEvent.click(save);
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(productionPackageHarness.requests).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(document.querySelector('[data-option-group="layout"][data-option-id="xl"]'));
    await waitFor(() => expect(
      document.querySelector('[data-option-group="layout"][data-option-id="xl"]'),
    ).toHaveAttribute('aria-pressed', 'true'));
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(productionPackageHarness.requests).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Download production ZIP' })).not.toBeInTheDocument();

    await act(async () => {
      packageDeferred.resolve(createProductionResult());
      await packageDeferred.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByRole('link', { name: 'Download production ZIP' })).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await waitFor(() => expect(productionPackageHarness.requests).toHaveLength(2));
  });

  it('discards a production ZIP when the page unmounts while generation is pending', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    const packageDeferred = createDeferred();
    productionPackageHarness.result = packageDeferred.promise;

    fireEvent.click(await getReadySaveButton());
    unmount();
    await act(async () => {
      packageDeferred.resolve(createProductionResult());
      await packageDeferred.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(
      /state update.*unmounted|unmounted component/i,
    );
    consoleError.mockRestore();
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

  it('saves the production package with the variant for the current selected size', async () => {
    window.history.replaceState(
      null,
      '',
      '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%2C%22xl%22%3A%2248039101989015%22%7D&variantId=48039101923479',
    );
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(document.querySelector('[data-option-group="layout"][data-option-id="xl"]'));
    await waitFor(() => expect(
      document.querySelector('[data-option-group="layout"][data-option-id="xl"]'),
    ).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(await getReadySaveButton());

    await waitFor(() => expect(productionPackageHarness.requests).toHaveLength(1));
    expect(productionPackageHarness.requests[0]).toEqual(expect.objectContaining({
      state: expect.objectContaining({ layout: 'xl' }),
      variantId: '48039101989015',
    }));
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

  it('applies two queued extra toggles against the latest state', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Extras' }));
    const extra = screen.getByRole('button', { name: /League sleeve badge/i });
    const firstQuote = createDeferred();
    const quoteSpy = vi.spyOn(productApi, 'quoteConfiguration')
      .mockReturnValueOnce(firstQuote.promise);

    try {
      fireEvent.click(extra);
      fireEvent.click(extra);
      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(1));

      firstQuote.resolve({
        basePrice: 89,
        merchandisePrice: 89,
        customizationTotal: 0,
        optionAdjustments: [],
        total: 89,
        currency: 'USD',
      });

      await waitFor(() => expect(quoteSpy).toHaveBeenCalledTimes(2));
      await waitFor(() => {
        expect(extra).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getAllByText('$89').length).toBeGreaterThan(0);
      });
    } finally {
      firstQuote.resolve({
        basePrice: 89,
        merchandisePrice: 89,
        customizationTotal: 0,
        optionAdjustments: [],
        total: 89,
        currency: 'USD',
      });
      quoteSpy.mockRestore();
    }
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

  it('packages, verifies, uploads, quotes, and navigates one current immutable snapshot in order', async () => {
    window.history.replaceState(
      null,
      '',
      '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%2C%22xl%22%3A%2248039101989015%22%7D&variantId=48039101923479',
    );
    fetch.mockImplementationOnce(async () => {
      productionPackageHarness.events.push('quote');
      return secureCartResponse();
    });
    const navigateToCart = vi.fn(() => productionPackageHarness.events.push('navigate'));
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(document.querySelector('[data-option-group="layout"][data-option-id="xl"]'));
    await waitFor(() => expect(
      document.querySelector('[data-option-group="layout"][data-option-id="xl"]'),
    ).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    await waitFor(() => expect(navigateToCart).toHaveBeenCalledOnce());
    expect(productionPackageHarness.events).toEqual([
      'package',
      'turnstile',
      'upload',
      'quote',
      'navigate',
    ]);
    expect(cloudDraftHarness.tokenRequests[0]).toEqual({
      container: expect.any(HTMLElement),
      signal: expect.any(AbortSignal),
    });
    const verificationContainer = cloudDraftHarness.tokenRequests[0].container;
    expect(screen.getByRole('dialog')).toContainElement(verificationContainer);
    expect(verificationContainer).toHaveAttribute('aria-label', 'Security verification');
    expect(verificationContainer.isConnected).toBe(true);
    expect(verificationContainer).toBeEmptyDOMElement();
    const packageRequest = productionPackageHarness.requests[0];
    expect(packageRequest).toEqual(expect.objectContaining({
      artifactProvider: expect.any(Function),
      state: expect.objectContaining({ layout: 'xl' }),
      variantId: '48039101989015',
    }));
    expect(cloudDraftHarness.uploadRequests[0]).toEqual(expect.objectContaining({
      artifact: productionPackageHarness.result,
      shop: 'testcsj.myshopify.com',
      signal: expect.any(AbortSignal),
      turnstileToken: 'verified-turnstile-token',
      uploadId: expect.stringMatching(/^upl_[a-f0-9]{32}$/u),
    }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      shop: 'testcsj.myshopify.com',
      designId: 'dsg_1234567890abcdef',
      state: packageRequest.state,
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(downloadClick).not.toHaveBeenCalled();
  });

  it('keeps the cart action disabled through package, verification, upload, and quote stages', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    const packageDeferred = createDeferred();
    const tokenDeferred = createDeferred();
    const uploadDeferred = createDeferred();
    const quoteDeferred = createDeferred();
    productionPackageHarness.result = packageDeferred.promise;
    cloudDraftHarness.tokenResult = tokenDeferred.promise;
    cloudDraftHarness.uploadResult = uploadDeferred.promise;
    fetch.mockImplementationOnce(() => quoteDeferred.promise);
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    const add = screen.getByRole('button', { name: 'Add to Shopify cart' });

    fireEvent.click(add);
    fireEvent.click(add);
    expect(productionPackageHarness.requests).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Preparing secure cart…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save design file' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save design' })).toBeDisabled();

    await act(async () => packageDeferred.resolve(createProductionResult()));
    await waitFor(() => expect(cloudDraftHarness.tokenRequests).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Preparing secure cart…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save design file' })).toBeDisabled();

    await act(async () => tokenDeferred.resolve('verified-turnstile-token'));
    await waitFor(() => expect(cloudDraftHarness.uploadRequests).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Preparing secure cart…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save design file' })).toBeDisabled();

    await act(async () => uploadDeferred.resolve(createProductionDraftResult()));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Preparing secure cart…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save design file' })).toBeDisabled();

    await act(async () => quoteDeferred.resolve(secureCartResponse()));
    await waitFor(() => expect(navigateToCart).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Add to Shopify cart' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save design file' })).toBeEnabled();
  });

  it('fails closed when the selected size has no exact Shopify variant mapping', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    render(<ConfiguratorPage navigateToCart={vi.fn()} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(document.querySelector('[data-option-group="layout"][data-option-id="xl"]'));
    await waitFor(() => expect(
      document.querySelector('[data-option-group="layout"][data-option-id="xl"]'),
    ).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The selected size is unavailable in Shopify. Choose another size.',
    );
    const add = screen.getByRole('button', { name: 'Add to Shopify cart' });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(productionPackageHarness.requests).toHaveLength(0);
    expect(cloudDraftHarness.tokenRequests).toHaveLength(0);
    expect(cloudDraftHarness.uploadRequests).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByRole('button', { name: 'Save design file' }));
    await waitFor(() => expect(productionPackageHarness.requests).toHaveLength(1));
    expect(productionPackageHarness.requests[0]).toEqual(expect.objectContaining({
      state: expect.objectContaining({ layout: 'xl' }),
      variantId: null,
    }));
  });

  it('cancels before upload when Review closes during Turnstile verification', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    const tokenDeferred = createDeferred();
    cloudDraftHarness.tokenResult = tokenDeferred.promise;
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    await waitFor(() => expect(cloudDraftHarness.tokenRequests).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    await act(async () => tokenDeferred.resolve('late-token'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(cloudDraftHarness.uploadRequests).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(navigateToCart).not.toHaveBeenCalled();
  });

  it('keeps the shared production lease until a cancelled cart package settles', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    const packageDeferred = createDeferred();
    productionPackageHarness.result = packageDeferred.promise;
    render(<ConfiguratorPage navigateToCart={vi.fn()} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    expect(productionPackageHarness.requests).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    const save = screen.getByRole('button', { name: 'Save design file' });
    const add = screen.getByRole('button', { name: 'Add to Shopify cart' });
    expect(screen.getByRole('button', { name: 'Save design' })).toBeDisabled();
    expect(save).toBeDisabled();
    expect(add).toBeDisabled();
    fireEvent.click(save);
    fireEvent.click(add);
    expect(productionPackageHarness.requests).toHaveLength(1);

    await act(async () => packageDeferred.resolve(createProductionResult()));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save design' })).toBeEnabled());
    expect(save).toBeEnabled();
    expect(add).toBeEnabled();
    expect(cloudDraftHarness.tokenRequests).toHaveLength(0);
    expect(cloudDraftHarness.uploadRequests).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it('cancels the immutable cart snapshot as soon as a design mutation is queued', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%2C%22xl%22%3A%2248039101989015%22%7D&variantId=48039101923479');
    const packageDeferred = createDeferred();
    productionPackageHarness.result = packageDeferred.promise;
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    expect(productionPackageHarness.requests[0].state.layout).toBe('m');

    fireEvent.click(screen.getByRole('button', { name: 'Size' }));
    fireEvent.click(document.querySelector('[data-option-group="layout"][data-option-id="xl"]'));
    await act(async () => packageDeferred.resolve(createProductionResult()));
    await waitFor(() => expect(
      document.querySelector('[data-option-group="layout"][data-option-id="xl"]'),
    ).toHaveAttribute('aria-pressed', 'true'));

    expect(productionPackageHarness.requests[0].state.layout).toBe('m');
    expect(cloudDraftHarness.tokenRequests).toHaveLength(0);
    expect(cloudDraftHarness.uploadRequests).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(navigateToCart).not.toHaveBeenCalled();
  });

  it('aborts an in-flight upload when Review closes and ignores its late result', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    const uploadDeferred = createDeferred();
    cloudDraftHarness.uploadResult = uploadDeferred.promise;
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    await waitFor(() => expect(cloudDraftHarness.uploadRequests).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Continue editing' }));
    expect(cloudDraftHarness.uploadRequests[0].signal).toHaveProperty('aborted', true);
    await act(async () => uploadDeferred.resolve(createProductionDraftResult()));

    expect(fetch).toHaveBeenCalledTimes(0);
    expect(navigateToCart).not.toHaveBeenCalled();
  });

  it('aborts an in-flight upload when the page unmounts and ignores its late result', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    const uploadDeferred = createDeferred();
    cloudDraftHarness.uploadResult = uploadDeferred.promise;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const navigateToCart = vi.fn();
    const { unmount } = render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    await waitFor(() => expect(cloudDraftHarness.uploadRequests).toHaveLength(1));

    unmount();
    expect(cloudDraftHarness.uploadRequests[0].signal).toHaveProperty('aborted', true);
    await act(async () => uploadDeferred.resolve(createProductionDraftResult()));

    expect(fetch).toHaveBeenCalledTimes(0);
    expect(navigateToCart).not.toHaveBeenCalled();
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(
      /state update.*unmounted|unmounted component/i,
    );
    consoleError.mockRestore();
  });

  it('does not quote after upload failure and keeps one stable retryable error in Review', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    cloudDraftHarness.uploadResult = () => Promise.reject(new Error('private upload detail'));
    const navigateToCart = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't prepare your Shopify cart. Please try again.",
    );
    expect(fetch).toHaveBeenCalledTimes(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Shopify cart' })).toBeEnabled();
    expect(navigateToCart).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('Cart preparation failed at stage: upload.');
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('private upload detail');

    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('keeps an uploaded cloud draft retryable when quote creation fails', async () => {
    window.history.replaceState(null, '', '/?shop=testcsj.myshopify.com&variantMap=%7B%22m%22%3A%2248039101923479%22%7D&variantId=48039101923479');
    fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'private quote detail' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(secureCartResponse());
    const navigateToCart = vi.fn();
    render(<ConfiguratorPage navigateToCart={navigateToCart} />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Review design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't prepare your Shopify cart. Please try again.",
    );
    expect(cloudDraftHarness.uploadRequests).toHaveLength(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body).designId).toBe('dsg_1234567890abcdef');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(downloadClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add to Shopify cart' }));
    await waitFor(() => expect(navigateToCart).toHaveBeenCalledOnce());
    expect(cloudDraftHarness.uploadRequests).toHaveLength(2);
    expect(cloudDraftHarness.uploadRequests[1].uploadId)
      .not.toBe(cloudDraftHarness.uploadRequests[0].uploadId);
    expect(JSON.parse(fetch.mock.calls[1][1].body).designId).toBe('dsg_1234567890abcdef');
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

async function getReadySaveButton() {
  const save = screen.getByRole('button', { name: 'Save design' });
  await waitFor(() => expect(save).toBeEnabled());
  return save;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function createProductionResult() {
  return {
    blob: new Blob(['production-zip'], { type: 'application/zip' }),
    filename: 'fn8788-jersey-design-12ab34cd.zip',
    fingerprint: '12ab34cd5678',
    manifest: {
      files: [
        {
          name: 'design.json',
          sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        {
          name: 'uv-atlas.png',
          sha256: '7c82602500857aa6ed0cf38c4c3e4ec645bdcaa82c00b9155eb08be100c778a9',
        },
        {
          name: 'uv-reference.pdf',
          sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        {
          name: 'preview-front.png',
          sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        },
        {
          name: 'preview-back.png',
          sha256: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        },
      ],
    },
  };
}

function createProductionDraftResult() {
  return {
    designId: 'dsg_1234567890abcdef',
    designFingerprint: '12ab34cd',
    bundleFilename: 'fn8788-jersey-design-12ab34cd.zip',
    expiresAt: Date.now() + 60_000,
  };
}
