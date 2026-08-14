CREATE TABLE shopify_oauth_sessions (
  state_hash TEXT PRIMARY KEY CHECK (length(state_hash) = 64),
  shop TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'consumed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK (
    (status = 'pending' AND consumed_at IS NULL)
    OR (status = 'consumed' AND consumed_at IS NOT NULL)
  )
);

CREATE INDEX shopify_oauth_sessions_shop_status_expires_at_idx
  ON shopify_oauth_sessions (shop, status, expires_at);

CREATE TABLE shopify_installations (
  shop TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'scope_invalid', 'uninstalled')),
  access_token_ciphertext TEXT,
  access_token_iv TEXT,
  token_key_version INTEGER,
  granted_scopes_json TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  uninstalled_at INTEGER,
  CHECK (
    (status IN ('active', 'scope_invalid')
      AND access_token_ciphertext IS NOT NULL
      AND access_token_iv IS NOT NULL
      AND token_key_version IS NOT NULL
      AND uninstalled_at IS NULL)
    OR (status = 'uninstalled'
      AND access_token_ciphertext IS NULL
      AND access_token_iv IS NULL
      AND token_key_version IS NULL
      AND uninstalled_at IS NOT NULL)
  )
);

CREATE TABLE shopify_installation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id TEXT UNIQUE,
  shop TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN (
    'installed',
    'reinstalled',
    'scopes_updated',
    'uninstalled'
  )),
  granted_scopes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE INDEX shopify_installation_audit_shop_created_at_idx
  ON shopify_installation_audit (shop, created_at);
