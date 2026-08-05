export function createFixedWindowRateLimiter({
  database,
  namespace,
  limit,
  periodSeconds,
  now = Date.now,
}) {
  assertDatabase(database);
  if (typeof namespace !== 'string' || !/^[a-z0-9_-]{1,64}$/u.test(namespace)) {
    throw new TypeError('Rate-limit namespace is invalid.');
  }
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('Rate limit is invalid.');
  if (!Number.isSafeInteger(periodSeconds) || periodSeconds <= 0) {
    throw new TypeError('Rate-limit period is invalid.');
  }
  if (typeof now !== 'function') throw new TypeError('Rate-limit clock is invalid.');
  const periodMs = periodSeconds * 1000;

  return Object.freeze({
    async limit({ key } = {}) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
        throw new TypeError('Rate-limit key is invalid.');
      }
      const currentTime = now();
      if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
        throw new TypeError('Rate-limit clock is invalid.');
      }
      const windowStartedAt = Math.floor(currentTime / periodMs) * periodMs;
      database.exec('BEGIN IMMEDIATE');
      try {
        database.prepare(`
          DELETE FROM server_rate_limits
          WHERE namespace = ? AND window_started_at < ?
        `).run(namespace, windowStartedAt);
        database.prepare(`
          INSERT INTO server_rate_limits (namespace, key, window_started_at, count)
          VALUES (?, ?, ?, 1)
          ON CONFLICT (namespace, key, window_started_at)
          DO UPDATE SET count = count + 1
        `).run(namespace, key, windowStartedAt);
        const row = database.prepare(`
          SELECT count
          FROM server_rate_limits
          WHERE namespace = ? AND key = ? AND window_started_at = ?
        `).get(namespace, key, windowStartedAt);
        database.exec('COMMIT');
        return { success: Number(row?.count) <= limit };
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  });
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== 'function' || typeof database.exec !== 'function') {
    throw new TypeError('SQLite database is invalid.');
  }
}
