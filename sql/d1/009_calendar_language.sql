-- 009_calendar_language.sql — per-event transcription language for auto-join.
-- NULL = auto-detect (Vexa/Whisper picks he/en on its own, the new default);
-- 'he' / 'en' = force that language. Preserved across syncs (like auto_join).
ALTER TABLE calendar_events ADD COLUMN language TEXT;
