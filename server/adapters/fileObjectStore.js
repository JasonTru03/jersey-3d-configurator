import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024 + 64 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function createFileObjectStore({
  database,
  rootDirectory,
  maxObjectBytes = DEFAULT_MAX_BYTES,
  now = Date.now,
}) {
  assertDatabase(database);
  if (typeof rootDirectory !== 'string' || !path.isAbsolute(rootDirectory)) {
    throw new TypeError('Object storage directory must be absolute.');
  }
  if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes <= 0) {
    throw new TypeError('Object storage size limit is invalid.');
  }
  if (typeof now !== 'function') throw new TypeError('Object storage clock is invalid.');

  return Object.freeze({
    async put(key, body, options = {}) {
      return putObject({
        body,
        database,
        key: validateKey(key),
        maxObjectBytes,
        now,
        options,
        rootDirectory,
      });
    },
    async head(key) {
      return readObject({ database, key: validateKey(key), rootDirectory, withBody: false });
    },
    async get(key) {
      return readObject({ database, key: validateKey(key), rootDirectory, withBody: true });
    },
    async delete(key) {
      const keys = Array.isArray(key) ? key.map(validateKey) : [validateKey(key)];
      if (keys.length === 0 || keys.length > 1000 || new Set(keys).size !== keys.length) {
        throw new TypeError('Object keys are invalid.');
      }
      for (const item of keys) {
        await deleteObject({ database, key: item, rootDirectory });
      }
    },
  });
}

async function putObject({ body, database, key, maxObjectBytes, now, options, rootDirectory }) {
  const expectedSha256 = options?.sha256;
  if (!SHA256_PATTERN.test(expectedSha256 ?? '')) {
    throw new TypeError('Object checksum is invalid.');
  }
  const httpMetadata = validateMetadata(options.httpMetadata, 'HTTP metadata');
  const customMetadata = validateMetadata(options.customMetadata, 'custom metadata');
  const target = objectPath(rootDirectory, key);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  let handle;
  let size = 0;
  const hash = createHash('sha256');
  try {
    handle = await open(temporary, 'wx', 0o600);
    for await (const chunk of bodyChunks(body)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > maxObjectBytes) throw new TypeError('Object body exceeds the size limit.');
      hash.update(bytes);
      await writeAll(handle, bytes);
    }
    await handle.sync();
    await handle.close();
    handle = null;
    const nativeSha256 = hash.digest('hex');
    if (nativeSha256 !== expectedSha256) throw new TypeError('Object checksum does not match.');
    const currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      throw new TypeError('Object storage clock is invalid.');
    }
    await rename(temporary, target);
    database.prepare(`
      INSERT INTO server_objects (
        key, size, native_sha256, http_metadata_json, custom_metadata_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET
        size = excluded.size,
        native_sha256 = excluded.native_sha256,
        http_metadata_json = excluded.http_metadata_json,
        custom_metadata_json = excluded.custom_metadata_json,
        updated_at = excluded.updated_at
    `).run(
      key,
      size,
      nativeSha256,
      JSON.stringify(httpMetadata),
      JSON.stringify(customMetadata),
      currentTime,
      currentTime,
    );
    return { key, size };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readObject({ database, key, rootDirectory, withBody }) {
  const row = database.prepare(`
    SELECT key, size, native_sha256, http_metadata_json, custom_metadata_json
    FROM server_objects
    WHERE key = ?
    LIMIT 1
  `).get(key);
  if (!row) return null;
  const filename = objectPath(rootDirectory, key);
  let fileStatus;
  try {
    fileStatus = await stat(filename);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!fileStatus.isFile() || fileStatus.size !== Number(row.size)) return null;
  const checksum = Buffer.from(row.native_sha256, 'hex');
  const head = {
    key: row.key,
    size: Number(row.size),
    checksums: {
      sha256: checksum.buffer.slice(checksum.byteOffset, checksum.byteOffset + checksum.byteLength),
    },
    httpMetadata: parseMetadata(row.http_metadata_json),
    customMetadata: parseMetadata(row.custom_metadata_json),
  };
  if (!withBody) return head;
  return {
    ...head,
    body: Readable.toWeb(createReadStream(filename)),
    async arrayBuffer() {
      const bytes = await readFile(filename);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function deleteObject({ database, key, rootDirectory }) {
  await rm(objectPath(rootDirectory, key), { force: true });
  database.prepare('DELETE FROM server_objects WHERE key = ?').run(key);
}

function objectPath(rootDirectory, key) {
  const digest = createHash('sha256').update(key).digest('hex');
  return path.join(rootDirectory, digest.slice(0, 2), digest);
}

function validateKey(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 1024
    || value.startsWith('/')
    || /[\u0000-\u001f\u007f\\]/u.test(value)
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError('Object key is invalid.');
  }
  return value;
}

function validateMetadata(value, label) {
  if (value === undefined) return {};
  if (!isPlainObject(value)
    || Object.entries(value).some(([key, item]) => (
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key)
      || typeof item !== 'string'
      || item.length > 1024
    ))) {
    throw new TypeError(`Object ${label} is invalid.`);
  }
  return { ...value };
}

function parseMetadata(value) {
  const parsed = JSON.parse(value);
  if (!isPlainObject(parsed)) throw new TypeError('Stored object metadata is invalid.');
  return parsed;
}

async function* bodyChunks(body) {
  if (body instanceof Blob) {
    yield* body.stream();
    return;
  }
  if (body instanceof ReadableStream) {
    yield* body;
    return;
  }
  if (body instanceof ArrayBuffer) {
    yield new Uint8Array(body);
    return;
  }
  if (ArrayBuffer.isView(body)) {
    yield new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    return;
  }
  throw new TypeError('Object body is invalid.');
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (bytesWritten <= 0) throw new Error('Object body write failed.');
    offset += bytesWritten;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('SQLite database is invalid.');
  }
}
