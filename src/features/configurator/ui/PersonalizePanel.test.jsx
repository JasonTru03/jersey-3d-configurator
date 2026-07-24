import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mergeConfiguratorState } from '../config/state.js';
import { jerseyProduct } from '../config/productDefinitions.js';
import { PersonalizePanel } from './PersonalizePanel.jsx';

function PersonalizeHarness({
  initialState = jerseyProduct.defaultState,
  initialSelection = null,
  onStateChange = vi.fn(),
}) {
  const [state, setState] = useState(initialState);
  const [selectedKey, setSelectedKey] = useState(initialSelection);

  const updateState = (patch) => {
    setState((current) => {
      const next = mergeConfiguratorState(current, patch);
      onStateChange(next);
      return next;
    });
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
});
