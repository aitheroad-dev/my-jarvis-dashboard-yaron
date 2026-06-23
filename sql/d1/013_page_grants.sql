CREATE TABLE IF NOT EXISTS page_grants (
  email TEXT NOT NULL,
  page_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  granted_by TEXT,
  PRIMARY KEY (email, page_key)
);

INSERT OR IGNORE INTO page_grants (email, page_key, granted_by)
VALUES
  ('noabarkai@gmail.com', 'move', 'seed'),
  ('noabarkai@gmail.com', 'rental', 'seed');
