-- 006_calendar_dispatch.sql — make calendar auto-join reliable.
-- Adds attempt tracking so a failing dispatch backs off + caps instead of
-- re-firing every minute (the Jun-13 "failed-row storm"). auto_join now
-- defaults ON for any synced Meet-bearing event (owner wants the notetaker in
-- every meeting; explicit per-event opt-OUT is still honored on conflict).
ALTER TABLE calendar_events ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendar_events ADD COLUMN last_attempt_at TEXT;

-- Backfill: everything already cached becomes auto-join (the new default).
UPDATE calendar_events SET auto_join = 1 WHERE auto_join = 0;
