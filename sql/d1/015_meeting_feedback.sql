-- 015_meeting_feedback.sql
-- Make Vexa failures non-silent. Two failure modes today die quietly:
--   (1) createBot is rejected → row goes 'failed' but the REASON is discarded.
--   (2) a bot joins (status 'live') but records nothing → looks healthy forever.
-- These columns let us persist the exact reason, surface it on /meetings, and
-- alert once via Telegram (alerted_at dedups the per-minute stall sweep).
ALTER TABLE meetings ADD COLUMN last_error TEXT;
ALTER TABLE meetings ADD COLUMN error_status INTEGER;
ALTER TABLE meetings ADD COLUMN alerted_at TEXT;
