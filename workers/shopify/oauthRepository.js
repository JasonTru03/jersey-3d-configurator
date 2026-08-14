const SHOP_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const WEBHOOK_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const STATUS_VALUES = new Set(['active', 'scope_invalid', 'uninstalled']);
const EVENT_VALUES = new Set(['installed', 'reinstalled', 'scopes_updated', 'uninstalled']);

export function createOAuthRepository(db) {
  assertDatabase(db);
  return Object.freeze({
    createSession: (input) => createSession(db, input),
    consumeSession: (input) => consumeSession(db, input),
    getInstallation: (shop) => getInstallation(db, shop),
    saveInstallation: (input) => saveInstallation(db, input),
    updateScopes: (input) => updateScopes(db, input),
    markUninstalled: (input) => markUninstalled(db, input),
  });
}

async function createSession(db, input) {
  const value = validateSession(input);
  const statements = [
    db.prepare('DELETE FROM shopify_oauth_sessions WHERE expires_at < ?').bind(value.createdAt),
    db.prepare(`
      INSERT INTO shopify_oauth_sessions (
        state_hash, shop, status, created_at, expires_at, consumed_at
      ) VALUES (?, ?, 'pending', ?, ?, NULL)
    `).bind(value.stateHash, value.shop, value.createdAt, value.expiresAt),
  ];
  const results = await db.batch(statements);
  assertBatch(results, statements.length);
  assertChanged(results[1]);
}

async function consumeSession(db, input) {
  if (!isPlainObject(input)) throw invalidInput();
  const stateHash = requirePattern(input.stateHash, HASH_PATTERN);
  const shop = requirePattern(input.shop, SHOP_PATTERN);
  const consumedAt = requireTimestamp(input.consumedAt);
  const result = await db.prepare(`
    UPDATE shopify_oauth_sessions
    SET status = 'consumed', consumed_at = ?
    WHERE state_hash = ? AND shop = ? AND status = 'pending'
      AND expires_at >= ?
  `).bind(consumedAt, stateHash, shop, consumedAt).run();
  assertChanged(result, 'oauth-session-invalid');
}

async function getInstallation(db, shopInput) {
  const shop = requirePattern(shopInput, SHOP_PATTERN);
  const row = await db.prepare(`
    SELECT shop, status, access_token_ciphertext, access_token_iv,
      token_key_version, granted_scopes_json, installed_at, updated_at, uninstalled_at
    FROM shopify_installations WHERE shop = ? LIMIT 1
  `).bind(shop).first();
  return row ? normalizeInstallation(row) : null;
}

async function saveInstallation(db, input) {
  const value = validateInstallation(input);
  const previous = await getInstallation(db, value.shop);
  const event = previous === null
    ? 'installed'
    : previous.status === 'uninstalled' ? 'reinstalled' : 'scopes_updated';
  const statements = [
    db.prepare(`
      INSERT INTO shopify_installations (
        shop, status, access_token_ciphertext, access_token_iv, token_key_version,
        granted_scopes_json, installed_at, updated_at, uninstalled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(shop) DO UPDATE SET
        status = excluded.status,
        access_token_ciphertext = excluded.access_token_ciphertext,
        access_token_iv = excluded.access_token_iv,
        token_key_version = excluded.token_key_version,
        granted_scopes_json = excluded.granted_scopes_json,
        installed_at = excluded.installed_at,
        updated_at = excluded.updated_at,
        uninstalled_at = NULL
    `).bind(
      value.shop, value.status, value.ciphertext, value.iv, value.keyVersion,
      JSON.stringify(value.scopes), value.installedAt, value.installedAt,
    ),
    auditStatement(db, {
      shop: value.shop,
      event,
      scopes: value.scopes,
      createdAt: value.installedAt,
      webhookId: null,
      processedAt: value.installedAt,
    }),
  ];
  assertBatch(await db.batch(statements), statements.length);
}

async function updateScopes(db, input) {
  const value = validateLifecycle(input, 'scopes_updated');
  const status = value.requiredScopes.every((scope) => value.scopes.includes(scope))
    ? 'active'
    : 'scope_invalid';
  const statements = [
    auditStatement(db, value),
    db.prepare(`
      UPDATE shopify_installations
      SET status = ?, granted_scopes_json = ?, updated_at = ?
      WHERE shop = ? AND status IN ('active', 'scope_invalid')
        AND updated_at <= ?
        AND EXISTS (
          SELECT 1 FROM shopify_installation_audit
          WHERE webhook_id = ? AND processed_at IS NULL
        )
    `).bind(
      status, JSON.stringify(value.scopes), value.createdAt, value.shop,
      value.createdAt, value.webhookId,
    ),
    processedStatement(db, value.webhookId, value.createdAt),
  ];
  const results = await db.batch(statements);
  assertBatch(results, statements.length);
  return status;
}

async function markUninstalled(db, input) {
  const value = validateLifecycle(input, 'uninstalled');
  const statements = [
    auditStatement(db, value),
    db.prepare(`
      UPDATE shopify_installations
      SET status = 'uninstalled', access_token_ciphertext = NULL,
        access_token_iv = NULL, token_key_version = NULL,
        granted_scopes_json = '[]', updated_at = ?, uninstalled_at = ?
      WHERE shop = ?
        AND EXISTS (
          SELECT 1 FROM shopify_installation_audit
          WHERE webhook_id = ? AND processed_at IS NULL
        )
    `).bind(value.createdAt, value.createdAt, value.shop, value.webhookId),
    processedStatement(db, value.webhookId, value.createdAt),
  ];
  assertBatch(await db.batch(statements), statements.length);
}

function auditStatement(db, input) {
  const webhookId = input.webhookId === null
    ? null
    : requirePattern(input.webhookId, WEBHOOK_ID_PATTERN);
  return db.prepare(`
    INSERT OR IGNORE INTO shopify_installation_audit (
      webhook_id, shop, event, granted_scopes_json, created_at, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    webhookId,
    input.shop,
    input.event,
    JSON.stringify(input.scopes),
    input.createdAt,
    input.processedAt ?? null,
  );
}

function processedStatement(db, webhookId, processedAt) {
  return db.prepare(`
    UPDATE shopify_installation_audit
    SET processed_at = ?
    WHERE webhook_id = ? AND processed_at IS NULL
  `).bind(processedAt, webhookId);
}

function validateSession(input) {
  if (!isPlainObject(input)) throw invalidInput();
  const createdAt = requireTimestamp(input.createdAt);
  const expiresAt = requireTimestamp(input.expiresAt);
  if (expiresAt <= createdAt || expiresAt - createdAt > 15 * 60 * 1000) throw invalidInput();
  return {
    stateHash: requirePattern(input.stateHash, HASH_PATTERN),
    shop: requirePattern(input.shop, SHOP_PATTERN),
    createdAt,
    expiresAt,
  };
}

function validateInstallation(input) {
  if (!isPlainObject(input)) throw invalidInput();
  return {
    shop: requirePattern(input.shop, SHOP_PATTERN),
    status: requireSet(input.status, new Set(['active', 'scope_invalid'])),
    ciphertext: requirePattern(input.ciphertext, /^[A-Za-z0-9+/]{32,4096}={0,2}$/u),
    iv: requirePattern(input.iv, /^[A-Za-z0-9+/]{16}$/u),
    keyVersion: requirePositiveInteger(input.keyVersion),
    scopes: normalizeScopes(input.scopes),
    installedAt: requireTimestamp(input.installedAt),
  };
}

function validateLifecycle(input, requiredEvent) {
  if (!isPlainObject(input)) throw invalidInput();
  const event = requireSet(input.event, EVENT_VALUES);
  if (event !== requiredEvent) throw invalidInput();
  return {
    webhookId: requirePattern(input.webhookId, WEBHOOK_ID_PATTERN),
    shop: requirePattern(input.shop, SHOP_PATTERN),
    event,
    scopes: normalizeScopes(input.scopes),
    requiredScopes: normalizeScopes(input.requiredScopes ?? []),
    createdAt: requireTimestamp(input.createdAt),
  };
}

function normalizeInstallation(row) {
  let scopes;
  try { scopes = JSON.parse(row.granted_scopes_json); } catch { throw new OAuthRepositoryError(); }
  return Object.freeze({
    shop: requirePattern(row.shop, SHOP_PATTERN),
    status: requireSet(row.status, STATUS_VALUES),
    ciphertext: row.access_token_ciphertext,
    iv: row.access_token_iv,
    keyVersion: row.token_key_version,
    scopes: normalizeScopes(scopes),
    installedAt: requireTimestamp(row.installed_at),
    updatedAt: requireTimestamp(row.updated_at),
    uninstalledAt: row.uninstalled_at === null ? null : requireTimestamp(row.uninstalled_at),
  });
}

function normalizeScopes(value) {
  if (!Array.isArray(value) || value.length > 100) throw invalidInput();
  const scopes = value.map((scope) => requirePattern(scope, /^[a-z][a-z0-9_]{1,79}$/u));
  if (new Set(scopes).size !== scopes.length) throw invalidInput();
  return Object.freeze([...scopes].sort());
}

function assertChanged(result, code = 'oauth-repository-conflict') {
  if (result?.success !== true || !Number.isSafeInteger(result.meta?.changes)
    || result.meta.changes < 1) throw new OAuthRepositoryError(code);
}

function assertBatch(results, length) {
  if (!Array.isArray(results) || results.length !== length
    || results.some((result) => result?.success !== true)) throw new OAuthRepositoryError();
}

function requirePattern(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalidInput();
  return value;
}

function requireSet(value, allowed) {
  if (!allowed.has(value)) throw invalidInput();
  return value;
}

function requireTimestamp(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidInput();
  return value;
}

function requirePositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput();
  return value;
}

function assertDatabase(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') throw invalidInput();
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidInput() {
  return new OAuthRepositoryError('invalid-oauth-repository-input');
}

export class OAuthRepositoryError extends Error {
  constructor(code = 'oauth-repository-failed') {
    super('Shopify OAuth repository operation failed.');
    this.name = 'OAuthRepositoryError';
    this.code = code;
  }
}
