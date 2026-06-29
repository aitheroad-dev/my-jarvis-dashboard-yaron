-- NL FOR-SALE value radar — top-200 most-underpriced koop listings nationally,
-- mirrored from the Hetzner box on every nightly run (push-koop-dashboard.ts).
-- Read-only from the dashboard (the box owns the data). `id` = Funda koop
-- source_id. `delta_pct` < 0 = below local-market €/m² (peer-relative). `peer_tier`
-- = city | province (national-tier rows are never ranked, so never land here).
CREATE TABLE IF NOT EXISTS koop_listings (
  id TEXT PRIMARY KEY,
  rank INTEGER,
  url TEXT NOT NULL,
  title TEXT,
  city TEXT,
  province TEXT,
  postcode TEXT,
  price_eur REAL,
  area_m2 REAL,
  eur_per_m2 REAL,
  property_type TEXT,
  peer_tier TEXT,
  peer_count INTEGER,
  peer_median_eur_per_m2 REAL,
  delta_pct REAL,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS koop_listings_rank_idx ON koop_listings(rank);
CREATE INDEX IF NOT EXISTS koop_listings_synced_idx ON koop_listings(synced_at);
