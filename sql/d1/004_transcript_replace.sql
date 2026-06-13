-- 004_transcript_replace.sql — whole-transcript replace-on-change ingest.
-- Replaces the seq-positional upsert (unsafe: Vexa tail partials reorder as they
-- finalize, so a position key overwrites the wrong utterance). New model: pull-on-
-- view computes a signature of Vexa's full transcript; unchanged → no writes;
-- changed → atomic delete-all + insert-all for the meeting (immune to reorder).
ALTER TABLE meetings ADD COLUMN last_segment_sig TEXT;
ALTER TABLE meetings ADD COLUMN last_activity_at TEXT;

-- seq unique index is gone — replace-all owns row identity now; seq stays a
-- plain ordering column.
DROP INDEX IF EXISTS idx_transcript_seq;
DROP INDEX IF EXISTS idx_transcript_dedupe;

-- Clear the test meeting's rows so the next pull repopulates cleanly.
DELETE FROM meeting_transcript WHERE meeting_id = 1;
UPDATE meetings SET last_segment_sig = NULL, last_activity_at = NULL WHERE id = 1;
