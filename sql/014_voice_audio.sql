-- ── voice_samples: inline audio storage ─────────────────────────────────
-- v1 audio transport rides the existing /api/voice/ingest pipe instead of
-- R2 (prod Pages project has no R2 binding). The local pai-voice CLI base64s
-- the rendered Kokoro MP3 into the ingest POST; we store the bytes here and
-- serve them from GET /api/voice/clip/:id. audio_url then points at that
-- endpoint (relative path), keeping the column the single playable source —
-- a later swap to an R2 public URL is invisible to the frontend.
--
-- audio_url was NOT NULL DEFAULT '' (text-only v1). Keep it; for inline-audio
-- rows the ingest function sets audio_url = '/api/voice/clip/<id>'.

ALTER TABLE voice_samples
  ADD COLUMN IF NOT EXISTS audio_data  BYTEA,
  ADD COLUMN IF NOT EXISTS audio_mime  TEXT;
