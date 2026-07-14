export const DESIGN_HISTORY_LIMIT = 50;

export function createDesignHistory(initialState) {
  return { cursor: 0, entries: [structuredClone(initialState)] };
}

export function recordDesignState(history, nextState) {
  if (JSON.stringify(getCurrentDesignState(history)) === JSON.stringify(nextState)) {
    return history;
  }

  const entries = [
    ...history.entries.slice(0, history.cursor + 1),
    structuredClone(nextState),
  ].slice(-DESIGN_HISTORY_LIMIT);

  return { cursor: entries.length - 1, entries };
}

export function moveDesignHistory(history, offset) {
  const cursor = Math.min(history.entries.length - 1, Math.max(0, history.cursor + offset));
  return cursor === history.cursor ? history : { ...history, cursor };
}

export function getCurrentDesignState(history) {
  return history ? structuredClone(history.entries[history.cursor]) : null;
}
