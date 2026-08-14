CREATE TABLE shopify_store_configs (
  shop TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'activation_failed')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  shopify_product_gid TEXT NOT NULL,
  product_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  jersey_variants_json TEXT NOT NULL,
  surcharge_variants_json TEXT NOT NULL,
  signing_secret_ciphertext TEXT NOT NULL,
  signing_secret_iv TEXT NOT NULL,
  signing_secret_key_version INTEGER NOT NULL,
  activation_lock_token TEXT,
  activation_lock_expires_at INTEGER,
  transform_registration_id TEXT,
  validation_registration_id TEXT,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  activated_at INTEGER,
  CHECK ((activation_lock_token IS NULL) = (activation_lock_expires_at IS NULL))
);

CREATE INDEX shopify_store_configs_status_updated_at_idx
  ON shopify_store_configs (status, updated_at);
