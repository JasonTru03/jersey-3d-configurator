// @vitest-environment node

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createFixedWindowRateLimiter } from './fixedWindowRateLimit.js';

describe('server fixed-window rate limiter', () => {
  it('rejects requests over the configured limit and resets in the next window', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE server_rate_limits (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        window_started_at INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (namespace, key, window_started_at)
      );
    `);
    let now = 1_700_000_000_000;
    const limiter = createFixedWindowRateLimiter({
      database,
      namespace: 'uploads',
      limit: 2,
      periodSeconds: 60,
      now: () => now,
    });

    await expect(limiter.limit({ key: 'client' })).resolves.toEqual({ success: true });
    await expect(limiter.limit({ key: 'client' })).resolves.toEqual({ success: true });
    await expect(limiter.limit({ key: 'client' })).resolves.toEqual({ success: false });
    now += 60_000;
    await expect(limiter.limit({ key: 'client' })).resolves.toEqual({ success: true });
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM server_rate_limits WHERE namespace = ?
    `).get('uploads').count).toBe(1);
    database.close();
  });
});
