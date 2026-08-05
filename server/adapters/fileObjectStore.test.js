// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileObjectStore } from './fileObjectStore.js';
import { openServerDatabase } from './sqliteD1.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('server file object store', () => {
  it('streams an object to disk and restores its R2-compatible metadata after reopen', async () => {
    const runtime = await createRuntime();
    const bytes = new TextEncoder().encode('{"ok":true}');
    const sha256 = hash(bytes);
    const key = 'shops/shop_example/designs/dsg_example/manifest.json';

    await expect(runtime.store.put(key, new Blob([bytes]).stream(), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { sha256, contentLength: String(bytes.byteLength) },
      sha256,
    })).resolves.toEqual({ key, size: bytes.byteLength });
    runtime.database.close();

    const reopened = openServerDatabase({
      databasePath: runtime.databasePath,
      projectRoot: process.cwd(),
    });
    const store = createFileObjectStore({
      database: reopened.database,
      rootDirectory: runtime.objectDirectory,
    });
    const head = await store.head(key);
    const object = await store.get(key);

    expect(head).toMatchObject({
      key,
      size: bytes.byteLength,
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { sha256, contentLength: String(bytes.byteLength) },
    });
    expect(hex(head.checksums.sha256)).toBe(sha256);
    expect(new Uint8Array(await object.arrayBuffer())).toEqual(bytes);
    await store.delete([key]);
    await expect(store.head(key)).resolves.toBeNull();
    reopened.close();
  });

  it('rejects a mismatched checksum and unsafe object keys without leaving readable objects', async () => {
    const runtime = await createRuntime();
    const bytes = new TextEncoder().encode('unsafe');
    const key = 'shops/shop_example/designs/dsg_example/bundle.zip';

    await expect(runtime.store.put(key, bytes, {
      httpMetadata: { contentType: 'application/zip' },
      customMetadata: { sha256: '0'.repeat(64) },
      sha256: '0'.repeat(64),
    })).rejects.toThrow('checksum');
    await expect(runtime.store.head(key)).resolves.toBeNull();
    await expect(runtime.store.put('../outside.zip', bytes, {
      sha256: hash(bytes),
    })).rejects.toThrow('key');
    runtime.database.close();
  });
});

async function createRuntime() {
  const directory = await mkdtemp(path.join(tmpdir(), 'jersey-server-objects-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'jersey.sqlite');
  const objectDirectory = path.join(directory, 'objects');
  const opened = openServerDatabase({ databasePath, projectRoot: process.cwd() });
  return {
    ...opened,
    databasePath,
    objectDirectory,
    store: createFileObjectStore({ database: opened.database, rootDirectory: objectDirectory }),
  };
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hex(value) {
  return Buffer.from(value).toString('hex');
}
