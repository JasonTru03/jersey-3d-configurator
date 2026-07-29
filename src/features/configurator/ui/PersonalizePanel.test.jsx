import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  startTransition,
  Suspense,
  useState,
} from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mergeConfiguratorState } from '../config/state.js';
import { jerseyProduct } from '../config/productDefinitions.js';
import { usePersonalizationDeletion } from '../hooks/usePersonalizationDeletion.js';
import { PersonalizePanel } from './PersonalizePanel.jsx';

function PersonalizeHarness({
  initialState = jerseyProduct.defaultState,
  initialSelection = null,
  onSideFocus = vi.fn(),
  onSidePendingChange = vi.fn(),
  onStateChange = vi.fn(),
  onUpdate = vi.fn(),
  updateDeferred = null,
}) {
  const [state, setState] = useState(initialState);
  const [selectedKey, setSelectedKey] = useState(initialSelection);

  const applyPatch = (patch) => {
    setState((current) => {
      const next = mergeConfiguratorState(current, resolveStatePatch(current, patch));
      onStateChange(next);
      return next;
    });
  };

  const updateState = (patch) => {
    onUpdate(patch);
    if (updateDeferred) {
      return updateDeferred.promise.then((result) => {
        if (result?.ok !== false) applyPatch(patch);
        return result;
      });
    }
    applyPatch(patch);
    return { ok: true };
  };
  const deletion = usePersonalizationDeletion({
    onSelectionChange: setSelectedKey,
    selectedKey,
    state,
    updateState,
  });

  return (
    <>
      <PersonalizePanel
        deletePending={deletion.deletePending}
        deletePersonalization={deletion.deletePersonalization}
        onSelect={setSelectedKey}
        onSideFocus={onSideFocus}
        onSidePendingChange={onSidePendingChange}
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

function resolveStatePatch(state, patch) {
  return typeof patch === 'function' ? patch(structuredClone(state)) : patch;
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

  it('moves a selected custom text between the front and back defaults', async () => {
    const onSideFocus = vi.fn();
    const onStateChange = vi.fn();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [{
      id: 'text-1',
      text: 'CHELSEA FC',
      fontPreset: 'block',
      fillColor: '#c84f3d',
      outlineEnabled: false,
      outlineColor: '#1f5b4f',
      letterSpacing: 6,
      placement: { x: 0.24, y: 0.61, z: 0.48, normal: { x: 0, y: 0, z: 1 } },
      rotation: 42,
      scale: 1.35,
    }];
    render(
      <PersonalizeHarness
        initialSelection="text:text-1"
        initialState={state}
        onSideFocus={onSideFocus}
        onStateChange={onStateChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({
        customTextItems: [{
          id: 'text-1',
          text: 'CHELSEA FC',
          fontPreset: 'block',
          fillColor: '#C84F3D',
          outlineEnabled: false,
          outlineColor: '#1F5B4F',
          letterSpacing: 6,
          placement: {
            normal: { x: 0, y: 0, z: -1 },
            x: 0,
            y: 0.36,
            z: -0.5,
          },
          rotation: 42,
          scale: 1.35,
        }],
      }),
    }));
    await waitFor(() => expect(onSideFocus).toHaveBeenNthCalledWith(1, 'back'));
    expect(screen.getByRole('button', { name: 'Back' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Front' }));

    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      overrides: expect.objectContaining({
        customTextItems: [{
          id: 'text-1',
          text: 'CHELSEA FC',
          fontPreset: 'block',
          fillColor: '#C84F3D',
          outlineEnabled: false,
          outlineColor: '#1F5B4F',
          letterSpacing: 6,
          placement: {
            normal: { x: 0, y: 0, z: 1 },
            x: 0,
            y: 0.36,
            z: 0.5,
          },
          rotation: 42,
          scale: 1.35,
        }],
      }),
    }));
    await waitFor(() => expect(onSideFocus).toHaveBeenNthCalledWith(2, 'front'));
    expect(onSideFocus).toHaveBeenCalledTimes(2);
  });

  it('moves a selected player set to the back default while preserving its content and transform', async () => {
    const onSideFocus = vi.fn();
    const onSidePendingChange = vi.fn();
    const onStateChange = vi.fn();
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.lighting = 'name-number';
    state.overrides.printItems = [{
      id: 'player',
      name: 'MASON',
      number: '10',
      placement: { x: 0.24, y: 0.61, z: 0.48, normal: { x: 0, y: 0, z: 1 } },
      rotation: 28,
      scale: 1.24,
    }];
    render(
      <PersonalizeHarness
        initialSelection="player:player"
        initialState={state}
        onSideFocus={onSideFocus}
        onSidePendingChange={onSidePendingChange}
        onStateChange={onStateChange}
        updateDeferred={updateDeferred}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onStateChange).not.toHaveBeenCalled();
    expect(onSideFocus).not.toHaveBeenCalled();
    expect(onSidePendingChange).toHaveBeenCalledWith(true);
    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => expect(onStateChange).toHaveBeenCalled());
    const nextPlayer = onStateChange.mock.lastCall[0].overrides.printItems[0];
    expect(nextPlayer).toEqual({
      id: 'player',
      name: 'MASON',
      number: '10',
      placement: {
        x: 0,
        y: 0.36,
        z: -0.5,
        normal: { x: 0, y: 0, z: -1 },
      },
      rotation: 28,
      scale: 1.24,
    });
    expect(onStateChange.mock.lastCall[0].overrides.printPlacement).toEqual(nextPlayer.placement);
    expect(onStateChange.mock.lastCall[0].overrides.printName).toBe('MASON');
    expect(onStateChange.mock.lastCall[0].overrides.printNumber).toBe('10');
    await waitFor(() => expect(onSideFocus).toHaveBeenCalledWith('back'));
    expect(onSidePendingChange).toHaveBeenLastCalledWith(false);
  });

  it('preserves a queued player name edit and other players when a later side change runs', async () => {
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.lighting = 'name-number';
    state.overrides.printItems = [
      {
        id: 'first',
        name: 'FIRST',
        number: '11',
        placement: { x: 0, y: 0.36, z: 0.5 },
        rotation: 5,
        scale: 1.1,
      },
      {
        id: 'second',
        name: 'SECOND',
        number: '22',
        placement: { x: 0.2, y: 0.45, z: 0.48 },
        rotation: 10,
        scale: 1.2,
      },
    ];
    const firstBefore = structuredClone(state.overrides.printItems[0]);
    const onStateChange = vi.fn();
    render(
      <PersonalizeHarness
        initialSelection="player:second"
        initialState={state}
        onStateChange={onStateChange}
        updateDeferred={updateDeferred}
      />,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'UPDATED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => expect(onStateChange).toHaveBeenCalledTimes(2));
    const finalItems = onStateChange.mock.lastCall[0].overrides.printItems;
    expect(finalItems[0]).toMatchObject(firstBefore);
    expect(finalItems[1]).toMatchObject({
      id: 'second',
      name: 'UPDATED',
      number: '22',
      placement: {
        normal: { x: 0, y: 0, z: -1 },
        x: 0,
        y: 0.36,
        z: -0.5,
      },
      rotation: 10,
      scale: 1.2,
    });
  });

  it('preserves a queued text edit and other text items when a later side change runs', async () => {
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [
      {
        id: 'first',
        text: 'FIRST',
        placement: { x: -0.2, y: 0.45, z: 0.48 },
        rotation: 5,
        scale: 1.1,
      },
      {
        id: 'second',
        text: 'SECOND',
        placement: { x: 0.2, y: 0.45, z: 0.48 },
        rotation: 10,
        scale: 1.2,
      },
    ];
    const firstBefore = structuredClone(state.overrides.customTextItems[0]);
    const onStateChange = vi.fn();
    render(
      <PersonalizeHarness
        initialSelection="text:second"
        initialState={state}
        onStateChange={onStateChange}
        updateDeferred={updateDeferred}
      />,
    );

    fireEvent.change(screen.getByLabelText('Text content'), { target: { value: 'UPDATED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => expect(onStateChange).toHaveBeenCalledTimes(2));
    const finalItems = onStateChange.mock.lastCall[0].overrides.customTextItems;
    expect(finalItems[0]).toMatchObject(firstBefore);
    expect(finalItems[1]).toMatchObject({
      id: 'second',
      text: 'UPDATED',
      placement: {
        normal: { x: 0, y: 0, z: -1 },
        x: 0,
        y: 0.36,
        z: -0.5,
      },
      rotation: 10,
      scale: 1.2,
    });
  });

  it('keeps another player and first-player legacy fields unchanged when switching the second player', async () => {
    const onSideFocus = vi.fn();
    const onStateChange = vi.fn();
    const onUpdate = vi.fn();
    const updateDeferred = createDeferred();
    const firstPlacement = {
      x: -0.24,
      y: 0.61,
      z: 0.48,
      normal: { x: 0, y: 0, z: 1 },
    };
    const state = structuredClone(jerseyProduct.defaultState);
    state.lighting = 'name-number';
    state.overrides.printItems = [
      {
        id: 'first',
        name: 'FIRST',
        number: '10',
        placement: firstPlacement,
        rotation: 12,
        scale: 1.1,
      },
      {
        id: 'second',
        name: 'SECOND',
        number: '20',
        placement: { x: 0.24, y: 0.61, z: 0.48, normal: { x: 0, y: 0, z: 1 } },
        rotation: 28,
        scale: 1.24,
      },
    ];
    render(
      <PersonalizeHarness
        initialSelection="player:second"
        initialState={state}
        onSideFocus={onSideFocus}
        onStateChange={onStateChange}
        onUpdate={onUpdate}
        updateDeferred={updateDeferred}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onSideFocus).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    const addPlayer = screen.getByRole('button', { name: 'Add player set' });
    const addText = screen.getByRole('button', { name: 'Add text' });
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete player set/ });
    expect(addPlayer).toBeDisabled();
    expect(addText).toBeDisabled();
    deleteButtons.forEach((button) => {
      expect(button).toBeDisabled();
    });
    fireEvent.click(addPlayer);
    fireEvent.click(addText);
    deleteButtons.forEach((button) => fireEvent.click(button));
    expect(onUpdate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'FIRST · 10' }));
    expect(screen.getByTestId('selected-key')).toHaveTextContent('player:first');
    expect(screen.getByLabelText('Name')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'SECOND · 20' }));
    expect(screen.getByTestId('selected-key')).toHaveTextContent('player:second');
    expect(screen.getByLabelText('Name')).toBeDisabled();

    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => expect(onStateChange).toHaveBeenCalled());
    const nextOverrides = onStateChange.mock.lastCall[0].overrides;
    expect(nextOverrides.printItems).toEqual([
      {
        id: 'first',
        name: 'FIRST',
        number: '10',
        placement: firstPlacement,
        rotation: 12,
        scale: 1.1,
      },
      {
        id: 'second',
        name: 'SECOND',
        number: '20',
        placement: {
          x: 0,
          y: 0.36,
          z: -0.5,
          normal: { x: 0, y: 0, z: -1 },
        },
        rotation: 28,
        scale: 1.24,
      },
    ]);
    expect(nextOverrides.printName).toBe('FIRST');
    expect(nextOverrides.printNumber).toBe('10');
    expect(nextOverrides.printPlacement).toEqual(firstPlacement);
    expect(onSideFocus).not.toHaveBeenCalled();
  });

  it('keeps a side operation current when an uncommitted selection render is interrupted', async () => {
    const onSideFocus = vi.fn();
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.lighting = 'name-number';
    state.overrides.printItems = [
      {
        id: 'first',
        name: 'FIRST',
        number: '10',
        placement: { x: -0.24, y: 0.61, z: 0.48, normal: { x: 0, y: 0, z: 1 } },
      },
      {
        id: 'second',
        name: 'SECOND',
        number: '20',
        placement: { x: 0.24, y: 0.61, z: 0.48, normal: { x: 0, y: 0, z: 1 } },
      },
    ];
    render(
      <InterruptiblePersonalizeHarness
        initialState={state}
        onSideFocus={onSideFocus}
        updateDeferred={updateDeferred}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt selection render' }));

    expect(screen.getByRole('button', { name: 'SECOND · 20' }))
      .toHaveAttribute('aria-pressed', 'true');
    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => expect(onSideFocus).toHaveBeenCalledWith('back'));
  });

  it('unlocks without stale focus when a pending panel is hidden and restored', async () => {
    const onSideFocus = vi.fn();
    const onSidePendingChange = vi.fn();
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.lighting = 'name-number';
    state.overrides.printItems = [{
      id: 'player',
      name: 'MASON',
      number: '10',
      placement: { x: 0, y: 0.36, z: 0.5, normal: { x: 0, y: 0, z: 1 } },
    }];
    render(
      <SuspenseVisibilityHarness
        initialState={state}
        onSideFocus={onSideFocus}
        onSidePendingChange={onSidePendingChange}
        updateDeferred={updateDeferred}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onSidePendingChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide personalize panel' }));
    expect(screen.getByText('Loading selection')).toBeInTheDocument();

    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });
    expect(onSideFocus).not.toHaveBeenCalled();
    expect(onSidePendingChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole('button', { name: 'Show personalize panel' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add player set' })).toBeEnabled();
      expect(screen.getByLabelText('Name')).toBeEnabled();
    });
    expect(onSideFocus).not.toHaveBeenCalled();
  });

  it('focuses an already active player side without resetting its custom placement', async () => {
    const onSideFocus = vi.fn();
    const onStateChange = vi.fn();
    const onUpdate = vi.fn();
    const customBackPlacement = {
      x: 0.24,
      y: 0.61,
      z: -0.48,
      normal: { x: 0, y: 0, z: -1 },
    };
    const state = structuredClone(jerseyProduct.defaultState);
    state.lighting = 'name-number';
    state.overrides.printItems = [{
      id: 'player',
      name: 'MASON',
      number: '10',
      placement: customBackPlacement,
      rotation: 28,
      scale: 1.24,
    }];
    render(
      <PersonalizeHarness
        initialSelection="player:player"
        initialState={state}
        onSideFocus={onSideFocus}
        onStateChange={onStateChange}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(onSideFocus).toHaveBeenCalledWith('back'));
    expect(onStateChange).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(state.overrides.printItems[0].placement).toEqual(customBackPlacement);
  });

  it('locks side controls and does not request focus when a player side update fails', async () => {
    const onSideFocus = vi.fn();
    const onStateChange = vi.fn();
    const onUpdate = vi.fn();
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.lighting = 'name-number';
    state.overrides.printItems = [{
      id: 'player',
      name: 'MASON',
      number: '10',
      placement: { x: 0, y: 0.36, z: 0.5, normal: { x: 0, y: 0, z: 1 } },
      rotation: 28,
      scale: 1.24,
    }];
    render(
      <PersonalizeHarness
        initialSelection="player:player"
        initialState={state}
        onSideFocus={onSideFocus}
        onStateChange={onStateChange}
        onUpdate={onUpdate}
        updateDeferred={updateDeferred}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onSideFocus).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Front' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Front' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const queuedPatch = onUpdate.mock.lastCall[0];
    expect(queuedPatch).toEqual(expect.any(Function));
    expect(queuedPatch(state)).toEqual({
      overrides: {
        printItems: [{
          id: 'player',
          name: 'MASON',
          number: '10',
          placement: {
            x: 0,
            y: 0.36,
            z: -0.5,
            normal: { x: 0, y: 0, z: -1 },
          },
          rotation: 28,
          scale: 1.24,
        }],
        printName: 'MASON',
        printNumber: '10',
        printPlacement: {
          x: 0,
          y: 0.36,
          z: -0.5,
          normal: { x: 0, y: 0, z: -1 },
        },
      },
    });

    await act(async () => {
      updateDeferred.resolve({ message: 'Quote failed', ok: false });
      await updateDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Front' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    });
    expect(onStateChange).not.toHaveBeenCalled();
    expect(onSideFocus).not.toHaveBeenCalled();
    expect(state.overrides.printItems[0].placement).toEqual({
      x: 0,
      y: 0.36,
      z: 0.5,
      normal: { x: 0, y: 0, z: 1 },
    });
    expect(state.overrides.printPlacement).toEqual({
      x: 0,
      y: 0.36,
      z: 0.5,
    });
  });

  it('does not request focus when a custom text side update fails', async () => {
    const onSideFocus = vi.fn();
    const onSidePendingChange = vi.fn();
    const onStateChange = vi.fn();
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [{
      id: 'text-1',
      text: 'MASON',
      placement: { x: 0, y: 0.36, z: 0.5, normal: { x: 0, y: 0, z: 1 } },
      rotation: 42,
      scale: 1.35,
    }];
    render(
      <PersonalizeHarness
        initialSelection="text:text-1"
        initialState={state}
        onSideFocus={onSideFocus}
        onSidePendingChange={onSidePendingChange}
        onStateChange={onStateChange}
        updateDeferred={updateDeferred}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(onSideFocus).not.toHaveBeenCalled();
    expect(onSidePendingChange).toHaveBeenCalledWith(true);
    await act(async () => {
      updateDeferred.resolve({ message: 'Quote failed', ok: false });
      await updateDeferred.promise;
    });

    expect(onStateChange).not.toHaveBeenCalled();
    expect(onSideFocus).not.toHaveBeenCalled();
    expect(onSidePendingChange).toHaveBeenLastCalledWith(false);
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
    screen.getByRole('button', { name: 'Clear selection' }).focus();

    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'BACK' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Clear selection' })).toHaveFocus();
  });

  it('serializes rapid row deletions and re-enables the remaining action after success', async () => {
    const onUpdate = vi.fn();
    const updateDeferred = createDeferred();
    const state = structuredClone(jerseyProduct.defaultState);
    state.overrides.customTextItems = [
      { id: 'text-1', text: 'FRONT' },
      { id: 'text-2', text: 'BACK' },
    ];
    render(
      <PersonalizeHarness
        initialState={state}
        onUpdate={onUpdate}
        updateDeferred={updateDeferred}
      />,
    );
    const deleteFront = screen.getByRole('button', { name: 'Delete text FRONT (text-1)' });
    const deleteBack = screen.getByRole('button', { name: 'Delete text BACK (text-2)' });

    fireEvent.click(deleteFront);

    expect(deleteFront).toBeDisabled();
    expect(deleteBack).toBeDisabled();
    fireEvent.click(deleteBack);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      updateDeferred.resolve({ ok: true });
      await updateDeferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete text BACK (text-2)' })).toBeEnabled();
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
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
    expect(deleteFront).toBeDisabled();

    await act(async () => {
      updateDeferred.resolve({ message: 'Quote failed', ok: false });
      await updateDeferred.promise;
    });

    await waitFor(() => expect(deleteFront).toHaveFocus());
    expect(deleteFront).toBeEnabled();
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

function InterruptiblePersonalizeHarness({
  initialState,
  onSideFocus,
  updateDeferred,
}) {
  const [selectedKey, setSelectedKey] = useState('player:second');
  const [state, setState] = useState(initialState);
  const [suspendSelection, setSuspendSelection] = useState(false);
  const updateState = (patch) => updateDeferred.promise.then((result) => {
    if (result?.ok !== false) {
      setState((current) => mergeConfiguratorState(current, resolveStatePatch(current, patch)));
    }
    return result;
  });

  return (
    <>
      <Suspense fallback={<p>Loading selection</p>}>
        <PersonalizePanel
          deletePending={false}
          onSelect={setSelectedKey}
          onSideFocus={onSideFocus}
          selectedKey={selectedKey}
          state={state}
          updateState={updateState}
        />
        <SuspendSelectionRender suspend={suspendSelection} />
      </Suspense>
      <button
        onClick={() => {
          startTransition(() => {
            setSelectedKey('player:first');
            setSuspendSelection(true);
          });
        }}
        type="button"
      >
        Interrupt selection render
      </button>
    </>
  );
}

function SuspendSelectionRender({ suspend }) {
  if (suspend) throw interruptedSelectionRender;
  return null;
}

const interruptedSelectionRender = new Promise(() => {});

function SuspenseVisibilityHarness({
  initialState,
  onSideFocus,
  onSidePendingChange,
  updateDeferred,
}) {
  const [state, setState] = useState(initialState);
  const [suspend, setSuspend] = useState(false);
  const updateState = (patch) => updateDeferred.promise.then((result) => {
    if (result?.ok !== false) {
      setState((current) => mergeConfiguratorState(current, resolveStatePatch(current, patch)));
    }
    return result;
  });

  return (
    <>
      <Suspense fallback={<p>Loading selection</p>}>
        <PersonalizePanel
          deletePending={false}
          onSelect={vi.fn()}
          onSideFocus={onSideFocus}
          onSidePendingChange={onSidePendingChange}
          selectedKey="player:player"
          state={state}
          updateState={updateState}
        />
        <SuspendSelectionRender suspend={suspend} />
      </Suspense>
      <button onClick={() => setSuspend(true)} type="button">Hide personalize panel</button>
      <button onClick={() => setSuspend(false)} type="button">Show personalize panel</button>
    </>
  );
}
