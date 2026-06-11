-- Consolidated Cloudflare D1 schema generated from migrations 001, 002, 008,
-- 009, 010, 011, 012, 013, and 015.
-- Applies to an empty database; later ALTER TABLE additions are folded into
-- table definitions. PostgreSQL triggers were dropped, so handlers
-- maintain updated_at explicitly where needed.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id     TEXT PRIMARY KEY,
  data        TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS voice_samples (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  user_id           TEXT NOT NULL,
  agent_name        TEXT NOT NULL,
  text_content      TEXT NOT NULL,
  audio_url         TEXT NOT NULL,
  title             TEXT,
  duration_seconds  INTEGER,
  category          TEXT NOT NULL DEFAULT 'message',
  voice_id          TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS voice_samples_user_created_idx
  ON voice_samples (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS page_content (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_slug   TEXT NOT NULL UNIQUE,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS page_content_updated_idx
  ON page_content (updated_at DESC);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  meeting_url TEXT NOT NULL,
  bot_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  summary TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_meetings_bot_id ON meetings(bot_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status_created ON meetings(status, created_at DESC);

CREATE TABLE IF NOT EXISTS meeting_transcript (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL,
  speaker_name TEXT,
  speaker_id TEXT,
  is_host INTEGER,
  words TEXT NOT NULL,
  start_ts REAL,
  end_ts REAL,
  event_type TEXT,
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_transcript_bot_created ON meeting_transcript(bot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transcript_meeting_created ON meeting_transcript(meeting_id, created_at);

CREATE TABLE IF NOT EXISTS meeting_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE CASCADE,
  cycle_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  content TEXT,
  audio_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (meeting_id, cycle_id)
);

CREATE INDEX IF NOT EXISTS idx_actions_meeting_created ON meeting_actions(meeting_id, created_at);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  mission     TEXT,
  body        TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','paused','done','archived')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS goals (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  slug         TEXT NOT NULL UNIQUE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  body         TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','paused','done','archived')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS goals_project_idx ON goals(project_id);

CREATE TABLE IF NOT EXISTS agents (
  name              TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  voice_kokoro      TEXT NOT NULL,
  voice_mcp         TEXT,
  color             TEXT,
  identity_md       TEXT,
  principles_md     TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS memories (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  agent       TEXT REFERENCES agents(name) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('session_log','learning','user_fact','area','principle','identity')),
  title       TEXT,
  body        TEXT NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS memories_agent_type_ix ON memories(agent, type);
CREATE INDEX IF NOT EXISTS memories_type_created_ix ON memories(type, created_at DESC);

CREATE TABLE IF NOT EXISTS skills (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('draft','active','archived')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS skills_slug_idx ON skills(slug);

CREATE TABLE IF NOT EXISTS mcp_activity (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))),
  tenant_id       TEXT NOT NULL,
  user_id         TEXT,
  op_type         TEXT NOT NULL CHECK (op_type IN (
    'write_file', 'push_files', 'ship', 'apply_migration',
    'query_db', 'destructive_push', 'delete_file', 'upload_asset'
  )),
  status          TEXT NOT NULL CHECK (status IN ('success', 'failed', 'escalated')),
  payload         TEXT NOT NULL DEFAULT '{}',
  result          TEXT,
  duration_ms     INTEGER,
  mcp_session_id  TEXT,
  chat_id         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS mcp_activity_tenant_created_idx
  ON mcp_activity (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mcp_activity_status_idx
  ON mcp_activity (status) WHERE status IN ('failed', 'escalated');

CREATE TABLE IF NOT EXISTS portfolio_fx (
  ccy          TEXT PRIMARY KEY,
  rate_to_base REAL NOT NULL,
  as_of        TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker       TEXT NOT NULL,
  name         TEXT NOT NULL,
  exchange     TEXT,
  currency     TEXT NOT NULL,
  qty          REAL NOT NULL,
  price_native REAL NOT NULL,
  cluster      TEXT,
  flags        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (ticker, exchange)
);

-- Situation Board (replaced the Kanban work-item system, 2026-06-11).
-- Read-only derived view of PAI's paper trail; sole writer is
-- scripts/harvest-situation.ts (batch, idempotent).
CREATE TABLE IF NOT EXISTS situation_projects (
  slug          TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  goal          TEXT,
  now_text      TEXT,
  health        TEXT NOT NULL DEFAULT 'quiet',
  last_activity TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS situation_events (
  id           TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  ts           TEXT NOT NULL,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  detail       TEXT,
  source       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS situation_events_proj_ts ON situation_events(project_slug, ts DESC);

CREATE TABLE IF NOT EXISTS situation_next (
  project_slug TEXT NOT NULL,
  position     INTEGER NOT NULL,
  text         TEXT NOT NULL,
  PRIMARY KEY (project_slug, position)
);

CREATE TABLE IF NOT EXISTS situation_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
