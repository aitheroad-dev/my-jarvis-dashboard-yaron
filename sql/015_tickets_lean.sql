-- 015_tickets_lean.sql
-- Lean ticket model: a ticket = the thin FACE of an ISA-bearing work unit.
-- The deep 12-section content stays in the ISA file on disk; the ticket only
-- carries what a status card needs and links back via isa_path.
--
-- v1 is NON-DESTRUCTIVE: the heavy ISA-body columns (problem..verification,
-- iscs, log) stay nullable and simply stop being written. A later cleanup
-- migration drops them once nothing reads them.
--
-- New thin-face fields:
--   isa_path  -- ISA file path, relative to the PAI dir (links card → doc)
--   progress  -- "N/M" ISC progress, synced from the ISA
--   next      -- one-line "current step / what's next" (mainly for manual todos)
--   source    -- 'pai'  : owned by the disk→Neon sync (auto-generated as we work)
--             -- 'manual': owned by the user (hand-created To-Do cards; sync never touches)

alter table tickets add column if not exists isa_path text;
alter table tickets add column if not exists progress text;
alter table tickets add column if not exists next     text;
alter table tickets add column if not exists source   text not null default 'manual'
                                  check (source in ('pai', 'manual'));

create index if not exists tickets_source_ix on tickets(source);
