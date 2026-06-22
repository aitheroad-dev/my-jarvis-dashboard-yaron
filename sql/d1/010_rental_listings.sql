-- NL rental findings, mirrored from the Hetzner box on every scrape run.
-- Read-only from the dashboard (the box owns the data via push-dashboard.ts).
-- `id` = `${source}:${source_id}` (e.g. "funda:abc123"). `tracks` is a JSON
-- array: [], ["delft"], ["value"], or ["delft","value"]. `is_match` = passed the
-- two-track filter (== shown in the Telegram digest). `active=0` = reaped (no
-- longer in the latest box run).
CREATE TABLE IF NOT EXISTS rental_listings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  city TEXT,
  property_type TEXT,
  rent_eur REAL,
  bedrooms INTEGER,
  rooms INTEGER,
  area_m2 REAL,
  eur_per_m2 REAL,
  delta_pct REAL,
  tracks TEXT NOT NULL DEFAULT '[]',
  is_match INTEGER NOT NULL DEFAULT 0,
  is_new INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT,
  last_seen TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS rental_listings_match_idx ON rental_listings(active, is_match);
CREATE INDEX IF NOT EXISTS rental_listings_synced_idx ON rental_listings(synced_at);
