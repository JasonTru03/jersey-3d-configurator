import { Trash2 } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CUSTOM_TEXT_FONT_PRESETS,
  MAX_CUSTOM_TEXT_ITEMS,
  createCustomTextItem,
  getCustomTextItems,
  nextTextId,
  patchCustomTextItem,
} from '../config/customTextItems.js';
import {
  findPersonalizationItem,
  getSelectablePersonalizationItems,
  makePersonalizationKey,
} from '../config/personalizationItems.js';
import {
  getPersonalizationSide,
  getPersonalizationSidePlacement,
} from '../config/personalizationSides.js';
import {
  ensurePrintItems,
  getPrintItems,
  legacyFirstItemFields,
  patchPrintItem,
} from '../config/printItems.js';
import { PersonalizationSideSelector } from './PersonalizationSideSelector.jsx';

export function PersonalizePanel({
  deletePending,
  deletePersonalization,
  onSelect,
  onSideFocus,
  onSidePendingChange,
  selectedKey,
  sidePending = false,
  state,
  updateState,
}) {
  const listRef = useRef(null);
  const pendingDeleteFocusRef = useRef(null);
  const previousDeletePendingRef = useRef(deletePending);
  const previousSelectionRef = useRef(selectedKey);
  const items = useMemo(() => getSelectablePersonalizationItems(state), [state]);
  const customTextItems = getCustomTextItems(state.overrides);
  const selectedItem = findPersonalizationItem(items, selectedKey);
  const {
    selectSide,
    sidePending: localSidePending,
  } = usePersonalizationSideMutation({
    onSideFocus,
    onSidePendingChange,
    selectedKey,
  });
  const mutationDisabled = deletePending || sidePending || localSidePending;

  useEffect(() => {
    const selectionClearedByDeletion = previousDeletePendingRef.current && !selectedKey;
    const selectionClearedByListDeletion = pendingDeleteFocusRef.current?.wasSelected;
    if (
      previousSelectionRef.current
      && !selectedKey
      && (!selectionClearedByDeletion || selectionClearedByListDeletion)
    ) {
      listRef.current?.focus();
    }
    previousDeletePendingRef.current = deletePending;
    previousSelectionRef.current = selectedKey;
  }, [deletePending, selectedKey]);

  useEffect(() => {
    const pending = pendingDeleteFocusRef.current;
    if (!pending || items.some((item) => item.key === pending.itemKey)) return;
    if (pending.wasSelected && selectedKey) {
      if (selectedKey !== pending.itemKey) pendingDeleteFocusRef.current = null;
      return;
    }
    pendingDeleteFocusRef.current = null;
    if (!pending.hadFocus || typeof document === 'undefined') return;

    const activeElement = document.activeElement;
    if (activeElement !== pending.trigger && activeElement !== document.body) return;
    if (pending.wasSelected) {
      listRef.current?.focus();
      return;
    }

    const rows = listRef.current?.querySelectorAll('.personalize-element-row');
    const nextRow = pending.rowIndex >= 0 && pending.rowIndex < (rows?.length ?? 0)
      ? rows[pending.rowIndex]
      : null;
    const focusTarget = nextRow?.querySelector('.personalize-element-select') ?? listRef.current;
    focusTarget?.focus();
  }, [items, selectedKey]);

  useEffect(() => {
    const pending = pendingDeleteFocusRef.current;
    if (deletePending || !pending?.failed || typeof document === 'undefined') return;
    pendingDeleteFocusRef.current = null;
    const activeElement = document.activeElement;
    if (
      pending.hadFocus
      && pending.trigger.isConnected
      && (activeElement === pending.trigger || activeElement === document.body)
    ) {
      pending.trigger.focus();
    }
  }, [deletePending]);

  const addPlayerSet = async () => {
    if (mutationDisabled) return;
    const printItems = ensurePrintItems(getPrintItems(state.overrides));
    const firstKey = makePersonalizationKey('player', printItems[0].id);
    const hasRawItems = Array.isArray(state.overrides?.printItems)
      && state.overrides.printItems.length > 0;
    if (state.lighting === 'none' || !hasRawItems) {
      const result = await updateState({
        lighting: state.lighting === 'none' ? 'name-number' : state.lighting,
        overrides: {
          printItems,
          ...legacyFirstItemFields(printItems),
        },
      });
      if (result?.ok === false) return;
    }
    onSelect(firstKey);
  };

  const addText = async () => {
    if (mutationDisabled || customTextItems.length >= MAX_CUSTOM_TEXT_ITEMS) return;
    let addedItem = null;
    const result = await updateState((latestState) => {
      const latestItems = getCustomTextItems(latestState.overrides);
      if (latestItems.length >= MAX_CUSTOM_TEXT_ITEMS) {
        return { overrides: { customTextItems: latestItems } };
      }
      addedItem = createCustomTextItem({
        id: nextTextId(latestItems),
        text: 'YOUR TEXT',
      });
      return {
        overrides: {
          customTextItems: [...latestItems, addedItem],
        },
      };
    });
    if (result?.ok === false || !addedItem) return;
    onSelect(makePersonalizationKey('text', addedItem.id));
  };

  const removeItem = (event, item) => {
    event.stopPropagation();
    if (mutationDisabled || !deletePersonalization) return;
    const trigger = event.currentTarget;
    const rows = Array.from(listRef.current?.children ?? []);
    const pendingFocus = {
      hadFocus: typeof document !== 'undefined' && document.activeElement === trigger,
      itemKey: item.key,
      rowIndex: rows.indexOf(trigger.closest('.personalize-element-row')),
      trigger,
      wasSelected: selectedKey === item.key,
    };
    void deletePersonalization(item.key, {
      onFailure: () => {
        pendingFocus.failed = true;
      },
      onStart: () => {
        pendingDeleteFocusRef.current = pendingFocus;
      },
    });
  };

  return (
    <section aria-label="Personalize jersey" className="personalize-panel">
      <div className="personalize-actions">
        <button aria-label="Add player set" className="soft-button" disabled={mutationDisabled} onClick={addPlayerSet} type="button">
          + Player set
        </button>
        <button
          aria-label="Add text"
          className="soft-button"
          disabled={mutationDisabled || customTextItems.length >= MAX_CUSTOM_TEXT_ITEMS}
          onClick={addText}
          type="button"
        >
          + Text
        </button>
      </div>
      <ul
        aria-label="Personalization elements"
        className="personalize-elements"
        ref={listRef}
        tabIndex="-1"
      >
        {items.map((item) => (
          <li className="personalize-element-row" key={item.key}>
            <button
              aria-pressed={item.key === selectedKey}
              className="personalize-element-select"
              onClick={() => onSelect(item.key)}
              type="button"
            >
              {personalizationLabel(item)}
            </button>
            <button
              aria-label={personalizationDeleteLabel(item)}
              className="personalize-element-delete"
              disabled={mutationDisabled}
              onClick={(event) => removeItem(event, item)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          </li>
        ))}
      </ul>
      {selectedItem && (
        <div className="personalize-editor">
          {selectedItem.itemKind === 'player' ? (
            <PlayerEditor
              disabled={mutationDisabled}
              item={selectedItem}
              selectSide={selectSide}
              updateState={updateState}
            />
          ) : (
            <TextEditor
              disabled={mutationDisabled}
              item={selectedItem}
              selectSide={selectSide}
              updateState={updateState}
            />
          )}
        </div>
      )}
    </section>
  );
}

function PlayerEditor({
  disabled,
  item,
  selectSide,
  updateState,
}) {
  const patchPlayer = (patch) => updateState((latestState) => {
    const nextItems = patchPrintItem(
      getPrintItems(latestState.overrides),
      item.sourceId,
      patch,
    );
    return {
      overrides: {
        printItems: nextItems,
        ...legacyFirstItemFields(nextItems),
      },
    };
  });
  const activeSide = getPersonalizationSide(item.placement);
  const selectItemSide = (side) => selectSide({
    activeSide,
    itemKey: item.key,
    side,
    updatePlacement: (placement) => patchPlayer({ placement }),
  });

  return (
    <div className="print-fields">
      <PersonalizationSideSelector
        disabled={disabled}
        onSelect={selectItemSide}
        side={activeSide}
      />
      <label>
        <span>Name</span>
        <input
          aria-label="Name"
          disabled={disabled}
          maxLength={14}
          onChange={(event) => patchPlayer({ name: event.target.value })}
          placeholder="PLAYER"
          type="text"
          value={item.name}
        />
      </label>
      <label>
        <span>Number</span>
        <input
          aria-label="Number"
          disabled={disabled}
          inputMode="numeric"
          maxLength={2}
          onChange={(event) => patchPlayer({ number: event.target.value })}
          placeholder="16"
          type="text"
          value={item.number}
        />
      </label>
      <p>Drag the selected element on the jersey to place it.</p>
    </div>
  );
}

function TextEditor({
  disabled,
  item,
  selectSide,
  updateState,
}) {
  const patchText = (patch) => updateState((latestState) => ({
    overrides: {
      customTextItems: patchCustomTextItem(
        getCustomTextItems(latestState.overrides),
        item.sourceId,
        patch,
      ),
    },
  }));
  const activeSide = getPersonalizationSide(item.placement);
  const selectItemSide = (side) => selectSide({
    activeSide,
    itemKey: item.key,
    side,
    updatePlacement: (placement) => patchText({ placement }),
  });

  return (
    <div className="custom-text-fields">
      <PersonalizationSideSelector
        disabled={disabled}
        onSelect={selectItemSide}
        side={activeSide}
      />
      <label>
        <span>Text</span>
        <input
          aria-label="Text content"
          disabled={disabled}
          maxLength={24}
          onChange={(event) => patchText({ text: event.target.value })}
          type="text"
          value={item.text}
        />
      </label>
      <fieldset>
        <legend>Font</legend>
        <div className="font-options">
          {CUSTOM_TEXT_FONT_PRESETS.map((font) => (
            <button
              aria-pressed={font.id === item.fontPreset}
              disabled={disabled}
              key={font.id}
              onClick={() => patchText({ fontPreset: font.id })}
              style={{ fontFamily: font.family }}
              type="button"
            >
              {font.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        <span>Fill color</span>
        <input
          aria-label="Fill color"
          disabled={disabled}
          onChange={(event) => patchText({ fillColor: event.target.value })}
          type="color"
          value={item.fillColor}
        />
      </label>
      <label>
        <input
          aria-label="Outline"
          checked={item.outlineEnabled}
          disabled={disabled}
          onChange={(event) => patchText({ outlineEnabled: event.target.checked })}
          type="checkbox"
        />
        <span>Outline</span>
      </label>
      <label>
        <span>Outline color</span>
        <input
          aria-label="Outline color"
          disabled={disabled}
          onChange={(event) => patchText({ outlineColor: event.target.value })}
          type="color"
          value={item.outlineColor}
        />
      </label>
      <label>
        <span>Letter spacing</span>
        <input
          aria-label="Letter spacing"
          disabled={disabled}
          max="20"
          min="0"
          onChange={(event) => patchText({ letterSpacing: Number(event.target.value) })}
          type="range"
          value={item.letterSpacing}
        />
      </label>
    </div>
  );
}

function usePersonalizationSideMutation({
  onSideFocus,
  onSidePendingChange,
  selectedKey,
}) {
  const activeOperationRef = useRef(null);
  const mountedRef = useRef(false);
  const nextTokenRef = useRef(0);
  const onSideFocusRef = useRef(onSideFocus);
  const onSidePendingChangeRef = useRef(onSidePendingChange);
  const selectionRef = useRef({ key: selectedKey, version: 0 });
  const [sidePending, setSidePending] = useState(false);

  useLayoutEffect(() => {
    onSideFocusRef.current = onSideFocus;
    onSidePendingChangeRef.current = onSidePendingChange;
    if (selectionRef.current.key !== selectedKey) {
      selectionRef.current = {
        key: selectedKey,
        version: selectionRef.current.version + 1,
      };
    }
  }, [onSideFocus, onSidePendingChange, selectedKey]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    if (!activeOperationRef.current) setSidePending(false);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const selectSide = async ({
    activeSide,
    itemKey,
    side,
    updatePlacement,
  }) => {
    if (activeOperationRef.current) return { ok: false, reason: 'pending' };
    if (side === activeSide) {
      onSideFocusRef.current?.(side);
      return { ok: true };
    }

    const operation = {
      itemKey,
      selectionVersion: selectionRef.current.version,
      token: ++nextTokenRef.current,
    };
    activeOperationRef.current = operation;
    onSidePendingChangeRef.current?.(true);
    setSidePending(true);
    try {
      const result = await updatePlacement(getPersonalizationSidePlacement(side));
      if (result?.ok === false) return result;
      if (
        !mountedRef.current
        || activeOperationRef.current?.token !== operation.token
        || selectionRef.current.key !== operation.itemKey
        || selectionRef.current.version !== operation.selectionVersion
      ) {
        return result ?? { ok: true };
      }
      onSideFocusRef.current?.(side);
      return result ?? { ok: true };
    } finally {
      if (activeOperationRef.current?.token === operation.token) {
        activeOperationRef.current = null;
        onSidePendingChangeRef.current?.(false);
        if (mountedRef.current) setSidePending(false);
      }
    }
  };

  return { selectSide, sidePending };
}

function personalizationLabel(item) {
  if (item.itemKind === 'text') return item.text.trim() || 'Empty text';
  return [item.name.trim(), item.number.trim()].filter(Boolean).join(' · ') || 'Player set';
}

function personalizationDeleteLabel(item) {
  const type = item.itemKind === 'text' ? 'text' : 'player set';
  return `Delete ${type} ${personalizationLabel(item)} (${item.sourceId})`;
}
