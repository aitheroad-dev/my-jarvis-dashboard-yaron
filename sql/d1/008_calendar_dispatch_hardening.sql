-- 007_calendar_dispatch_hardening.sql — close the gaps the Forge audit found.
-- present: a cached event still exists in Google. Sync flips vanished
-- (cancelled/deleted) events to 0 so they stop dispatching bots.
ALTER TABLE calendar_events ADD COLUMN present INTEGER NOT NULL DEFAULT 1;

-- At most one ACTIVE bot per meeting code — defense in depth against two
-- overlapping dispatch paths creating duplicate bots for the same Meet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_active_unique
  ON meetings(platform, native_meeting_id)
  WHERE status IN ('live','starting');
