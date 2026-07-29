import { useCallback, useEffect, useRef, useState } from 'react';
import { getPersonalizationRemovalPatch } from '../config/personalizationItems.js';

export function usePersonalizationDeletion({
  onError,
  onSelectionChange,
  selectedKey,
  state,
  updateState,
}) {
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const latestRef = useRef(null);
  const [deletePending, setDeletePending] = useState(false);
  latestRef.current = {
    onError,
    onSelectionChange,
    selectedKey,
    state,
    updateState,
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const deletePersonalization = useCallback(async (key, options = {}) => {
    if (inFlightRef.current) return { ok: false, reason: 'pending' };
    const current = latestRef.current;
    if (!getPersonalizationRemovalPatch(current.state, key)) {
      return { ok: false, reason: 'missing' };
    }

    inFlightRef.current = true;
    setDeletePending(true);
    options.onStart?.();
    try {
      let targetFound = false;
      const result = await current.updateState((latestState) => {
        const patch = getPersonalizationRemovalPatch(latestState, key);
        targetFound = Boolean(patch);
        return patch ?? {};
      }, { transactional: true });
      if (result?.ok === false) {
        options.onFailure?.();
        return result;
      }
      if (!targetFound) {
        options.onFailure?.();
        return { ok: false, reason: 'missing' };
      }
      if (mountedRef.current && latestRef.current.selectedKey === key) {
        latestRef.current.onSelectionChange?.(null);
      }
      options.onSuccess?.();
      return result ?? { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Personalization deletion failed.';
      options.onFailure?.();
      if (mountedRef.current) latestRef.current.onError?.(message);
      return { message, ok: false };
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setDeletePending(false);
    }
  }, []);

  return { deletePending, deletePersonalization };
}
