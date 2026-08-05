// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openServerDatabase } from './sqliteD1.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('server SQLite D1 adapter', () => {
  it('applies production and server migrations once and keeps data across reopen', async () => {
    const directory = await temporaryDirectory();
    const databasePath = path.join(directory, 'jersey.sqlite');
    const first = openServerDatabase({ databasePath, projectRoot: process.cwd() });

    await first.binding.prepare(`
      INSERT INTO server_kv (namespace, key, value, expires_at)
      VALUES (?, ?, ?, ?)
    `).bind('test', 'key', 'value', null).run();
    first.close();

    const second = openServerDatabase({ databasePath, projectRoot: process.cwd() });
    const row = await second.binding.prepare(`
      SELECT value FROM server_kv WHERE namespace = ? AND key = ?
    `).bind('test', 'key').first();
    const migrations = await second.binding.prepare(`
      SELECT name FROM server_schema_migrations ORDER BY name
    `).all();

    expect(row).toEqual({ value: 'value' });
    expect(migrations.results.map(({ name }) => name)).toEqual([
      'migrations/0001_production_designs.sql',
      'migrations/0002_free_tier_streaming_upload.sql',
      'server/migrations/0001_runtime.sql',
    ]);
    second.close();
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), 'jersey-server-db-'));
  temporaryDirectories.push(directory);
  return directory;
}
