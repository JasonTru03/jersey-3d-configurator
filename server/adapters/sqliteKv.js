const MAX_KEY_LENGTH = 512;
const MAX_VALUE_BYTES = 1024 * 1024;

export function createSqliteKv({ database, namespace, now = Date.now }) {
  assertDatabase(database);
  assertIdentifier(namespace, 'KV namespace');
  if (typeof now !== 'function') throw new TypeError('KV clock is invalid.');

  return Object.freeze({
    async put(key, value, options = {}) {
      assertKey(key);
      if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_VALUE_BYTES) {
        throw new TypeError('KV value is invalid.');
      }
      const expirationTtl = options?.expirationTtl;
      if (!Number.isSafeInteger(expirationTtl) || expirationTtl <= 0) {
        throw new TypeError('KV expiration TTL is invalid.');
      }
      const currentTime = readNow(now);
      const expiresAt = currentTime + expirationTtl * 1000;
      if (!Number.isSafeInteger(expiresAt)) throw new TypeError('KV expiration is invalid.');
      database.prepare(`
        DELETE FROM server_kv
        WHERE namespace = ? AND expires_at IS NOT NULL AND expires_at <= ?
      `).run(namespace, currentTime);
      database.prepare(`
        INSERT INTO server_kv (namespace, key, value, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (namespace, key) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at
      `).run(namespace, key, value, expiresAt);
    },

    async get(key, type = 'text') {
      assertKey(key);
      if (type !== 'text') throw new TypeError('Only text KV reads are supported.');
      const currentTime = readNow(now);
      const row = database.prepare(`
        SELECT value, expires_at
        FROM server_kv
        WHERE namespace = ? AND key = ?
        LIMIT 1
      `).get(namespace, key);
      if (!row) return null;
      if (row.expires_at !== null && Number(row.expires_at) <= currentTime) {
        database.prepare('DELETE FROM server_kv WHERE namespace = ? AND key = ?')
          .run(namespace, key);
        return null;
      }
      return row.value;
    },
  });
}

function assertKey(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_KEY_LENGTH) {
    throw new TypeError('KV key is invalid.');
  }
}

function assertIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,64}$/u.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('SQLite database is invalid.');
  }
}

function readNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('KV clock is invalid.');
  return value;
}
