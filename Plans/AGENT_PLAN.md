# AGENT_PLAN — Dashboard: Current State → Single Window

## Shape of the plan

The dashboard already has the structured-work surface (projects/goals/tickets/agents/skills/memory/KB), a working Neon-backed API layer under `functions/api/*`, Cloudflare Access auth, and a precedent for write-from-outside via the `/api/mcp-activity` POST + `X-MCP-Secret` pattern. What it lacks is a live link from the local machine. The plan compounds in five milestones: M1 proves the pipe works end-to-end with the smallest possible new surface (an activity feed driven by hook events), M2 adds the artifact registry so docs PAI creates surface in the dashboard, M3 adds real-time push so latency drops from "next refresh" to sub-30s, M4 absorbs voice into the dashboard, and M5 turns the artifact registry into edit-in-place. Each milestone is useful by itself: M1 alone gives Yaron a live "what is PAI doing right now" pane; M2 alone replaces opening artifacts in Finder; M3 alone removes the dashboard-feels-stale failure mode. The pipe (A vs B vs C) is genuinely the open question — milestones are written so the architecture decision swaps the transport in one place without re-shaping the dashboard.

---

## M1 — Live activity stream (the pipe, proven)

**Why it exists.** Until one local event lands as a dashboard row, nothing else matters. M1's user-visible payoff: Yaron opens `/activity`, runs a PAI command in the terminal, and sees the event appear without a manual refresh. The dashboard becomes a "PAI is doing X right now" mirror — even if everything else stays as it is today.

**What ships.**
- New SQL migration `sql/013_activity_events.sql` — table `activity_events(id, tenant_id, source, kind, ref_type, ref_id, title, summary, payload jsonb, occurred_at, ingested_at)` with `(tenant_id, occurred_at desc)` index. Modelled on `mcp_activity` (which already proves the shape works).
- New Pages Function `functions/api/activity/index.ts` — `GET` (Cloudflare Access protected, returns recent 200 rows) + `POST` (header-auth via new `ACTIVITY_INGEST_SECRET`, validates and inserts). Same pattern as `functions/api/mcp-activity/index.ts:9` — reuse it.
- New CF Pages secret `ACTIVITY_INGEST_SECRET`.
- New page `src/components/atomic-crm/pages/ActivityPage.tsx` + route `/activity` in `src/components/atomic-crm/root/CRM.tsx:43` + sidebar entry in `src/components/atomic-crm/layout/nav-items.tsx:25`. Initial implementation: 30-second polling against `/api/activity` (deliberately dumb; M3 replaces with push).
- Local sender — one small script that reads from PAI's existing capture point (`~/.claude/MEMORY/OBSERVABILITY/*.jsonl` per `ARCHITECTURE_SUMMARY.md` Observability row) and POSTs unsent events to `/api/activity`. Lives in `~/.claude/PAI/TOOLS/DashboardSender/` so it's a PAI-side concern, not a dashboard-repo concern.

**Depends on.** Nothing in this repo. Needs `ACTIVITY_INGEST_SECRET` set in CF Pages. Pipe-agnostic by design: the local sender is a thin shim that the architect's pipe decision later replaces or wraps.

**How we verify it works.** From terminal: trigger any PAI tool that writes to observability. Open `https://<dashboard>/activity` in the browser, wait at most 30 seconds, see the event row. Inspect via Interceptor per the global rule.

**Risk.** Most likely break: Cloudflare Access blocks the POST because the local sender doesn't carry an Access JWT. Mitigation: header-auth via `ACTIVITY_INGEST_SECRET` only, which is exactly the pattern `mcp-activity` already uses successfully. Don't try to put Access in front of the ingest path — it's the wrong tool for machine-to-cloud auth.

---

## M2 — Artifact registry (docs surface in the dashboard)

**Why it exists.** Yaron stops opening files in Finder. When PAI writes `Plans/AGENT_PLAN.md` or any other document, it shows up under `/artifacts`, browseable forward/back by recency and by project, click-to-open in the dashboard. This is the single biggest behavioral change the vision describes ("All artifacts I and PAI create together").

**What ships.**
- SQL migration `sql/014_artifacts.sql` — table `artifacts(id, tenant_id, path text, title, kind, body text, source_session_id, project_slug, ticket_slug, skill_slug, created_at, updated_at, content_hash)`. `path` is the canonical key for upsert. `body` holds rendered markdown.
- Pages Function `functions/api/artifacts/index.ts` (list, with `?project=`, `?since=`, `?kind=` filters) + `functions/api/artifacts/[path].ts` (get-one by path). POST/PUT behind `ACTIVITY_INGEST_SECRET` for upsert.
- Frontend: `src/components/atomic-crm/pages/ArtifactsListPage.tsx` (recency-sorted list, filter by project, search) + `ArtifactDetailPage.tsx` (renders body through the existing `BlockRenderer` pipeline that `ProjectDetailPage.tsx:14` already uses — `parseBodyBlocks` is right there to reuse). Routes `/artifacts` and `/artifacts/*` in `CRM.tsx`. Sidebar entry between Memory and Knowledge Base.
- Cross-link: extend `ProjectDetailPage.tsx` to show recent artifacts for that project — a "Documents" section pulling `GET /api/artifacts?project=<slug>`.
- Local sender extension: a PAI hook (likely `PostToolUse` for Write/Edit on `*.md` files under tracked paths) POSTs the artifact to `/api/artifacts`. Same secret as M1.

**Depends on.** M1 (proves the ingest pipe + secret + Pages Function pattern). Optional but not blocking: the architect's pipe decision — if pipe A wins (direct-to-Neon), the local sender becomes a `pg` insert instead of an HTTP POST; the dashboard side is unaffected because `/api/artifacts` is still the read path.

**How we verify it works.** PAI writes a new file under a known project. Within 30s the artifact row appears at `/artifacts`, the document body renders correctly using the same block recipe as project bodies, and clicking the project link from the artifact navigates to the project detail page.

**Risk.** Most likely break: the dashboard becomes a dumping ground for every random `.md` PAI touches (session ISAs, scratch notes, generated index files). Mitigation: filter at the local hook — only files under explicit allow-pathed directories (`PAI/USER/PROJECTS/`, the dashboard repo's `Plans/`, etc.). Make the allow-list explicit and editable; trust nothing implicitly.

---

## M3 — Real-time push (latency: 30s → sub-5s)

**Why it exists.** Polling at 30s works but breaks the continuity principle the moment Yaron starts mentally treating the dashboard as ground truth — he'll glance at it expecting now and see 30-seconds-ago. M3 cuts perceived latency to imperceptible, which is what the locked decision (#2: "Real-time push, sub-30s latency. No batching.") actually demands.

**What ships.**
- Server: a Durable Object or SSE endpoint that streams new `activity_events` and `artifacts` rows to connected dashboard tabs. The existing `my-jarvis-voice-channel` Worker (per `CLAUDE.md` "Consolidated voice-channel Worker" section) is the precedent — same Durable Object pattern, one shared Worker, per-tenant DO instance keyed by `__TENANT__` (currently `yaron`). Decide between SSE (simple, one-way, browsers love it) and DO-backed WebSocket (matches voice channel pattern). The vision allows either; pick SSE first unless the architect's pipe decision demands DO.
- Frontend: replace polling in `ActivityPage.tsx` and `ArtifactsListPage.tsx` with an `EventSource` (or WS) subscription. Fall back to polling on disconnect.
- Local sender: after a successful POST (or direct Neon insert if pipe A), ping the push endpoint so it fans out to subscribers immediately. If the push channel is unreachable, the dashboard still polls — push is acceleration, not the source of truth.

**Depends on.** M1 (the ingest pipe exists). M2 (artifacts is the second-loudest stream and the most valuable to make instant). The architect's pipe decision — pipe A and pipe B both push the same way; pipe C (Pulse as hub) might place the push endpoint inside Pulse itself, which is a different deployment shape. Flag and resolve at M3 kickoff, not earlier.

**How we verify it works.** Open `/activity` in one window and `/artifacts` in another. Trigger an event from terminal. Both panes update within 5 seconds without any user action. Measure with the Interceptor skill capturing a timestamped before/after.

**Risk.** Most likely break: Cloudflare Pages Functions don't natively do long-lived connections; SSE on Pages works but is connection-limited, and a stale tab will eventually disconnect silently. Mitigation: poll-fallback on disconnect, surface connection status in the UI ("live" vs "polling") so Yaron can see the state instead of guessing.

---

## M4 — Voice inside the dashboard (retire `localhost:31338`)

**Why it exists.** Closes locked decision #3. Voice currently lives in a separate browser tab the pai-voice daemon serves on port 31338. M4 absorbs that surface into the dashboard so Yaron has one window instead of two. Until M4, voice still works — M4 is replacement, not blocker.

**What ships.**
- SQL migration `sql/015_voice_events.sql` (or extend `voice_samples` already present in `001_init.sql`). Existing voice infra in the template (`voice_samples` table + `GET /api/voice/feed` per `sql/README.md`) is the right anchor — reuse if shape fits, extend if not.
- Frontend: `src/components/atomic-crm/voice/VoicePanel.tsx` — a persistent dock (bottom-right or sidebar) showing current queue, per-agent color coding (jarvis blue / atlas green / nova pink / rex orange per global `CLAUDE.md`), play/pause/scrub, replay-past-message. Subscribe to the M3 push stream filtered to `kind=voice`.
- Audio: render path stays local (Kokoro via pai-voice) but instead of playing through the daemon's web player at 31338, the daemon enqueues to the dashboard via the existing M1/M2 pipe. The dashboard plays the audio file (fetched from R2 — `__VOICE_PUBLIC_URL__` placeholder is already plumbed per `CLAUDE.md` Placeholders table).
- Daemon change: pai-voice (in `~/.claude/PAI/TOOLS/PaiVoice/`) gets a "dashboard mode" flag. When dashboard is the active surface, daemon yields playback to the dashboard the same way it currently yields to `localhost:31338` when that page is open.
- Retire `localhost:31338` only after a one-week parallel-run period where both surfaces work.

**Depends on.** M3 (real-time push) — voice needs sub-second latency, polling won't cut it. Voice R2 bucket already exists per template. The architect's pipe decision: voice events are events; M4 just adds a `kind=voice` filter to the existing stream.

**How we verify it works.** Run `pai-voice "test message" --title "M4"`. The message appears in the dashboard voice panel, plays through dashboard audio, color-coded by agent. Close the dashboard tab; daemon falls back to `afplay`. Open the dashboard again; daemon yields to it. Three concurrent agents (jarvis + atlas + nova) line up in FIFO without stepping on each other (which is what the daemon's Unix-socket arbitration already provides — dashboard inherits it).

**Risk.** Most likely break: audio autoplay restrictions in Chrome — the dashboard tab needs user interaction before it can play sound. Mitigation: first-load "click to enable voice" prompt; persist the permission. Second risk: R2 access from the local daemon requires credentials that currently live in CF Pages secrets, not on the local machine. Mitigation: the daemon uploads to R2 via a thin Pages Function endpoint (`POST /api/voice/upload`) authed with `ACTIVITY_INGEST_SECRET`, server-side proxies to R2. Reuses the security model M1 established.

---

## M5 — Edit-in-place (the planned destination)

**Why it exists.** Closes locked decision #4. After M2 the dashboard *shows* artifacts; M5 lets Yaron *change* them inside the dashboard without dropping back to a terminal editor. Last because every prior milestone has to stabilize first — editing introduces conflict resolution that read-only doesn't have.

**What ships.**
- SQL: add `artifacts.edited_in_dashboard_at`, `artifacts.local_mtime`, and a `artifact_edits(id, artifact_id, body_before, body_after, edited_at, conflict bool)` audit table. Migration `sql/016_artifact_edits.sql`.
- Backend: `PUT /api/artifacts/:path` accepts new body. Writes back to dashboard DB *and* fires an event the local side picks up to write the file on disk (the local sender becomes bidirectional — daemon at this point).
- Frontend: in-place markdown editor on `ArtifactDetailPage.tsx`. Use an existing lightweight editor (CodeMirror 6 or Lexical) — avoid building from scratch. Save button shows pending-write state; full-success state pulls the updated artifact back from the API to confirm round-trip.
- Conflict policy: if `local_mtime` advanced since dashboard last read the file (because Yaron or PAI edited it locally), refuse the save and present a 2-pane diff. No silent overwrites ever.

**Depends on.** M2 (artifacts exist), M3 (push for immediate save confirmation), and a stable local daemon that can apply writes. The architect's pipe decision matters most here — if pipe A wins (direct-to-Neon), the local daemon already has bidirectional flow; if pipe B wins (HTTP), need a new local listener.

**How we verify it works.** Edit a doc in the dashboard. Save. Open the same file in a terminal editor — content matches. Edit it in the terminal while the dashboard tab is open — dashboard shows "external edit detected" and refreshes. Edit it in both simultaneously — second save refuses with a diff.

**Risk.** Most likely break: race conditions between local file watcher and dashboard save = data loss. Mitigation: every save writes to `artifact_edits` audit table first (append-only), then to the file. If something goes wrong, the audit table is the source of truth and recovery is possible. Don't ship M5 without the audit table.

---

## First thing to ship this week

**The smallest move that proves the vision works: M1's `/api/activity` POST + GET + the simplest possible `ActivityPage.tsx` polling at 30s.** No artifact registry, no push, no voice. Just one new SQL migration, one Pages Function (copy `functions/api/mcp-activity/index.ts` as the template — it already has Cloudflare Access auth on GET, header-auth on POST, validation, and Neon insert), one secret, one page, and one tiny local sender that tails `~/.claude/MEMORY/OBSERVABILITY/*.jsonl` and POSTs the rows.

This is roughly one day of work. The moment the first event appears in the dashboard, Yaron will know whether the continuity principle is going to feel right — and that signal is what every downstream milestone depends on. If the 30s polling feels too laggy from day one, M3 jumps ahead of M2. If it feels fine, M2 is the next obvious win. You can't predict that from the vision doc alone; you have to ship M1 and feel it.
