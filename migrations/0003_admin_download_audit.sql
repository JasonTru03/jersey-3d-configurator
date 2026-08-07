CREATE TABLE admin_download_audit (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  design_id TEXT NOT NULL,
  downloaded_at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'missing', 'invalid')),
  FOREIGN KEY (design_id) REFERENCES production_designs (design_id)
);

CREATE INDEX admin_download_audit_shop_downloaded_at_idx
  ON admin_download_audit (shop, downloaded_at);

CREATE INDEX admin_download_audit_design_id_idx
  ON admin_download_audit (design_id);
