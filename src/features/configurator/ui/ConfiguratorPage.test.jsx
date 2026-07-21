import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfiguratorPage } from './ConfiguratorPage.jsx';

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

      focusDecoration(id) {
        rendererHarness.focusedDecorationId = id;
      }

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
    fireEvent.click(screen.getByRole('button', { name: /^Roundel Badge$/ }));
    expect(rendererHarness.focusedDecorationId).toBeNull();

    fireEvent.click(within(screen.getByLabelText('Added artwork')).getByRole('button', { name: 'Crest Badge' }));

    await waitFor(() => {
      expect(rendererHarness.focusedDecorationId).toMatch(/^preset-crest-badge-/);
    });
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

  it('preserves the selected template when a sleeves color change is undone', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');

    fireEvent.click(screen.getByRole('button', { name: 'Template' }));
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

  it('focuses the name field when editing a selected print', async () => {
    render(<ConfiguratorPage />);
    await screen.findByText('Chelsea Match Jersey');
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    fireEvent.click(screen.getByRole('button', { name: /Name set/i }));
    act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
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
    act(() => rendererHarness.options.onPrintSelectionChange('print-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete print' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Edit print' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Name set/i }));

    expect(screen.queryByRole('button', { name: 'Edit print' })).not.toBeInTheDocument();
  });
});
