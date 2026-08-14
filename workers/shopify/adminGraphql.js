const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const TOKEN_PATTERN = /^[\u0021-\u007e]{16,1024}$/u;
const MAX_RESPONSE_BYTES = 1024 * 1024;
export const ADMIN_GRAPHQL_TIMEOUT_MS = 12_000;

export function createAdminGraphqlClient({ shop, accessToken, fetchImpl = fetch }) {
  if (!SHOP_PATTERN.test(shop) || !TOKEN_PATTERN.test(accessToken) || typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid Shopify Admin API client configuration.');
  }
  return async function graphql(query, variables = {}) {
    if (typeof query !== 'string' || query.length < 1 || query.length > 100_000
      || !variables || typeof variables !== 'object' || Array.isArray(variables)) {
      throw new AdminGraphqlError('ADMIN_GRAPHQL_INPUT_INVALID');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ADMIN_GRAPHQL_TIMEOUT_MS);
    let response;
    let text;
    try {
      response = await fetchImpl(`https://${shop}/admin/api/2026-07/graphql.json`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ query, variables }),
        redirect: 'error',
        signal: controller.signal,
      });
      text = await response.text();
    } catch { throw new AdminGraphqlError('ADMIN_GRAPHQL_NETWORK_FAILED'); }
    finally { clearTimeout(timeoutId); }
    if (!response.ok || new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) {
      throw new AdminGraphqlError(`ADMIN_GRAPHQL_HTTP_${response.status}`);
    }
    let payload;
    try { payload = JSON.parse(text); } catch { throw new AdminGraphqlError('ADMIN_GRAPHQL_JSON_INVALID'); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || (Array.isArray(payload.errors) && payload.errors.length > 0)
      || !payload.data || typeof payload.data !== 'object') {
      throw new AdminGraphqlError('ADMIN_GRAPHQL_RESPONSE_INVALID');
    }
    return payload.data;
  };
}

export class AdminGraphqlError extends Error {
  constructor(code) {
    super('Shopify Admin API request failed.');
    this.name = 'AdminGraphqlError';
    this.code = code;
  }
}
