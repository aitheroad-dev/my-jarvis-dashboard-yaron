-- 018: per-meeting transcription language (Path 6 recorder).
-- The manual "Save & start recording" form and calendar auto-join both let the
-- user pin a dominant language; the box transcriber reads this column when it
-- correlates a completed recording back to its meetings row. NULL = box default (he).
ALTER TABLE meetings ADD COLUMN language TEXT;
