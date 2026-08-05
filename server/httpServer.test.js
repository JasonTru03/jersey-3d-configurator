// @vitest-environment node

import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeHttpServer } from './httpServer.js';

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('Node HTTP bridge', () => {
  it('exposes health and forwards streamed requests to the Fetch handler', async () => {
    const handler = async (request) => Response.json({
      body: await request.text(),
      ip: request.headers.get('cf-connecting-ip'),
      url: request.url,
    });
    const server = createNodeHttpServer({
      handler,
      publicOrigin: 'https://jersey.example',
      trustProxy: true,
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    const forwarded = await fetch(`http://127.0.0.1:${port}/api/test?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'x-forwarded-for': '203.0.113.7' },
      body: 'payload',
    });

    expect(await health.json()).toEqual({ ok: true });
    expect(await forwarded.json()).toEqual({
      body: 'payload',
      ip: '203.0.113.7',
      url: 'https://jersey.example/api/test?x=1',
    });
  });
});
