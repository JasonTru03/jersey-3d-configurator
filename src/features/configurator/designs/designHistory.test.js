import { describe, expect, it } from 'vitest';
import {
  createDesignHistory,
  getCurrentDesignState,
  moveDesignHistory,
  recordDesignState,
  replaceCurrentDesignState,
} from './designHistory.js';

describe('design history', () => {
  it('drops redo states after recording a new change from an undone state', () => {
    let history = createDesignHistory({ colorway: 'home' });
    history = recordDesignState(history, { colorway: 'away' });
    history = recordDesignState(history, { colorway: 'third' });
    history = moveDesignHistory(history, -1);
    history = recordDesignState(history, { colorway: 'home' });

    expect(history.entries).toHaveLength(3);
    expect(getCurrentDesignState(history)).toEqual({ colorway: 'home' });
    expect(moveDesignHistory(history, 1)).toBe(history);
  });

  it('keeps only the most recent fifty design snapshots', () => {
    let history = createDesignHistory({ step: 0 });

    for (let step = 1; step <= 55; step += 1) {
      history = recordDesignState(history, { step });
    }

    expect(history.entries).toHaveLength(50);
    expect(history.entries[0]).toEqual({ step: 6 });
    expect(getCurrentDesignState(history)).toEqual({ step: 55 });
  });

  it('normalizes the current snapshot without adding history or truncating redo', () => {
    let history = createDesignHistory({ step: 0 });
    history = recordDesignState(history, { step: 1, scale: 1.8 });
    history = recordDesignState(history, { step: 2 });
    history = moveDesignHistory(history, -1);

    const normalized = replaceCurrentDesignState(history, { step: 1, scale: 1.0261 });

    expect(normalized.cursor).toBe(1);
    expect(normalized.entries).toHaveLength(3);
    expect(getCurrentDesignState(normalized)).toEqual({ step: 1, scale: 1.0261 });
    expect(getCurrentDesignState(moveDesignHistory(normalized, 1))).toEqual({ step: 2 });
    expect(getCurrentDesignState(moveDesignHistory(normalized, -1))).toEqual({ step: 0 });
  });
});
