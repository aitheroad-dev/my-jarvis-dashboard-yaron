CREATE TABLE IF NOT EXISTS deployed_sites (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deployed_sites_project ON deployed_sites (project);

INSERT OR IGNORE INTO deployed_sites (id, project, name, url, note, sort_order)
VALUES
  ('site-001', 'NL Supermarkets', 'Prijsscherp — Markt deals (LIVE)', 'https://prijsscherp.nl', NULL, 0),
  ('site-002', 'NL Supermarkets', 'Mandje (basket)', 'https://nl-supermarkets-mandje.pages.dev', NULL, 1),
  ('site-003', 'NL Supermarkets', 'Supermarkets App', 'https://nl-supermarkets-app.pages.dev', NULL, 2),
  ('site-004', 'NL Supermarkets', 'Deals — Folder', 'https://nl-deals-folder.pages.dev', NULL, 3),
  ('site-005', 'NL Supermarkets', 'Deals — Radar', 'https://nl-deals-radar.pages.dev', NULL, 4),
  ('site-006', 'NL Supermarkets', 'Deals — Vandaag', 'https://nl-deals-vandaag.pages.dev', NULL, 5),
  ('site-007', 'Family OS', 'Family OS (app)', 'https://family-os-sim.aitheroad.workers.dev/app', NULL, 10),
  ('site-008', 'NL House Rental', 'Rental Map', 'https://nl-rental-map.pages.dev', NULL, 20),
  ('site-009', 'Israel Trails', 'Israel Trails', 'https://israel-trails.aitheroad.workers.dev', NULL, 30),
  ('site-010', 'PAI & Tools', 'MyJarvis Dashboard (this)', 'https://my-jarvis-dashboard-yaron.pages.dev', NULL, 40),
  ('site-011', 'PAI & Tools', 'PAI Tools console', 'https://pai-tools.aitheroad.workers.dev', NULL, 41),
  ('site-012', 'PAI & Tools', 'Sign Pad', 'https://sign-pad.aitheroad.workers.dev', NULL, 42),
  ('site-013', 'PAI & Tools', 'PAI Design System', 'https://pai-design-system.pages.dev', NULL, 43);
