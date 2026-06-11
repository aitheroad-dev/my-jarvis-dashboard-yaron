---
project: my-jarvis-dashboard-yaron
task: Eradicate v3 ticket system; build Situation Board replacement
slug: situation-board
effort: E3
phase: execute
progress: 10/39
mode: standard
started: 2026-06-11T09:30:00+02:00
updated: 2026-06-11T09:30:00+02:00
---

# Situation Board — Dashboard ISA

## Problem

The v3 ticket system is dead weight: a team-coordination primitive (Kanban, assigned work-items, columns) bolted onto a solo operator whose work happens in terminal sessions. Its real-time mirror chain (TicketPush → AutoStub → AutoStubReaper → Neon) broke three separate ways (exec-bit silent no-op, unwired ISASync, Neon decommissioned 2026-06-09) and now fires uselessly at a dead database on every file edit. Meanwhile Yaron's actual need — *what happened yesterday, what happened this week, where are we, what's next, what's the big goal, per project* — is unanswered (TELOS C3: "no unified view of all my projects, this is the biggest").

## Vision

Yaron opens one page and sees the whole portfolio breathing: every project a card with its goal, where it stands, what's next — and the stalled ones impossible to ignore. He clicks a project and reads the story of how it moved, in the same narrative voice his session wrap-ups already have, with a diagram tracing the path from start to now. He never wrote a ticket to get any of this — the work's own paper trail produced it.

## Out of Scope

- Kanban boards, drag-and-drop, columns, work-item assignment of any kind.
- Real-time push hooks from PAI into the dashboard for situation data (batch harvest only; a session-end wrap-up writer may come later as a single additive hook, not in this slice).
- Fine-grained ticket detail / per-ISC mirroring (the ISA on disk remains the only home for that).
- Editing situation data from the dashboard UI (read-only view in v1; truth lives in PAI).
- Neon anything — the platform is D1+R2, full stop.
- Multi-tenant/template generalization (Yaron's fork only for now).

## Constraints

- Data layer is Cloudflare D1 + R2 (migrated 2026-06-09); no new external databases.
- Truth stays in PAI on disk (ISAs, PROJECT.md, MEMORY/WORK, git history); the dashboard renders a derived view.
- Minimize PAI-core changes: demolition only deletes from `~/.claude/hooks` + settings.json; the harvester lives in the dashboard repo (sibling of the old sync-from-pai.ts pattern).
- CF Pages is direct-upload: deploy = wrangler via Node (`script -q /dev/null node .../wrangler.js pages deploy`), git push deploys nothing.
- Pre-push gate: `bun run typecheck && bun run lint && bun run build` green.
- bun/bunx + TypeScript everywhere.

## Goal

The dashboard contains zero ticket-system code, routes, tables, or PAI-side automation (audited clean by named probes), and in its place a live Situation Board: a portfolio page of per-project cards (Goal / Now / Next / computed Health) backed by D1 tables filled by a deterministic harvester reading PAI's existing paper trail, with a per-project timeline of narrative events and a journey diagram — deployed and Interceptor-verified.

## Criteria

### Demolition — PAI side
- [x] ISC-1: `~/.claude/hooks/TicketPush.hook.ts` no longer exists
- [x] ISC-2: `~/.claude/hooks/AutoStub.hook.ts` no longer exists
- [x] ISC-3: `~/.claude/hooks/AutoStubReaper.hook.ts` no longer exists
- [x] ISC-4: `~/.claude/hooks/lib/ticket-push.ts` and `lib/auto-stub.ts` no longer exist
- [x] ISC-5: `ticket-push.selftest.ts` and `auto-stub.selftest.ts` no longer exist
- [x] ISC-6: `rg -i "ticketpush|autostub" ~/.claude/settings.json` returns zero hits
- [x] ISC-7: settings.json still parses as valid JSON after hook deregistration
- [x] ISC-8: `ISASync.hook.ts` survives and imports nothing from ticket-push/auto-stub
- [x] ISC-9: Anti: no remaining file under `~/.claude/hooks/` matches `rg -li "pushTicketFromISA|ticket"` (ISA-utils false positives reviewed and excluded)
- [x] ISC-10: Anti: no launchd plist, Hetzner timer, or CF cron references ticket sync (`launchctl list`, wrangler.toml crons, box timers checked)

### Demolition — dashboard repo
- [ ] ISC-11: `src/components/atomic-crm/tickets/` directory no longer exists
- [ ] ISC-12: No `/tickets` route or Tickets nav entry in CRM.tsx / nav-items.tsx
- [ ] ISC-13: `functions/api/tickets/` no longer exists
- [ ] ISC-14: Ticket references in goals/projects/agents pages+endpoints removed (counts, links, joins)
- [ ] ISC-15: `scripts/sync-from-pai.ts` (Neon batch reconciler) removed
- [ ] ISC-16: `rg -i "ticket" src/ functions/ scripts/` returns zero hits (docs/sql archives exempt, reviewed)
- [ ] ISC-17: Pre-push gate green after demolition (typecheck + lint + build)

### Demolition — D1
- [ ] ISC-18: Live D1 has no `tickets` / `ticket_movements` (or other `ticket%`) tables — verified by `wrangler d1 execute ... "SELECT name FROM sqlite_master"`
- [ ] ISC-19: `sql/d1/schema.sql` contains no ticket tables

### Situation Board — data
- [ ] ISC-20: D1 has `situation_projects` (slug, name, goal, now_text, health, last_activity) and `situation_events` (id, project_slug, ts, kind, title, detail, source) and `situation_next` (project_slug, position, text) tables
- [ ] ISC-21: Harvester `scripts/harvest-situation.ts` runs end-to-end on this Mac and exits 0
- [ ] ISC-22: Harvester ingests git commits from project repos — repo list *derived from* `USER/PROJECTS/PROJECTS.md` (system of record), not a hand-maintained config
- [ ] ISC-23: Harvester ingests ISA Changelog/Decisions dated entries and MEMORY/WORK session wrap-ups as narrative events
- [ ] ISC-24: Harvester is idempotent — second run inserts zero duplicate events (stable event IDs)
- [ ] ISC-25: Health computed at harvest: active (<7d movement), stalled (≥14d), quiet (7–14d) — stored per project
- [ ] ISC-26: ≥5 real projects present in `situation_projects` after first harvest, each with ≥1 event

### Situation Board — API + UI
- [ ] ISC-27: `GET /api/situation` returns portfolio JSON (projects + health + last event) with LIMIT caps
- [ ] ISC-28: `GET /api/situation/:slug` returns one project's card + events timeline + next list
- [ ] ISC-29: Sidebar shows "Situation" entry; `/situation` renders the portfolio: one card per project with Goal / Now / Next / Health
- [ ] ISC-30: Portfolio sorted by last movement; stalled projects visually flagged
- [ ] ISC-31: Project detail view renders the event timeline newest-first with day/week grouping
- [ ] ISC-32: Antecedent: timeline events render as readable narrative sentences (wrap-up voice), not raw commit hashes — spot-checked on a real project
- [ ] ISC-33: Journey diagram renders per project — milestone path from first event to now, derived from events (kind=milestone/deploy/pivot)
- [ ] ISC-34: Anti: Situation pages make zero requests to any Neon host (network tab clean)

### Anti-R1 guards (from CausalLoop analysis)
- [ ] ISC-37: `/situation` renders `last_harvest` timestamp on the page itself — a dead harvester is visible at the point of consumption
- [ ] ISC-38: Projects with zero harvested events render as a visible anomaly card, never a silent absence
- [ ] ISC-39: Harvester prints per-source status (ok/fail/count) and a partial harvest exits non-zero — no silent source-skip

### Ship
- [ ] ISC-35: Deployed live via wrangler; `/situation` Interceptor-verified (screenshot, console clean) and Interceptor tabs closed after
- [ ] ISC-36: Repo pushed to origin; memory + project docs updated (tickets memory marked demolished, resume pointer current)

## Test Strategy

| isc | type | check | tool |
|---|---|---|---|
| 1–5 | fs | files absent | Bash test -f |
| 6–7 | config | zero grep hits + `bun -e JSON.parse` ok | rg / bun |
| 8–9 | code | no ticket imports in survivors | rg |
| 10 | infra | crons/timers/plists clean | launchctl, rg wrangler.toml, ssh box |
| 11–16 | fs/code | dirs absent, zero grep hits | Bash, rg |
| 17 | build | gate exits 0 | bun run |
| 18 | db | sqlite_master has no ticket% | wrangler d1 execute |
| 19 | fs | schema.sql clean | rg |
| 20 | db | tables exist with expected columns | wrangler d1 execute |
| 21–26 | cli | harvester run output + SELECT counts | bun run + wrangler d1 |
| 27–28 | api | curl status 200 + JSON shape | curl |
| 29–33 | ui | live screenshots at routes | Interceptor |
| 34 | net | interceptor net log no neon.tech | Interceptor |
| 35 | deploy | live URL screenshot + console | Interceptor |
| 36 | git | origin/main contains HEAD; memory files updated | git, Read |

## Features

| name | description | satisfies | depends_on | parallelizable |
|---|---|---|---|---|
| demolish-pai | delete 3 hooks + 2 libs + 2 selftests, deregister in settings.json | ISC-1..10 | — | yes |
| demolish-dashboard | remove tickets pages/routes/API/sync script + refs | ISC-11..17 | — | yes |
| demolish-d1 | drop ticket tables live + from schema.sql | ISC-18..19 | — | yes |
| situation-schema | create situation_* tables in D1 + schema.sql | ISC-20 | demolish-d1 | no |
| harvester | scripts/harvest-situation.ts: git+ISA+WORK → D1, idempotent | ISC-21..26 | situation-schema | no |
| situation-api | /api/situation + /api/situation/:slug Pages functions | ISC-27..28 | situation-schema | yes |
| situation-ui | portfolio cards + project timeline + journey diagram | ISC-29..33 | situation-api | no |
| ship | gate, deploy, Interceptor verify, push, memory update | ISC-34..36 | all | no |

## Decisions

- 2026-06-11: Reframe locked with Yaron — model the *story* (situation + timeline), not work-items. Plain Next list (no drag/drop), wrap-up-quality narrative events, journey diagram wanted. Full demolition of v3 including all automation, audited clean.
- 2026-06-11: Harvester lives in dashboard repo (not PAI core) per minimize-PAI-changes feedback; batch + deterministic, no real-time hooks — three hook breakages in v3 are the refutation of real-time mirroring.
- 2026-06-11: Delegation floor show-your-math: surgical demolition in one repo + one settings.json — parallel write-agents would re-create the concurrent-edit conflicts memory warns about. Forge covers the second delegation slot as post-build auditor.
- 2026-06-11: Tier E3 by classifier on both turns (first was a parse-failure fail-safe, second confirmed by real classification).
- 2026-06-11: CausalLoop verdict — v3 was Fixes-That-Fail: every coverage-gap patch added always-on machinery with silent failure modes (R1 ratchet), while off-board health signals let detection lag weeks (R2 trust spiral). Guards adopted as ISC-37/38/39: staleness on the board, absence is loud, no silent source-skip. Any future real-time wrap-up hook is gated on end-to-end verified delivery.
- 2026-06-11: Skipped EnterPlanMode despite E3 — Yaron explicitly approved demolition + build this turn ("we want to eradicate completely... let's start"), and plan-mode feedback memory reserves it for unapproved risky work.
