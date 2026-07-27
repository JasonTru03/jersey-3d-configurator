import { describe, expect, it } from 'vitest';
import { getWorkerHandler } from './index.js';

describe('Worker entrypoint handler cache', () => {
  it('reuses one handler for the same env without sharing handlers across env objects', () => {
    const firstEnv = {};
    const secondEnv = {};

    expect(getWorkerHandler(firstEnv)).toBe(getWorkerHandler(firstEnv));
    expect(getWorkerHandler(secondEnv)).toBe(getWorkerHandler(secondEnv));
    expect(getWorkerHandler(firstEnv)).not.toBe(getWorkerHandler(secondEnv));
  });
});
