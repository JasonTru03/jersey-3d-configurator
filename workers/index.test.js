import { describe, expect, it, vi } from 'vitest';
import worker, { getWorkerHandler } from './index.js';

const cleanupMocks = vi.hoisted(() => ({
  cleanExpiredProductionDrafts: vi.fn(),
}));

vi.mock('./production/cleanupDrafts.js', () => cleanupMocks);

describe('Worker entrypoint handler cache', () => {
  it('reuses one handler for the same env without sharing handlers across env objects', () => {
    const firstEnv = {};
    const secondEnv = {};

    expect(getWorkerHandler(firstEnv)).toBe(getWorkerHandler(firstEnv));
    expect(getWorkerHandler(secondEnv)).toBe(getWorkerHandler(secondEnv));
    expect(getWorkerHandler(firstEnv)).not.toBe(getWorkerHandler(secondEnv));
  });
});

describe('Worker scheduled cleanup entrypoint', () => {
  it('registers the cleanup promise with waitUntil without awaiting it', () => {
    const cleanupPromise = new Promise(() => {});
    cleanupMocks.cleanExpiredProductionDrafts.mockReturnValueOnce(cleanupPromise);
    const controller = { scheduledTime: 1_700_000_000_000 };
    const env = {};
    const ctx = { waitUntil: vi.fn() };

    expect(worker.scheduled(controller, env, ctx)).toBeUndefined();
    expect(cleanupMocks.cleanExpiredProductionDrafts)
      .toHaveBeenCalledWith(env, controller.scheduledTime);
    expect(ctx.waitUntil).toHaveBeenCalledWith(cleanupPromise);
  });
});
