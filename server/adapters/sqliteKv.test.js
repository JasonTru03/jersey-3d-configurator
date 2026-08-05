// @vitest-environment node

import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createSqliteKv } from './sqliteKv.js';

describe('server SQLite KV', () => {
  it('persists text values and expires them using KV-compatible TTL seconds', async () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE server_kv (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER,
        PRIMARY KEY (namespace, key)
      );
    `);
    let now = 1_700_000_000_000;
    const kv = createSqliteKv({ database, namespace: 'quotes', now: () => now });

    await kv.put('design', '{"ok":true}', { expirationTtl: 60 });
    await expect(kv.get('design', 'text')).resolves.toBe('{"ok":true}');
    now += 60_000;
    await expect(kv.get('design', 'text')).resolves.toBeNull();
    database.close();
  });
});
