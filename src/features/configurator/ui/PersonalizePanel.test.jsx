import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mergeConfiguratorState } from '../config/state.js';
import { jerseyProduct } from '../config/productDefinitions.js';
import { PersonalizePanel } from './PersonalizePanel.jsx';

function PersonalizeHarness({
  initialState = jerseyProduct.defaultState,
  initialSelection = null,
  onStateChange = vi.fn(),
  updateDeferred = null,
}) {
  const [state, setState] = useState(initialState);
  const [selectedKey, setSelectedKey] = useState(initialSelection);

  const applyPatch = (patch) => {
    setState((current) => {
      const next = mergeConfiguratorState(current, patch);
      onStateChange(next);
      return next;
    });
  };

  const updateState = (patch) => {
    if (updateDeferred) {
      return updateDeferred.promise.then((result) => {
        if (result?.ok !== false) applyPatch(patch);
        return result;
      });
    }
    applyPatch(patch);
    return { ok: true };
  };

  return (
    <>
      <PersonalizePanel
        onSelect={setSelectedKey}
        selectedKey={selectedKey}
        state={state}
        updateState={updateState}
      />
      <button onClick={() => setSelectedKey(null)} type="button">Clear selection</button>
      <output data-testid="selected-key">{selectedKey ?? ''}</output>
      <output data-testid="state-lighting">{state.lighting}</output>
      <output data-testid="text-count">{state.overrides.customTextItems.length}</output>
    </>
  );
}

describe('PersonalizePanel', () => {
  it('adds a text element and selects its composite key', async () => {
    render(<PersonalizeHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));

    expect(await screen.findByLabelText('Text content')).toHaveValue('YOUR TEXT');
    expect(screen.getByTestId('selected-key')).toHaveTextContent('text:text-1');
    expect(within(screen.getByRole('list', { name: 'Personalization elements' }))
      .getByRole('button', { name: 'YOUR TEXT' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('adds a player set and keeps raised-print pricing selected', async () => {
    const state = {
      ...structuredClone(jerseyProduct.defaultState),
      lighting: 'raised-print',
    };
    render(<PersonalizeHarness initialState={state} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));

    expect(await screen.findByLabelText('Name')).toHaveValue('PLAYER');
    expect(screen.getByTestId('selected-key')).toHaveTextContent('player:print-1');
    expect(screen.getByLabelText('Name')).toHaveValue('PLAYER');
    expect(screen.getByLabelText('Number')).toHaveValue('16');
    expect(screen.getByTestId('state-lighting')).toHaveTextContent('raised-print');
  });

  it('edits the player legacy fields and the custom text style', async () => {
    const onStateChange = vi.fn();
    render(<PersonalizeHarness onStateChange={onStateChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add player set' }));
    await screen.findByLabelText('Name');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'CHELSEA' } });
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '10' } });

    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({
        printName: 'CHELSEA',
        printNumber: '10',
        printItems: [expect.objectContaining({ name: 'CHELSEA', number: '10' })],
      }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    await screen.findByLabelText('Text content');
    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'CHELSEA FC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    fireEvent.change(screen.getByLabelText('Fill color'), { target: { value: '#c84f3d' } });
    fireEvent.click(screen.getByLabelText('Outline'));
    fireEvent.change(screen.getByLabelText('Outline color'), { target: { value: '#1f5b4f' } });
    fireEvent.change(screen.getByLabelText('Letter spacing'), { target: { value: '6' } });

    expect(screen.getByLabelText('Text content')).toHaveValue('CHELSEA FC');
    expect(screen.getByRole('button', { name: 'Block' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Fill color')).toHaveValue('#c84f3d');
    expect(screen.getByLabelText('Outline')).not.toBeChecked();
    expect(screen.getByLabelText('Outline color')).toHaveValue('#1f5b4f');
    expect(screen.getByLabelText('Letter spacing')).toHaveValue('6');
  });

  it('keeps blank text in the selectable list', async () => {
    render(<PersonalizeHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    await screen.findByLabelText('Text content');
    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: '' } });

    expect(within(screen.getByRole('list', { name: 'Personalization elements' }))
      .getByRole('button', { name: 'Empty text' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Text content')).toHaveValue('');
  });

  it('returns focus to the element list when selection is cleared', async () => {
    render(<PersonalizeHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    await screen.findByLabelText('Text content');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));

    expect(screen.getByRole('list', { name: 'Personalization elements' })).toHaveFocus();
  });

  it('deletes the selected text from its row, clears selection, and returns focus to the list', async () => {
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [
      { id: 'text-1', text: 'FRONT' },
      { id: 'text-2', text: 'BACK' },
    ];
    render(<PersonalizeHarness initialSelection="text:text-1" initialState={state} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete text FRONT (text-1)' }));

    await waitFor(() => expect(screen.getByTestId('selected-key')).toBeEmptyDOMElement());
    expect(screen.queryByRole('button', { name: 'FRONT' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'BACK' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Personalization elements' })).toHaveFocus();
    });
  });

  it('deletes a non-selected row without changing the current selection', () => {
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [
      { id: 'text-1', text: 'FRONT' },
      { id: 'text-2', text: 'BACK' },
    ];
    render(<PersonalizeHarness initialSelection="text:text-1" initialState={state} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete text BACK (text-2)' }));

    expect(screen.queryByRole('button', { name: 'BACK' })).not.toBeInTheDocument();
    expect(screen.getByTestId('selected-key')).toHaveTextContent('text:text-1');
    expect(screen.getByLabelText('Text content')).toHaveValue('FRONT');
  });

  it('keeps a newer selection when a selected-row deletion finishes later', async () => {
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [
      { id: 'text-1', text: 'FRONT' },
      { id: 'text-2', text: 'BACK' },
    ];
    render(
      <PersonalizeHarness
        initialSelection="text:text-1"
        initialState={state}
        updateDeferred={updateDeferred}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete text FRONT (text-1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'BACK' }));
    expect(screen.getByTestId('selected-key')).toHaveTextContent('text:text-2');

    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'FRONT' })).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('selected-key')).toHaveTextContent('text:text-2');
    expect(screen.getByLabelText('Text content')).toHaveValue('BACK');
  });

  it('moves keyboard focus to the next row after a non-selected deletion succeeds', async () => {
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [
      { id: 'text-1', text: 'FRONT' },
      { id: 'text-2', text: 'MIDDLE' },
      { id: 'text-3', text: 'BACK' },
    ];
    render(
      <PersonalizeHarness
        initialSelection="text:text-1"
        initialState={state}
        updateDeferred={updateDeferred}
      />,
    );
    const deleteMiddle = screen.getByRole('button', { name: 'Delete text MIDDLE (text-2)' });
    deleteMiddle.focus();
    fireEvent.click(deleteMiddle);

    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'BACK' })).toHaveFocus());
    expect(screen.getByTestId('selected-key')).toHaveTextContent('text:text-1');
  });

  it('falls back to the list when keyboard deletion removes the last row', async () => {
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [
      { id: 'text-1', text: 'FRONT' },
      { id: 'text-2', text: 'BACK' },
    ];
    render(
      <PersonalizeHarness
        initialSelection="text:text-1"
        initialState={state}
        updateDeferred={updateDeferred}
      />,
    );
    const deleteBack = screen.getByRole('button', { name: 'Delete text BACK (text-2)' });
    deleteBack.focus();
    fireEvent.click(deleteBack);

    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Personalization elements' })).toHaveFocus();
    });
  });

  it('does not steal focus when the shopper moves elsewhere during deletion', async () => {
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [
      { id: 'text-1', text: 'FRONT' },
      { id: 'text-2', text: 'BACK' },
    ];
    render(<PersonalizeHarness initialState={state} updateDeferred={updateDeferred} />);
    const deleteBack = screen.getByRole('button', { name: 'Delete text BACK (text-2)' });
    deleteBack.focus();
    fireEvent.click(deleteBack);
    screen.getByRole('button', { name: 'Add text' }).focus();

    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'BACK' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Add text' })).toHaveFocus();
  });

  it('keeps the item, selection, and focus when a deferred deletion fails', async () => {
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [{ id: 'text-1', text: 'FRONT' }];
    render(
      <PersonalizeHarness
        initialSelection="text:text-1"
        initialState={state}
        updateDeferred={updateDeferred}
      />,
    );
    const deleteFront = screen.getByRole('button', { name: 'Delete text FRONT (text-1)' });
    deleteFront.focus();
    fireEvent.click(deleteFront);

    await act(async () => {
      updateDeferred.resolve({ message: 'Quote failed', ok: false });
      await updateDeferred.promise;
    });

    await waitFor(() => expect(deleteFront).toHaveFocus());
    expect(screen.getByRole('button', { name: 'FRONT' })).toBeInTheDocument();
    expect(screen.getByTestId('selected-key')).toHaveTextContent('text:text-1');
  });

  it('deletes a player row with normalized legacy print fields', () => {
    const onStateChange = vi.fn();
    const state = structuredClone(jerseyProduct.defaultState);
    state.lighting = 'name-number';
    state.overrides.printItems = [
      { id: 'print-1', name: 'FIRST', number: '10' },
      { id: 'print-2', name: 'SECOND', number: '20' },
    ];
    render(
      <PersonalizeHarness
        initialSelection="player:print-2"
        initialState={state}
        onStateChange={onStateChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete player set FIRST · 10 (print-1)' }));

    expect(screen.getByTestId('selected-key')).toHaveTextContent('player:print-2');
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({
        printItems: [expect.objectContaining({ id: 'print-2' })],
        printName: 'SECOND',
        printNumber: '20',
      }),
    }));
  });

  it('keeps state and selection unchanged at the eight-text limit', () => {
    const onStateChange = vi.fn();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = Array.from({ length: 8 }, (_, index) => ({
      id: `text-${index + 1}`,
      text: `TEXT ${index + 1}`,
    }));
    render(
      <PersonalizeHarness
        initialSelection="text:text-8"
        initialState={state}
        onStateChange={onStateChange}
      />,
    );

    const addText = screen.getByRole('button', { name: 'Add text' });
    expect(addText).toBeDisabled();
    fireEvent.click(addText);

    expect(screen.getByTestId('text-count')).toHaveTextContent('8');
    expect(screen.getByTestId('selected-key')).toHaveTextContent('text:text-8');
    expect(onStateChange).not.toHaveBeenCalled();
  });
});

function createDeferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
