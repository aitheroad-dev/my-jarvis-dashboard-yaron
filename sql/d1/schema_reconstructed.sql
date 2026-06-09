-- Reconstructed tables: referenced by handlers but absent from migrations 001-015.
-- Column shapes inferred from the handler queries (tickets/[slug].ts,
-- sessions/index.ts, calendar/events.ts). Created EMPTY so those routes return
-- [] instead of HTTP 500. ticket_movements backs the active Tickets detail
-- "Movement Feed"; sessions/clients/calendar_events are dormant CRM/calendar
-- surfaces whose external populating workers are outside this migration.

CREATE TABLE IF NOT EXISTS ticket_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_slug TEXT NOT NULL,
  kind        TEXT,
  ts          TEXT,
  summary     TEXT,
  ref         TEXT,
  progress    TEXT,
  seq         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ticket_movements_slug_idx ON ticket_movements(ticket_slug);

CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  client_id    TEXT REFERENCES clients(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  summary      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS sessions_client_idx ON sessions(client_id);

CREATE TABLE IF NOT EXISTS calendar_events (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  google_event_id TEXT,
  title           TEXT,
  meeting_url     TEXT,
  start_time      TEXT,
  end_time        TEXT,
  status          TEXT,
  bot_id          TEXT,
  dispatched_at   TEXT,
  organizer_email TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS calendar_events_start_idx ON calendar_events(start_time);
