import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATION_DIRECTORIES = ['migrations', 'server/migrations'];

export function openServerDatabase({ databasePath, projectRoot }) {
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
    throw new TypeError('Server database path must be absolute.');
  }
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    throw new TypeError('Project root must be absolute.');
  }
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    configureDatabase(database);
    applyMigrations(database, projectRoot);
  } catch (error) {
    database.close();
    throw error;
  }
  return {
    database,
    binding: createD1Binding(database),
    close: () => database.close(),
  };
}

export function createD1Binding(database) {
  assertDatabase(database);
  return Object.freeze({
    prepare: (sql) => new D1Statement(database, sql),
    async batch(statements) {
      if (!Array.isArray(statements) || statements.length === 0) {
        throw new TypeError('D1 batch statements are required.');
      }
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => statement.executeBatch());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  });
}

function configureDatabase(database) {
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec(`
    CREATE TABLE IF NOT EXISTS server_schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
}

function applyMigrations(database, projectRoot) {
  const applied = database.prepare('SELECT name FROM server_schema_migrations')
    .all()
    .map(({ name }) => name);
  const appliedNames = new Set(applied);
  for (const directory of MIGRATION_DIRECTORIES) {
    const absoluteDirectory = path.join(projectRoot, ...directory.split('/'));
    const filenames = readdirSync(absoluteDirectory)
      .filter((filename) => /^[0-9]{4}_[a-z0-9_-]+\.sql$/u.test(filename))
      .sort();
    for (const filename of filenames) {
      const name = `${directory}/${filename}`;
      if (appliedNames.has(name)) continue;
      applyMigration(database, name, path.join(absoluteDirectory, filename));
      appliedNames.add(name);
    }
  }
}

function applyMigration(database, name, filename) {
  const sql = readFileSync(filename, 'utf8');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(sql);
    database.prepare(`
      INSERT INTO server_schema_migrations (name, applied_at)
      VALUES (?, ?)
    `).run(name, Date.now());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

class D1Statement {
  constructor(database, sql) {
    if (typeof sql !== 'string' || sql.trim() === '') throw new TypeError('D1 SQL is required.');
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    return d1Result({ results: this.database.prepare(this.sql).all(...this.values) });
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values) ?? null;
    return column === undefined ? row : row?.[column] ?? null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return d1Result({ changes: Number(result.changes) });
  }

  executeBatch() {
    if (isWriteSql(this.sql)) {
      const result = this.database.prepare(this.sql).run(...this.values);
      return d1Result({ changes: Number(result.changes) });
    }
    return d1Result({ results: this.database.prepare(this.sql).all(...this.values) });
  }
}

function isWriteSql(sql) {
  return /^\s*(?:INSERT|UPDATE|DELETE)\b/iu.test(sql)
    || /\bUPDATE\s+production_designs\b/iu.test(sql)
    || /\bINSERT\s+OR\s+IGNORE\s+INTO\s+shopify_webhook_deliveries\b/iu.test(sql);
}

function d1Result({ changes = 0, results = [] } = {}) {
  return { success: true, meta: { changes }, results };
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== 'function' || typeof database.exec !== 'function') {
    throw new TypeError('SQLite database is invalid.');
  }
}
