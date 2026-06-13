-- 005_calendar.sql — Google Calendar connection + cached upcoming events.
-- Single-owner: calendar_connection holds at most one row (the owner's Google
-- account). Refresh token is AES-GCM encrypted at rest (key = Pages secret).
CREATE TABLE IF NOT EXISTS calendar_connection (
  id INTEGER PRIMARY KEY,           -- always 1 (single owner)
  google_email TEXT,
  refresh_token_enc TEXT,           -- base64(iv|ciphertext)
  scopes TEXT,
  connected_at TEXT,
  updated_at TEXT
);

-- A stale calendar_events table from the old Erez template (different schema,
-- 0 rows, never used in this fork) blocks our CREATE IF NOT EXISTS — drop it.
DROP TABLE IF EXISTS calendar_events;

-- Upcoming calendar events that carry a Meet link. Mirror of Google, refreshed
-- on view + by the dispatch cron. auto_join is the per-meeting opt-in flag.
CREATE TABLE IF NOT EXISTS calendar_events (
  google_event_id TEXT PRIMARY KEY,
  title TEXT,
  start_time TEXT,                  -- ISO8601
  end_time TEXT,
  meeting_url TEXT,
  platform TEXT,
  native_meeting_id TEXT,
  auto_join INTEGER NOT NULL DEFAULT 0,
  dispatched_meeting_id INTEGER,    -- meetings.id once a bot was sent; NULL until then
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_calevents_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_calevents_autojoin ON calendar_events(auto_join, start_time);
