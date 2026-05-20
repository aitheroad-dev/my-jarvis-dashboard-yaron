-- 012_drift_fix.sql
-- Add columns the detail handlers reference but the canonical migrations missed.
--
-- functions/api/goals/[slug].ts SELECTs g.body — column was never added in 008.
-- functions/api/projects/[slug].ts and functions/api/goals/[slug].ts SELECT
-- t.tier from tickets — column was never added in 008 either.
-- Without these, both detail endpoints crash with HTTP 500 on any row.

alter table goals   add column if not exists body text;
alter table tickets add column if not exists tier text;
