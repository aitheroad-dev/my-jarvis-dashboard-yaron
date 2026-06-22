-- PAI spend mirror, pushed from the Mac-local pai-spend SQLite DB.
-- Read-only from the dashboard (the Mac owns the data via `pai-spend push-dashboard`).
-- `synced_at` marks rows touched by the latest successful push so stale mirror
-- rows can be reaped without deleting spend_totals history.
CREATE TABLE IF NOT EXISTS spend_services (
  key TEXT PRIMARY KEY,
  vendor TEXT,
  product TEXT,
  category TEXT,
  scope TEXT,
  plan_type TEXT,
  billing_model TEXT,
  est_monthly_eur REAL,
  currency_hint TEXT,
  usage_source TEXT,
  billing_source TEXT,
  connection_status TEXT,
  connection_detail TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spend_charges (
  id TEXT PRIMARY KEY,
  service_key TEXT,
  date TEXT,
  amount REAL,
  currency TEXT,
  source TEXT,
  period TEXT,
  payee_raw TEXT,
  confidence TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spend_alerts (
  id TEXT PRIMARY KEY,
  type TEXT,
  severity TEXT,
  service_key TEXT,
  detail TEXT,
  period TEXT,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spend_totals (
  period TEXT PRIMARY KEY,
  eur_total REAL,
  usd_total REAL,
  captured_at TEXT,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS spend_charges_service_key_idx ON spend_charges(service_key);
CREATE INDEX IF NOT EXISTS spend_charges_period_idx ON spend_charges(period);
CREATE INDEX IF NOT EXISTS spend_alerts_service_key_idx ON spend_alerts(service_key);
CREATE INDEX IF NOT EXISTS spend_services_connection_status_idx ON spend_services(connection_status);
