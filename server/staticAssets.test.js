// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStaticAssetsBinding } from './staticAssets.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('server static assets binding', () => {
  it('serves built files, supports SPA fallback, and blocks traversal', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'jersey-static-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'index.html'), '<h1>Jersey</h1>');
    await writeFile(path.join(directory, 'app.js'), 'console.log("ok")');
    const assets = createStaticAssetsBinding(directory);

    const script = await assets.fetch(new Request('https://example.test/app.js'));
    const spa = await assets.fetch(new Request('https://example.test/design/123'));
    const traversal = await assets.fetch(new Request('https://example.test/%2e%2e%2fsecret'));

    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(await script.text()).toBe('console.log("ok")');
    expect(await spa.text()).toBe('<h1>Jersey</h1>');
    expect(traversal.status).toBe(404);
  });
});
