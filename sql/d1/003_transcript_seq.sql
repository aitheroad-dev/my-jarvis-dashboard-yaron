-- 003_transcript_seq.sql — dedup pull-on-view ingest by segment position.
-- Vexa's hosted API returns start_time null; the old (meeting_id,start_ts,
-- speaker_name) unique index never collapsed re-pulls (NULLs are distinct in
-- SQLite unique indexes), so each 1s poll re-inserted the full transcript.
-- Vexa returns the whole transcript in stable order every call, so the array
-- index (seq) is a stable per-segment identity.
ALTER TABLE meeting_transcript ADD COLUMN seq INTEGER;

DROP INDEX IF EXISTS idx_transcript_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_seq
  ON meeting_transcript(meeting_id, seq);

-- Wipe the duplicate rows produced by the test meeting before the fix; the
-- next pull-on-view repopulates them cleanly under the new key.
DELETE FROM meeting_transcript WHERE meeting_id = 1;
