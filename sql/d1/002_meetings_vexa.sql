-- 002_meetings_vexa.sql — own-rail meetings (Vexa-direct, no shared worker).
-- platform + native_meeting_id let Pages Functions address Vexa's
-- /bots/{platform}/{native_meeting_id} and /transcripts/... endpoints.
ALTER TABLE meetings ADD COLUMN platform TEXT;
ALTER TABLE meetings ADD COLUMN native_meeting_id TEXT;

-- Pull-on-view ingest is idempotent through this index (speaker_name is
-- written as '' when unknown — NULLs are distinct in SQLite unique indexes).
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_dedupe
  ON meeting_transcript(meeting_id, start_ts, speaker_name);
