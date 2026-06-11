---
project: my-jarvis-dashboard-yaron
task: Standalone cloud meetings app — agent joins + transcribes, laptop-independent
slug: dashboard-meetings-app
effort: E4
phase: think
progress: 0/0
mode: standard
started: 2026-06-11T10:15:00+02:00
updated: 2026-06-11T10:55:00+02:00
---

# Dashboard Meetings App — ISA

> Prior task (situation-board, 48/48 complete) archived in git at `61215f9`.
> **PIVOT 2026-06-11 ~10:45** — Yaron: the local pai-meet system was a *reference only*. The dashboard meetings app must be fully cloud-standalone. Local-bridge build (Pulse module) was completed through curl-ready state, then rolled back cleanly on his instruction.

## Problem

The dashboard's Meetings page is an unwired shell: the UI and D1 schema (meetings, meeting_transcript, meeting_actions) shipped with the template, but Yaron's Pages project has none of the `MEETINGS_WORKER_URL/TENANT_KEY/TENANT_SLUG` bindings, no tenant registered on the shared My Jarvis meetings Worker, and — since the Neon→D1 migration — no path for transcript segments to land in his database at all (the Neon-era worker wrote tenant Postgres directly). There is no way to create a meeting, send an agent into it, or read a transcript without Yaron's laptop.

## Vision

From any device, anywhere — laptop off — open the Meetings page, paste a meeting link (or create one), and an agent joins the call, listens, and transcribes. The transcript and summary appear in the dashboard as the meeting happens and stay forever. The system is so self-contained that Yaron's sister could be handed access and run her own meetings with it, without Yaron in the loop.

## Out of Scope

- Local recording of in-person/this-Mac audio (pai-meet keeps that job; explicitly disconnected from this app).
- Anything that requires Yaron's Mac to be powered on for the pipeline to work.
- Editing/deleting meetings from the UI (v2).
- Full multi-tenant provisioning product flow (sister-shareability informs the design; her onboarding is its own task).

## Constraints

- Entirely cloud-resident: Cloudflare-first (Pages Functions + D1 + R2 + Workers) per the platform-consolidation decision.
- Hebrew + English transcription are both required (his meetings are mostly Hebrew).
- Transcript ingest must write his D1 — requires an authenticated ingest endpoint in his own `functions/` (external workers cannot reach D1 directly).
- Dashboard deploy = wrangler direct-upload via node; pre-push gate `typecheck && lint && build`.
- TS everywhere; bun for tooling.
- Bot-service choice pending vendor research + Yaron's call (see Decisions) — architecture ISCs written after that decision.

## Goal

A meeting created in the dashboard from any device causes a cloud agent to join the call and stream its transcript into Yaron's D1, visible live and permanently on the Meetings page — with zero dependency on any local machine.

## Criteria

> Numbering restarts post-pivot (prior set retired wholesale, see Decisions). E4 ISC soft floor (128) under-shot deliberately — show-your-math in Decisions.

### Vendor adapter (functions/_lib/vexa.ts)
- [ ] ISC-1: adapter module exists exporting `createBot`, `stopBot`, `fetchTranscript`
- [ ] ISC-2: adapter reads `VEXA_API_BASE` (default `https://api.cloud.vexa.ai`) and `VEXA_API_KEY` from env — self-host later = base-URL swap only
- [ ] ISC-3: auth sent as `X-API-Key` header
- [ ] ISC-4: createBot posts `platform`, `native_meeting_id`, `language`, optional `passcode`, `bot_name`
- [ ] ISC-5: stopBot issues `DELETE /bots/{platform}/{native_meeting_id}`
- [ ] ISC-6: fetchTranscript GETs `/transcripts/{platform}/{native_meeting_id}` and returns typed segments
- [ ] ISC-7: Anti: adapter never throws raw — all vendor errors surface as typed `{ok:false,status,detail}`

### Meeting-URL parsing (server-side)
- [ ] ISC-8: server parses Meet/Zoom/Teams URLs to `{platform, native_meeting_id, passcode?}` (same regex family as the UI's)
- [ ] ISC-9: unsupported/invalid URL → 400 with explanatory error
- [ ] ISC-10: Zoom `pwd` query param captured as passcode

### Create flow (POST /api/meetings)
- [ ] ISC-11: D1 row inserted with `platform` + `native_meeting_id` columns (new migration applied to live D1)
- [ ] ISC-12: Vexa createBot called; meeting status → `live`, bot id stored
- [ ] ISC-13: vendor failure → row kept, status `failed`, error relayed with detail
- [ ] ISC-14: missing `VEXA_API_KEY` → 500 "not configured" without crashing
- [ ] ISC-15: `language` from body persisted and passed to the bot (default `he`)
- [ ] ISC-16: Anti: no `MEETINGS_WORKER_URL`/`TENANT_KEY`/`TENANT_SLUG` references remain anywhere in the repo

### Transcript ingest (pull-on-view)
- [ ] ISC-17: GET /api/meetings/:id pulls fresh segments from Vexa for non-ended meetings and upserts into `meeting_transcript`
- [ ] ISC-18: upsert is idempotent — unique index `(meeting_id, start_ts, speaker_name)`, ON CONFLICT updates text/completed
- [ ] ISC-19: segments persist in D1 — transcript readable after the Vexa 12-month window, laptop off, vendor down
- [ ] ISC-20: ended meetings serve from D1 only (no vendor call)
- [ ] ISC-21: stop action calls Vexa stopBot, does a final transcript pull, sets status `ended` + `ended_at`
- [ ] ISC-22: Anti: a Vexa outage degrades to cached D1 segments, never a 500 on the detail page

### Erez-infra eradication
- [ ] ISC-23: ConnectCalendarCard removed from MeetingsPage (no `my-jarvis-meetings-worker.myjarvis.workers.dev` reference in src/)
- [ ] ISC-24: `functions/api/calendar/*` deleted (worker-OAuth flow) and no src caller references `/api/calendar`
- [ ] ISC-25: Anti: zero `tenant=erez` strings in the repo
- [ ] ISC-26: Anti: zero fetches to any `*.myjarvis.workers.dev` host in src/ or functions/

### UI
- [ ] ISC-27: MeetingsPage create form works against the new backend (title, URL, language incl. Hebrew)
- [ ] ISC-28: meetings list renders from D1 with status badges
- [ ] ISC-29: MeetingDetailPage shows live transcript segments (existing 1s poll, hidden-tab guard preserved)
- [ ] ISC-30: stop button on a live meeting works from the detail page
- [ ] ISC-31: clear unconfigured state — if backend reports "not configured", UI explains the missing key instead of a raw error
- [ ] ISC-32: copy updated — no Deepgram/Jarvis-bot claims that no longer hold

### Quality gates + deploy
- [ ] ISC-33: `bun run typecheck` exits 0
- [ ] ISC-34: `bun run lint` exits 0
- [ ] ISC-35: `bun run build` exits 0
- [ ] ISC-36: D1 migration applied to the live database (columns + unique index verified via query)
- [ ] ISC-37: deployed via wrangler; live URL serves the new bundle
- [ ] ISC-38: `VEXA_API_KEY` set as a Pages secret (via handoff file, never in chat/git)
- [ ] ISC-39: Anti: no secret value appears in git, chat, or client bundle

### Live verification (E2E)
- [ ] ISC-40: Interceptor: live /meetings page renders create form + list in real Chrome
- [ ] ISC-41: E2E: real meeting created from the dashboard, Vexa bot joins the call
- [ ] ISC-42: E2E: Hebrew speech in the test call produces Hebrew transcript segments in the dashboard
- [ ] ISC-43: E2E: laptop-independence — transcript continues landing in D1 with no local process involved (pipeline is Pages+Vexa only; verified by architecture + live segments while no local poller runs)
- [ ] ISC-44: E2E: stop from dashboard removes the bot from the call
- [ ] ISC-45: detail page still shows the full transcript after meeting end (served from D1)
- [ ] ISC-46: Anti: pai-meet untouched — `git -C` n/a, `pai-meet list` still exits 0 and no PaiMeet file modified
- [ ] ISC-47: Antecedent: sister-shareability — backend keyed by env-config (not Yaron-specific hardcodes) so a second deployment/user space needs only its own key + DB

## Decisions

- 2026-06-11 10:15 — [SUPERSEDED by pivot] Local bridge = Pulse module at `/api/meet`; built, curl-stage tested, then **rolled back** when Yaron clarified the system must be laptop-independent. Pulse restored to pre-task state (health 200 verified post-revert).
- 2026-06-11 10:55 — Pivot recorded: cloud-standalone, agent-joins-the-call architecture. Local pai-meet was reference material only, stays untouched and disconnected.
- 2026-06-11 10:55 — Facts established: shared My Jarvis meetings Worker is live (`my-jarvis-meetings-worker.myjarvis.workers.dev`); Yaron's Pages project lacks all three `MEETINGS_*` bindings; no transcript-ingest endpoint exists in his `functions/`; D1 meetings schema already present (`sql/d1/schema.sql`).
- 2026-06-11 10:55 — OPEN (Yaron's call, options researched in background): (A) register tenant on the shared company Worker + add D1 ingest endpoint — needs Erez coordination; (B) own meetings Worker on his CF account + hosted bot API (Vexa Cloud or similar) — fully self-owned, new vendor cost; (C) self-host bot stack (Vexa/Attendee) on Hetzner — independent but heaviest ops. Criteria authored after this lands.
- 2026-06-11 10:55 — E4 per classifier on the pivot; Cato audit binds at VERIFY once build happens.
- 2026-06-11 11:10 — **Yaron picked: own rail, eradicate Erez-company dependencies, self-host direction.** Vendor = **Vexa** (Apache-2.0): hosted API now (`https://api.cloud.vexa.ai`, $5 trial credit, $12/mo Individual after), identical API self-hosted later (Vexa Lite on own box = base-URL swap). Attendee kept as fallback if Hebrew quality disappoints (explicit language codes via Deepgram/Gladia).
- 2026-06-11 11:10 — **No middleman worker.** The shared-worker indirection existed for multi-tenancy; single-owner stack calls Vexa directly from Pages Functions. Fewer moving parts, nothing new to deploy.
- 2026-06-11 11:10 — **Ingest = pull-on-view**, not webhooks: the detail page's existing 1s poll hits our function, which pulls Vexa transcripts and upserts D1 (idempotent). No cron Worker, no public webhook surface. Accepted cost: ~1 vendor call/s only while someone watches a live meeting. Revisit if Vexa rate-limits bite.
- 2026-06-11 11:10 — Show-your-math, ISC floor: 47 ISCs vs E4's soft 128. The app reuses an existing tested UI + schema; inflating count with per-style-token probes would be ceremony. Granularity rule satisfied — every ISC has a single-tool probe.
- 2026-06-11 11:10 — Broader "self-host everything in the dashboard" (beyond meetings) logged as follow-up audit task, not this build. Remaining known company touchpoints after this task: none in wrangler.toml (D1+R2+CF Access already his); WorkOS-era code in `_lib/auth.ts` worth a look later.
