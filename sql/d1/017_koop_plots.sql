-- NL FOR-SALE large-plots radar — koop listings with a PLOT (land) area of
-- ≥1,000 m², ranked by cheapest €/m² of plot (price ÷ plot size). Mirrored from
-- the Hetzner box on every nightly run (push-plots-dashboard.ts), which parses
-- the plot size out of each Funda card's raw text (the box's `area_m2` column
-- only stores living area / is inconsistent for big rural lots, so plot is parsed
-- fresh). Read-only from the dashboard — the box owns the data. `id` = Funda koop
-- source_id. `eur_per_plot_m2` = price ÷ plot_m2 (the sort metric; lowest = best
-- land value). `living_m2` kept for context.
CREATE TABLE IF NOT EXISTS koop_plots (
  id TEXT PRIMARY KEY,
  rank INTEGER,
  url TEXT NOT NULL,
  title TEXT,
  city TEXT,
  province TEXT,
  postcode TEXT,
  price_eur REAL,
  plot_m2 REAL,
  living_m2 REAL,
  eur_per_plot_m2 REAL,
  property_type TEXT,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS koop_plots_rank_idx ON koop_plots(rank);
CREATE INDEX IF NOT EXISTS koop_plots_synced_idx ON koop_plots(synced_at);
