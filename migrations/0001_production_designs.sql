CREATE TABLE production_designs (
  design_id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  bundle_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'upload_pending',
    'cart_draft',
    'paid_pending_production',
    'file_error',
    'cancelled',
    'refunded',
    'cleanup_pending',
    'archived'
  )),
  product_id TEXT NOT NULL,
  variant_id TEXT,
  size TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  uv_export_version TEXT NOT NULL,
  design_fingerprint TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  manifest_key TEXT NOT NULL,
  bundle_key TEXT NOT NULL,
  bundle_filename TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at INTEGER,
  shopify_order_gid TEXT,
  shopify_order_name TEXT,
  error_code TEXT,
  cleanup_token TEXT,
  cleanup_started_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK (
    (status = 'cleanup_pending' AND cleanup_token IS NOT NULL AND cleanup_started_at IS NOT NULL)
    OR (status <> 'cleanup_pending' AND cleanup_token IS NULL AND cleanup_started_at IS NULL)
  ),
  UNIQUE (shop, upload_id),
  UNIQUE (shop, shopify_order_gid, design_id)
);

CREATE TABLE shopify_webhook_deliveries (
  webhook_id TEXT PRIMARY KEY,
  event_id TEXT,
  shop TEXT NOT NULL,
  topic TEXT NOT NULL,
  order_gid TEXT,
  received_at INTEGER NOT NULL
);

CREATE INDEX production_designs_shop_status_created_at_idx
  ON production_designs (shop, status, created_at);

CREATE INDEX production_designs_shop_order_name_idx
  ON production_designs (shop, shopify_order_name);

CREATE INDEX production_designs_expires_at_idx
  ON production_designs (expires_at);

CREATE INDEX production_designs_cleanup_started_at_idx
  ON production_designs (cleanup_started_at)
  WHERE status = 'cleanup_pending';

CREATE UNIQUE INDEX shopify_webhook_deliveries_shop_topic_event_id_uidx
  ON shopify_webhook_deliveries (shop, topic, event_id)
  WHERE event_id IS NOT NULL;
