-- PAI spend usage mirror, pushed from the Mac-local pai-spend SQLite DB.
-- Read-only from the dashboard (the Mac owns the data via `pai-spend push-dashboard`).
-- `synced_at` marks rows touched by the latest successful push so stale usage
-- rows can be reaped independently from spend_totals history.
CREATE TABLE IF NOT EXISTS spend_usage (
  service_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  limit_value REAL,
  pct REAL,
  unit TEXT,
  captured_at TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (service_key, metric)
);

CREATE INDEX IF NOT EXISTS spend_usage_pct_idx ON spend_usage(pct);
