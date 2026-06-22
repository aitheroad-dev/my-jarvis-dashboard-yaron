-- Optimistic-concurrency version counter for move_tasks.
-- The PATCH handler compares-and-swaps on this integer (bumped every write) so a
-- same-cell concurrent edit is detected even when two writes land in the same
-- wall-clock second (updated_at is only second-resolution and can't be the token).
ALTER TABLE move_tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
