import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mergeConfiguratorState } from '../config/state.js';
import { PersonalizationToolbarOverlay } from '../scene/PersonalizationToolbarOverlay.jsx';
import { PersonalizePanel } from '../ui/PersonalizePanel.jsx';
import { usePersonalizationDeletion } from './usePersonalizationDeletion.js';

const initialState = {
  lighting: 'none',
  overrides: {
    customTextItems: [
      { id: 'text-1', text: 'FRONT' },
      { id: 'text-2', text: 'BACK' },
    ],
  },
};

function CoordinatedDeletionHarness({ deferred, onError = vi.fn(), onUpdate = vi.fn() }) {
  const [showPanel, setShowPanel] = useState(true);
  const [selectedKey, setSelectedKey] = useState('text:text-1');
  const [state, setState] = useState(initialState);
  const updateState = (patch) => {
    onUpdate(patch);
    return deferred.promise.then((result) => {
      if (result?.ok !== false) setState((current) => mergeConfiguratorState(current, patch));
      return result;
    });
  };
  const deletion = usePersonalizationDeletion({
    onError,
    onSelectionChange: setSelectedKey,
    selectedKey,
    state,
    updateState,
  });

  return (
    <>
      <button onClick={() => setShowPanel((current) => !current)} type="button">Toggle panel</button>
      <button
        onClick={() => setState((current) => ({
          ...current,
          overrides: {
            ...current.overrides,
            customTextItems: [
              ...current.overrides.customTextItems,
              { id: 'text-3', text: 'LATEST' },
            ],
          },
        }))}
        type="button"
      >
        Add latest state
      </button>
      {showPanel && (
        <PersonalizePanel
          deletePending={deletion.deletePending}
          deletePersonalization={deletion.deletePersonalization}
          onSelect={setSelectedKey}
          selectedKey={selectedKey}
          state={state}
          updateState={updateState}
        />
      )}
      <section className="stage-wrap">
        <div className="stage-toolbar"><button type="button">Orbit view</button></div>
        <div className="stage">
          <PersonalizationToolbarOverlay
            anchor={{ visible: true, left: 100, top: 100, width: 100, height: 60 }}
            item={state.overrides.customTextItems.some((item) => item.id === 'text-1')
              ? { id: 'text-1', key: 'text:text-1', rotation: 0, scale: 1 }
              : null}
            onDelete={deletion.deletePersonalization}
            personalizationMutationDisabled={deletion.deletePending}
          />
        </div>
      </section>
      <output data-testid="selected-key">{selectedKey ?? ''}</output>
    </>
  );
}

describe('usePersonalizationDeletion coordination', () => {
  it('disables the overlay while a list deletion is pending and survives panel remount', async () => {
    const deferred = createDeferred();
    render(<CoordinatedDeletionHarness deferred={deferred} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete text FRONT (text-1)' }));

    expect(screen.getByRole('button', { name: 'Delete personalization' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add player set' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add text' })).toBeDisabled();
    expect(screen.getByLabelText('Text content')).toBeDisabled();
    screen.getAllByRole('button', { name: /personalization/i })
      .filter((button) => button.textContent !== 'Toggle panel')
      .forEach((button) => expect(button).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Toggle panel' }));
    expect(screen.queryByRole('region', { name: 'Personalize jersey' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle panel' }));
    expect(screen.getByRole('button', { name: 'Delete text FRONT (text-1)' })).toBeDisabled();

    await settle(deferred, { ok: true });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete text BACK (text-2)' })).toBeEnabled();
    });
  });

  it('disables every list delete action while an overlay deletion is pending', async () => {
    const deferred = createDeferred();
    const onUpdate = vi.fn();
    render(<CoordinatedDeletionHarness deferred={deferred} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));

    screen.getAllByRole('button', { name: /^Delete text/ })
      .forEach((button) => expect(button).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Delete text BACK (text-2)' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);

    await settle(deferred, { ok: true });
  });

  it('builds the shared removal patch from the latest state at execution time', () => {
    const deferred = createDeferred();
    const onUpdate = vi.fn();
    render(<CoordinatedDeletionHarness deferred={deferred} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add latest state' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));

    expect(onUpdate).toHaveBeenCalledWith({
      overrides: {
        customTextItems: [
          expect.objectContaining({ id: 'text-2' }),
          expect.objectContaining({ id: 'text-3' }),
        ],
      },
    });
  });

  it('reports a rejected update without an unhandled rejection and restores list focus controls', async () => {
    const deferred = createDeferred();
    const onError = vi.fn();
    render(<CoordinatedDeletionHarness deferred={deferred} onError={onError} />);
    const deleteFront = screen.getByRole('button', { name: 'Delete text FRONT (text-1)' });
    deleteFront.focus();
    fireEvent.click(deleteFront);

    await act(async () => {
      deferred.reject(new Error('Quote exploded'));
      await deferred.promise.catch(() => {});
    });

    await waitFor(() => expect(deleteFront).toBeEnabled());
    expect(deleteFront).toHaveFocus();
    expect(onError).toHaveBeenCalledWith('Quote exploded');
  });

  it('restores overlay focus after a rejected deletion temporarily drops it', async () => {
    const deferred = createDeferred();
    render(<CoordinatedDeletionHarness deferred={deferred} />);
    const overlayDelete = screen.getByRole('button', { name: 'Delete personalization' });
    overlayDelete.focus();
    fireEvent.click(overlayDelete);
    const togglePanel = screen.getByRole('button', { name: 'Toggle panel' });
    togglePanel.focus();
    togglePanel.blur();
    expect(document.body).toHaveFocus();

    await act(async () => {
      deferred.reject(new Error('Overlay failure'));
      await deferred.promise.catch(() => {});
    });

    await waitFor(() => expect(overlayDelete).toBeEnabled());
    expect(overlayDelete).toHaveFocus();
  });

  it('moves focus from a successfully deleted overlay item to the stable stage toolbar', async () => {
    const deferred = createDeferred();
    render(<CoordinatedDeletionHarness deferred={deferred} />);
    const overlayDelete = screen.getByRole('button', { name: 'Delete personalization' });
    overlayDelete.focus();
    fireEvent.click(overlayDelete);

    await settle(deferred, { ok: true });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete personalization' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Orbit view' })).toHaveFocus();
  });

  it('preserves focus moved to another control while overlay deletion is pending', async () => {
    const deferred = createDeferred();
    render(<CoordinatedDeletionHarness deferred={deferred} />);
    const overlayDelete = screen.getByRole('button', { name: 'Delete personalization' });
    const userTarget = screen.getByRole('button', { name: 'Add latest state' });
    overlayDelete.focus();
    fireEvent.click(overlayDelete);
    userTarget.focus();
    expect(userTarget).toHaveFocus();

    await settle(deferred, { ok: true });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete personalization' })).not.toBeInTheDocument();
    });
    expect(userTarget).toHaveFocus();
  });

  it('does not publish stale state after the shared owner unmounts mid-request', async () => {
    const deferred = createDeferred();
    const onError = vi.fn();
    const { unmount } = render(
      <CoordinatedDeletionHarness deferred={deferred} onError={onError} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete personalization' }));
    unmount();

    await act(async () => {
      deferred.reject(new Error('Late failure'));
      await deferred.promise.catch(() => {});
    });

    expect(onError).not.toHaveBeenCalled();
  });
});

function createDeferred() {
  let reject;
  let resolve;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

async function settle(deferred, result) {
  await act(async () => {
    deferred.resolve(result);
    await deferred.promise;
  });
}
