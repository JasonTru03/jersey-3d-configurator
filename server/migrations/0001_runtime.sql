CREATE TABLE server_kv (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (namespace, key)
);

CREATE INDEX server_kv_expires_at_idx
  ON server_kv (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE server_objects (
  key TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  native_sha256 TEXT NOT NULL,
  http_metadata_json TEXT NOT NULL,
  custom_metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE server_rate_limits (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (namespace, key, window_started_at)
);

CREATE INDEX server_rate_limits_window_idx
  ON server_rate_limits (window_started_at);
