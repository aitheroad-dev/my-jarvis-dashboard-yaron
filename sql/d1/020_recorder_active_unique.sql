-- 020_recorder_active_unique.sql — one ACTIVE recorder recording per meeting code.
--
-- Prevents the manual "Save & start recording" button and the calendar auto-join
-- cron from both enqueuing the SAME occurrence (→ two bots on one meeting). The
-- shared producer (createRecordingJob) reuses an in-flight row instead of inserting;
-- this partial unique index makes that atomic even under a simultaneous manual-click
-- + cron-tick (the loser's INSERT conflicts → it reuses the winner's row).
--
-- Terminal rows (ended/failed) stay OUT of the index, so re-recording a meeting after
-- it finishes, and a reused Meet code on a LATER occurrence, both still work. This is
-- the recorder-lifecycle analog of idx_meetings_active_unique (migration 008), which
-- covers the Vexa-era live/starting states.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_active_recorder
  ON meetings(platform, native_meeting_id)
  WHERE status IN ('requested','starting','transcribing');
