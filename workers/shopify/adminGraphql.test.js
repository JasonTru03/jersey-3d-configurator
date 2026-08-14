import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_GRAPHQL_TIMEOUT_MS,
  AdminGraphqlError,
  createAdminGraphqlClient,
} from './adminGraphql.js';

const SHOP = 'graphql-test.myshopify.com';
const TOKEN = 'shpat_graphql_private_token_123456';

afterEach(() => vi.useRealTimers());

describe('Shopify Admin GraphQL client', () => {
  it('sends a bounded authenticated request and returns data only', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: { shop: { name: 'Test' } } }));
    const graphql = createAdminGraphqlClient({ shop: SHOP, accessToken: TOKEN, fetchImpl });

    await expect(graphql('query Test { shop { name } }')).resolves.toEqual({ shop: { name: 'Test' } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://${SHOP}/admin/api/2026-07/graphql.json`);
    expect(init.headers['X-Shopify-Access-Token']).toBe(TOKEN);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts a stalled request without exposing the access token in the error', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const graphql = createAdminGraphqlClient({ shop: SHOP, accessToken: TOKEN, fetchImpl });
    const pending = graphql('query Test { shop { name } }');
    const captured = pending.catch((error) => error);
    await vi.advanceTimersByTimeAsync(ADMIN_GRAPHQL_TIMEOUT_MS);

    const error = await captured;
    expect(error).toBeInstanceOf(AdminGraphqlError);
    expect(error.message).not.toContain(TOKEN);
  });

  it('rejects GraphQL errors and oversized responses with sanitized failures', async () => {
    const graphError = createAdminGraphqlClient({
      shop: SHOP,
      accessToken: TOKEN,
      fetchImpl: async () => Response.json({ errors: [{ message: 'private upstream detail' }] }),
    });
    await expect(graphError('query Test { shop { name } }'))
      .rejects.toMatchObject({ code: 'ADMIN_GRAPHQL_RESPONSE_INVALID' });

    const oversized = createAdminGraphqlClient({
      shop: SHOP,
      accessToken: TOKEN,
      fetchImpl: async () => new Response('x'.repeat(1024 * 1024 + 1)),
    });
    await expect(oversized('query Test { shop { name } }'))
      .rejects.toMatchObject({ code: 'ADMIN_GRAPHQL_HTTP_200' });
  });
});
