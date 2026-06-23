-- Adds checklist to move_tasks: a JSON array (max 30) of {label, info?, done} sub-items
-- shown in the full-page detail popup. NULL/empty = the task has no breakdown. Each item
-- carries its own free-text info (account numbers, what to do) and a per-item done mark,
-- so a bundled task (e.g. "update address: banks, insurance, KvK, DigiD, SVB, pension")
-- becomes an individually-checkable list. Whole-array replacement on every PATCH, guarded
-- by the row's version like buy_options.
ALTER TABLE move_tasks ADD COLUMN checklist TEXT;
