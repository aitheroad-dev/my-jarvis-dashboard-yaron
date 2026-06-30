-- 019_meeting_job_id.sql — multi-tenant recorder correlation key (P0).
-- The dashboard generates a tenant-scoped job_id (uuid) at enqueue time and stores
-- it here; the box echoes it through the bot teamId and the ingest callback matches
-- the completed recording back to this row by job_id (replacing the mtg-<id> trick).
-- See pai-meeting-recorder/ISA_MULTITENANT.md (ISC-6).
ALTER TABLE meetings ADD COLUMN job_id TEXT;
CREATE INDEX IF NOT EXISTS idx_meetings_job_id ON meetings(job_id);
