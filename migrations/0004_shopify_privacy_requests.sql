CREATE TABLE shopify_privacy_requests (
  webhook_id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  topic TEXT NOT NULL CHECK (topic IN (
    'customers/data_request',
    'customers/redact',
    'shop/redact'
  )),
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'response_ready', 'completed')),
  order_gids_json TEXT NOT NULL,
  result_json TEXT,
  received_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX shopify_privacy_requests_shop_status_received_at_idx
  ON shopify_privacy_requests (shop, status, received_at);
