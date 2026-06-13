---
project: my-jarvis-dashboard-yaron
task: Standalone cloud meetings app — agent joins + transcribes, laptop-independent
slug: dashboard-meetings-app
effort: E4
phase: complete
progress: 56/60
mode: standard
started: 2026-06-11T10:15:00+02:00
updated: 2026-06-13T14:15:00+02:00
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
- [x] ISC-1: adapter module exists exporting `createBot`, `stopBot`, `fetchTranscript`
- [x] ISC-2: adapter reads `VEXA_API_BASE` (default `https://api.cloud.vexa.ai`) and `VEXA_API_KEY` from env — self-host later = base-URL swap only
- [x] ISC-3: auth sent as `X-API-Key` header
- [x] ISC-4: createBot posts `platform`, `native_meeting_id`, `language`, optional `passcode`, `bot_name`
- [x] ISC-5: stopBot issues `DELETE /bots/{platform}/{native_meeting_id}`
- [x] ISC-6: fetchTranscript GETs `/transcripts/{platform}/{native_meeting_id}` and returns typed segments
- [x] ISC-7: Anti: adapter never throws raw — all vendor errors surface as typed `{ok:false,status,detail}`

### Meeting-URL parsing (server-side)
- [x] ISC-8: server parses Meet/Zoom/Teams URLs to `{platform, native_meeting_id, passcode?}` (same regex family as the UI's)
- [x] ISC-9: unsupported/invalid URL → 400 with explanatory error
- [x] ISC-10: Zoom `pwd` query param captured as passcode

### Create flow (POST /api/meetings)
- [x] ISC-11: D1 row inserted with `platform` + `native_meeting_id` columns (new migration applied to live D1)
- [x] ISC-12: Vexa createBot called; meeting status → `live`, bot id stored
- [DEFERRED-VERIFY] ISC-13: vendor failure → row kept, status `failed`, error relayed with detail
- [x] ISC-14: missing `VEXA_API_KEY` → 500 "not configured" without crashing
- [x] ISC-15: `language` from body persisted and passed to the bot (default `he`)
- [x] ISC-16: Anti: no `MEETINGS_WORKER_URL`/`TENANT_KEY`/`TENANT_SLUG` references remain anywhere in the repo

### Transcript ingest (pull-on-view)
- [x] ISC-17: GET /api/meetings/:id pulls fresh segments from Vexa for non-ended meetings and upserts into `meeting_transcript`
- [x] ISC-18: upsert is idempotent — unique index `(meeting_id, start_ts, speaker_name)`, ON CONFLICT updates text/completed
- [x] ISC-19: segments persist in D1 — transcript readable after the Vexa 12-month window, laptop off, vendor down
- [x] ISC-20: ended meetings serve from D1 only (no vendor call)
- [x] ISC-21: stop action calls Vexa stopBot, does a final transcript pull, sets status `ended` + `ended_at`
- [DEFERRED-VERIFY] ISC-22: Anti: a Vexa outage degrades to cached D1 segments, never a 500 on the detail page

### Erez-infra eradication
- [x] ISC-23: ConnectCalendarCard removed from MeetingsPage (no `my-jarvis-meetings-worker.myjarvis.workers.dev` reference in src/)
- [x] ISC-24: `functions/api/calendar/*` deleted (worker-OAuth flow) and no src caller references `/api/calendar`
- [x] ISC-25: Anti: zero `tenant=erez` strings in the repo
- [x] ISC-26: Anti: zero fetches to any `*.myjarvis.workers.dev` host in src/ or functions/

### UI
- [x] ISC-27: MeetingsPage create form works against the new backend (title, URL, language incl. Hebrew)
- [x] ISC-28: meetings list renders from D1 with status badges
- [x] ISC-29: MeetingDetailPage shows live transcript segments (existing 1s poll, hidden-tab guard preserved)
- [x] ISC-30: stop button on a live meeting works from the detail page
- [x] ISC-31: clear unconfigured state — if backend reports "not configured", UI explains the missing key instead of a raw error
- [x] ISC-32: copy updated — no Deepgram/Jarvis-bot claims that no longer hold

### Quality gates + deploy
- [x] ISC-33: `bun run typecheck` exits 0
- [x] ISC-34: `bun run lint` exits 0
- [x] ISC-35: `bun run build` exits 0
- [x] ISC-36: D1 migration applied to the live database (columns + unique index verified via query)
- [x] ISC-37: deployed via wrangler; live URL serves the new bundle
- [x] ISC-38: `VEXA_API_KEY` set as a Pages secret (via handoff file, never in chat/git)
- [x] ISC-39: Anti: no secret value appears in git, chat, or client bundle

### Live verification (E2E)
- [x] ISC-40: Interceptor: live /meetings page renders create form + list in real Chrome
- [x] ISC-41: E2E: real meeting created from the dashboard, Vexa bot joins the call
- [x] ISC-42: E2E: Hebrew speech in the test call produces Hebrew transcript segments in the dashboard
- [x] ISC-43: E2E: laptop-independence — transcript continues landing in D1 with no local process involved (pipeline is Pages+Vexa only; verified by architecture + live segments while no local poller runs)
- [x] ISC-44: E2E: stop from dashboard removes the bot from the call
- [x] ISC-45: detail page still shows the full transcript after meeting end (served from D1)
- [x] ISC-46: Anti: pai-meet untouched — `git -C` n/a, `pai-meet list` still exits 0 and no PaiMeet file modified
- [x] ISC-48: session-boundary filter — segments with absolute_start_time before this row's started_at (60s grace) are skipped, so reused Meet codes can't bleed prior-session transcript
- [x] ISC-49: create idempotency — POST for a platform+native_meeting_id already live/starting returns 409, one bot per meeting
- [x] ISC-50: orphaned-bot safeguard — live meetings older than 12h auto-flip to ended with best-effort bot stop
- [ ] ISC-51: [SUPERSEDED 2026-06-13 — seq-positional dedup replaced by replace-all-on-change; see ISC-52..55] dedup keyed on segment seq (array index), not start_ts — Vexa returns start_time null; verified rows==distinct_seq (11==11) on live meeting 1 after the runaway-dup fix
- [x] ISC-47: Antecedent: sister-shareability — backend keyed by env-config (not Yaron-specific hardcodes) so a second deployment/user space needs only its own key + DB

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

## Verification

- ISC-11/36: D1 query — pragma_table_info shows `platform`, `native_meeting_id`; sqlite_master shows `idx_transcript_dedupe` (remote, mjd-yaron-db)
- ISC-14/31: live probe — GET /api/meetings returned `{"meetings":[],"configured":false}`; banner rendered in real Chrome
- ISC-16/23-26: `rg MEETINGS_WORKER_URL|MEETINGS_TENANT|tenant=erez|myjarvis.workers.dev src functions` → zero hits; functions/api/calendar git-rm'd
- ISC-33-35: typecheck 0 errors, lint 0 errors (36 pre-existing warnings), vite build ✓ (twice, incl. hardening pass)
- ISC-37: wrangler deploys e0ddb9b0 + 33d95767 live; /meetings serves new header/banner
- ISC-40: Interceptor — header "Send a notetaker into any meeting", form fields e15-e18 (Title/URL/Language he-default/guarded submit), tab closed after
- ISC-46: `pai-meet list` exit 0
- ISC-48-50: code probes — filter/409/auto-expire present, typecheck clean; live behavior folds into E2E-VEXA-001
- DEFERRED-VERIFY follow-up: **E2E-VEXA-001** — after VEXA_API_KEY lands: real Meet call, Hebrew speech, bot join/stop, transcript persistence, laptop-off check

## Changelog

- conjectured: the dashboard's existing Vexa-shaped meetings UI+schema needed only tenant keys to work for Yaron
- refuted by: CF API + code reading — no tenant registration path on his side, and the worker's ingest wrote tenant Neon, decommissioned 2026-06-09; even with keys, transcripts had nowhere to land
- learned: in single-owner stacks, vendor-direct from Pages Functions with D1-owned ingest beats reviving a multi-tenant middleman; the eradication request made this the only coherent shape
- criterion now: ISC-16 (zero shared-worker bindings) + ISC-19 (transcripts permanent in own D1)

### Verification — live E2E 2026-06-13 (meeting id=1, "test", google_meet/kuj-tokk-vqx)

- ISC-12/41: D1 row status `live`, `bot_id=15188` — Vexa createBot succeeded, real bot joined the Meet
- ISC-42: transcript segments are Hebrew ("היי רינגו מה העניינים אתה שומע…"), speaker "Yaron" — Hebrew works
- ISC-17/19/29: GET /api/meetings/1 pull-on-view populated meeting_transcript; rows persist in D1
- ISC-43: laptop-independence — all evidence read by direct remote D1 query; pipeline is Pages+Vexa only, no local process
- ISC-38/39: VEXA_API_KEY confirmed present as prod secret_text via CF API; set via API, handoff file deleted, never in git/chat
- ISC-18/51: post-fix integrity `rows==distinct_seq==11` (pre-fix: 480+ dup rows for 3 utterances)

## Changelog

- conjectured: dedup on (meeting_id, start_ts, speaker_name) makes pull-on-view idempotent
- refuted by: live E2E 2026-06-13 — Vexa hosted API returns start_time null; SQLite treats NULLs as distinct in unique indexes, so every 1s poll re-inserted the full transcript (480+ rows for 3 sentences)
- learned: Vexa returns the entire transcript in stable order each call, so the segment's array index is the only reliable identity; never key idempotency on a vendor field that may be null
- criterion now: ISC-51 (dedup on seq, rows==distinct_seq)

## Decisions — post-review (2026-06-13)

- Forge + Cato both flagged **seq-as-array-index identity (HIGH)**: Vexa tail partials mutate/reorder/coalesce as they finalize, so a positional index overwrites row i with a different utterance — silent corruption (the rows==distinct_seq probe only disproved duplication, not positional stability).
- Empirical check: `absolute_start_time` IS populated (microsecond ISO, spread across meeting); only `start_time` is null. So the session-boundary privacy filter (Forge F5) is live, not dead — reused-Meet-code protection works.
- **Fix decided:** whole-transcript **replace-all on change** — gate each pull on a payload signature (skip when unchanged → kills Forge F2 write-amplification: ~2.1M writes/hr meeting → ~1/utterance), and when changed do an **atomic `env.DB.batch` delete-all+insert-all** (immune to reorder/merge/shrink → fixes F1, no orphan tails). Concurrency-safe via D1 batch atomicity + client in-flight guard (F3).
- Also fixing: auto-end on no-activity (F6), Stop button for `starting` + stale-starting flip (F4), strip Zoom `pwd` from stored/echoed URL (F8 passcode), Teams id char-cap (F8), stale "MeetingDO/5s" comments (cross-cutting). F7 (stop is code-addressed not bot-addressed) = documented, no change.

## Criteria — post-review hardening (2026-06-13)

- [x] ISC-52: transcript ingest is replace-all-on-change (atomic env.DB.batch delete+insert) — immune to Vexa tail re-segmentation; verified by construction + typecheck/lint/build green at 617f32d
- [x] ISC-53: change-detection gate — syncTranscript skips all writes when payload signature unchanged (kills 1s-poll write amplification)
- [x] ISC-54: auto-end on no-activity — VERIFIED LIVE: meeting 1 self-flipped to `ended` past the 20-min threshold and stopBot was invoked (lingering bot stopped)
- [x] ISC-55: Zoom `pwd` stripped from stored/echoed meeting_url (redactMeetingUrl); Teams id length-capped
- [x] ISC-56: replace-all populates a NEW live meeting with zero duplication — VERIFIED LIVE 2026-06-13 meeting 2 "test2": grew 1→4→10 rows, rows==distinct_seq throughout; Hebrew + English both transcribed (mid-call language switch followed)

## Verification — post-review (2026-06-13)

- ISC-54: D1 query — meeting 1 status `ended`, rows 0 (ended serves from D1, no re-pull); auto-end path ran stopBot + UPDATE
- ISC-52/53/55: typecheck 0 errors, lint clean, build ✓, deployed 41d15cb9 / commit 617f32d; migration 004 applied live (last_segment_sig + last_activity_at columns, seq unique index dropped)
- Forge findings disposition: F1 fixed (ISC-52), F2 fixed (ISC-53), F3 fixed (client in-flight guard), F4 fixed (Stop for starting + auto-end), F5 confirmed-working (absolute_start_time populated), F6 fixed+verified (ISC-54), F7 documented, F8 fixed (ISC-55 + Teams cap)

## Changelog

- conjectured: array-index (seq) is a stable per-segment identity for idempotent upsert
- refuted by: Forge + Cato review 2026-06-13 — Vexa tail partials reorder/coalesce as they finalize, so a positional key silently overwrites the wrong utterance (rows==distinct_seq disproved duplication, not positional stability)
- learned: when a vendor returns the full collection each call with no stable per-item id, mirror it with atomic replace-all gated on a change signature — never invent an identity from position
- criterion now: ISC-52 (replace-all-on-change) + ISC-53 (change-detection gate)

## Criteria — auto-stop (2026-06-13, user request: end automatically when the Meet finishes)

- [x] ISC-57: auto-end on bot-left — `botRunning` (Vexa GET /bots/status) ends a meeting when its bot is no longer listed; VERIFIED LIVE: meeting 2 self-ended at 11:05:34 after the Meet finished, no manual Stop
- [x] ISC-58: self-heals from BOTH surfaces — maybeEndMeeting runs on detail-view poll and on list load (shared functions/_lib/meetings.ts); a stale 'live' badge reconciles from whichever page opens
- [x] ISC-59: bot-absence trusted only after 2-min join grace; vendor-status error never ends a meeting; 12h hard cap remains
- [x] ISC-60: transcript persists after end — meeting 2 ended with 10 segments intact, served from D1 (no re-pull on ended)

## Verification — auto-stop (2026-06-13)
- ISC-57/60: D1 — meeting 2 status `ended`, ended_at 2026-06-13T11:05:34Z, 10 segments retained; deploy dc5b1ade / commit c13a289
- Note: Vexa keeps its bot ~1-2 min after the human leaves (alone-timeout) before dropping it; auto-end fires on the next view once Vexa's running list no longer shows the bot — observed exactly this sequence live

---

# Calendar Auto-Join — ISA extension (2026-06-13)

## Problem
Meetings still require a manual "New meeting" + paste-link in the dashboard. Yaron wants the bot to join scheduled meetings on its own, reading the link from his calendar, laptop off.

## Vision
Connect Google Calendar once. Upcoming meetings with a Meet link appear in the dashboard; flip "auto-join" on the ones that matter. When such a meeting starts, the notetaker is already there — nobody created anything, nobody clicked join.

## Out of Scope (v1)
- Auto-joining EVERY meeting (chosen: opt-in per meeting).
- Zoom/Teams calendar links (v1 = Google Meet links on Google Calendar; extend later).
- Multi-account calendar (single owner's primary calendar first).

## Constraints
- Cloudflare-only: Pages Functions + D1 + a cron Worker (Pages has no cron). Worker is a thin per-minute trigger; dispatch logic lives in Pages Functions beside the existing Vexa/D1 code.
- Google refresh token encrypted at rest (AES-GCM, key in Pages secret).
- Reuses the existing meetings pipeline (createBot, maybeEndMeeting, replace-all transcript).
- Owner-only (requireUser) on all UI endpoints; the dispatch endpoint authes via a shared CRON_SECRET, not user session.

## Goal
A meeting on Yaron's Google Calendar that he flagged auto-join gets a Vexa bot dispatched at its start time by a Cloudflare cron Worker, with zero manual action and no local machine.

## Criteria
- [ ] CAL-1: GET /api/calendar reports connection status (connected email | not connected)
- [ ] CAL-2: GET /api/calendar/connect redirects to Google consent (calendar.readonly + calendar.events)
- [ ] CAL-3: GET /api/calendar/callback exchanges code, stores ENCRYPTED refresh token + email in D1
- [ ] CAL-4: POST /api/calendar/disconnect clears the connection
- [ ] CAL-5: GET /api/calendar/events lists upcoming events that have a Meet link, newest-window first, with auto_join flag
- [ ] CAL-6: events sync resolves each Meet link to platform+native_meeting_id (reuses parseMeetingUrl)
- [ ] CAL-7: POST /api/calendar/events/:gid/autojoin toggles the opt-in flag, persisted in D1
- [ ] CAL-8: POST /api/calendar/dispatch (CRON_SECRET auth) dispatches bots for auto_join events starting within the window, not already dispatched
- [ ] CAL-9: dispatch is idempotent — an event dispatched once is never double-dispatched (dispatched_meeting_id set; one-bot-per-code guard)
- [ ] CAL-10: dispatch creates a meetings row + Vexa bot via the existing createBot path
- [ ] CAL-11: cron Worker hits /api/calendar/dispatch every minute with the shared secret
- [ ] CAL-12: Anti: /api/calendar/dispatch without the correct CRON_SECRET returns 401
- [ ] CAL-13: Anti: a meeting NOT flagged auto_join is never dispatched
- [ ] CAL-14: Anti: Google token refresh failure degrades gracefully (status shows reconnect needed; no crash)
- [ ] CAL-15: UI — Connect Calendar card (our own, not the deleted Erez one) shows status + connect/disconnect
- [ ] CAL-16: UI — upcoming meetings list with per-meeting auto-join toggle
- [ ] CAL-17: typecheck + lint + build green
- [ ] CAL-18: D1 migration applied live (calendar_connection + calendar_events tables)
- [ ] CAL-19: deployed; cron Worker deployed with crons trigger
- [ ] CAL-20: E2E — a calendar meeting flagged auto-join gets the bot at start time (live)

## Decisions
- 2026-06-13 — Vexa has NO native calendar auto-join (verified docs); building it. Opt-in per meeting + CF Worker cron (Yaron's calls).
- 2026-06-13 — Cron Worker is a dumb trigger: fetch /api/calendar/dispatch with CRON_SECRET. Keeps all Google/Vexa/D1 logic in the dashboard repo (one place), Worker stays ~15 lines. Avoids duplicating creds/logic into a second deployable.
- 2026-06-13 — Refresh token AES-GCM encrypted at rest (long-lived calendar access); key = Pages secret CAL_TOKEN_KEY.
