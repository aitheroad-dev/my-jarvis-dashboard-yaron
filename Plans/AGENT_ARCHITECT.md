# Dashboard Architecture — The Single Window

> Architect: Architect Agent (PAI). Date: 2026-05-21.
> Companion doc: `Plans/VISION.md` (the operating premise, four locked decisions, three candidate pipes).
> Scope: end-to-end architecture for Yaron's personal dashboard at `my-jarvis-dashboard-yaron` — pipeline, schema, API surface, frontend, voice path, edit-in-place, risks.

---

## TL;DR — The recommendation

Pipe **B** (hooks POST through a Cloudflare Access service token to a new `/api/ingest/*` endpoint), with **Pulse promoted to the *capture buffer*** between local hook fire and dashboard write. Net pipe: `hooks → events.jsonl → Pulse forwarder module → POST https://dashboard/api/ingest/event (Cf Access service token) → Neon`. Browser sees updates via **Server-Sent Events** from `/api/stream` backed by Postgres `LISTEN/NOTIFY`. Voice lives in a dedicated dashboard panel (`/voice`) that initially mirrors `localhost:31338` via the same SSE stream and over time replaces it. Edit-in-place lands in a separate phase via a write-back service-token-authenticated `POST /api/artifact` that round-trips the file on disk through a local sync agent.

The reasoning, in one line: pipe B preserves the single auth model (Cloudflare Access for everything), turns Pulse into a buffer instead of a cloud dependency, and keeps the disk-as-source-of-truth invariant intact for the edit-in-place future. Direct Neon (pipe A) wins on raw latency but breaks the security model and forecloses the multi-device future Yaron has already paid for. Pulse-as-cloud-bridge (pipe C) makes Pulse a single point of failure for the dashboard.

---

## 1. Ideal-state picture — what the dashboard looks like once it's the single window

When Yaron opens his browser in the morning, the dashboard is already loaded. The terminal sits underneath; the dashboard sits on top. He keeps it open all day. Here's what he sees.

### 1.1 Global layout

A three-zone shell, always visible:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TOP BAR   PAI status · last sync · search · voice-now-playing widget   │
├────────┬─────────────────────────────────────────────────────────────────┤
│        │                                                                 │
│  NAV   │                       MAIN VIEW                                 │
│        │              (route content — page or detail)                   │
│        │                                                                 │
│        │                                                                 │
├────────┴─────────────────────────────────────────────────────────────────┤
│  ACTIVITY RAIL  (collapsible) — live event stream, last 50 events       │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Top bar (40px):** PAI status dot (green/amber/red — based on `lastSync < 30s`), last-sync timestamp, global search box, mini voice player showing currently-playing voice sample with pause/replay.
- **Left nav (220px, collapsible to 60px):** vertical sidebar. Order matters; this is the spine of the dashboard.
- **Main view (fluid):** the current route. Most routes are split — list on the left third, detail on the right two-thirds. This is the Obsidian/Linear pattern. Yaron is browsing, then reading.
- **Activity rail (right side, collapsible, 320px):** the firehose. Always present, always streaming, can be hidden when Yaron wants to focus on the main view.

### 1.2 The eight primary pages

In nav order:

1. **Home** — landing. Today-card (today's voice messages, today's commits, today's docs), pinned projects, active goal cards, recent artifacts strip.
2. **Activity** — the full event stream, filterable by source (PAI/hook/voice/file/tool), date range, agent, project. This is the "what happened on the machine" page. The right-rail is a compact view of this same data.
3. **Voice** — the voice player + queue + history. Replaces `localhost:31338` once mature. Per-agent color coding (blue jarvis, green atlas, pink nova, orange rex). Waveform, scrub, replay, transcript-search.
4. **Artifacts** — the document browser. *This is the central new surface.* Every doc PAI and Yaron create together lives here. Filterable, navigable prev/next, grouped by project/session/recency. Markdown rendering on the right.
5. **Projects** — the project page from the template, augmented with per-project artifact and activity feeds.
6. **Goals** — TELOS-driven, from the template. Active goals at top, deferred below.
7. **Tickets** — ISA-12 ticket browser, from the template.
8. **Agents · Skills · Memory · Knowledge** — the four "PAI brain" pages: who the agents are (with voice samples), what skills exist, what PAI remembers, the knowledge base. From the template, but every memory now has a "captured during session X" backlink because the event pipeline tracks origin.

A ninth section, **Settings**, lives in the user-menu dropdown — pipe health, dashboard preferences, voice volume defaults.

### 1.3 The home screen — what's on it

Home is the most-visited page. It must answer "what happened while I wasn't looking, and what do I care about right now?" without scrolling.

Four cards in a 2×2 grid:

1. **Today's activity** — a tight timeline of significant events from today. Not every tool call; only events tagged "significant" (artifact created, voice message, project status change, goal progress, ticket update). Click any row → drill to source.
2. **Pinned projects** — 3-6 cards Yaron pins. Each shows: title, current ticket, last activity timestamp, today's artifact count, last voice message related to this project.
3. **Voice today** — vertical list of today's voice messages. Click to play inline. Filterable by agent.
4. **Recent artifacts** — most recent 8 docs created or modified. Each is a card with title, project, last-edited timestamp, thumbnail of first lines.

Below the grid, a single **focus strip**: the artifact Yaron was last looking at, with prev/next chevrons. So if he closed the browser yesterday on a half-read document, opening the dashboard puts him back there in one click.

### 1.4 The Artifacts page — the new central surface

The vision doc is explicit: artifact navigation is the most-broken-today affordance and the most-mattering tomorrow. So this page gets the most design attention.

Two-pane layout:

- **Left (320px):** the artifact index. Three faceted axes at the top:
  - View: `Recent · By project · By session · By topic · Pinned`
  - Filter: type chips (`doc · plan · summary · transcript · note · draft`)
  - Search: full-text over artifact bodies (Postgres `tsvector` index)
- **Right (fluid):** the artifact viewer. Markdown rendered cleanly. At the top: title, project breadcrumb, "previous · next" chevrons, "created in session X" link, "related artifacts" sidebar. At the bottom: revision timeline.

The prev/next chevrons honor the current view. If Yaron is browsing "Recent," prev/next walks recency. If he switches to "By project," they walk inside that project. This matches how Finder navigates and how Obsidian's "open recent" works, fused.

A small but high-value affordance: keyboard shortcuts `j/k` for prev/next, `/` for search, `e` for edit (when edit-in-place lands). Yaron operates fast; the page rewards keyboard fluency.

### 1.5 The activity rail — the always-on firehose

A vertical column on the right side, 320px wide, collapsible. Each row is one event:

```
14:32  📄  Created  AGENT_ARCHITECT.md
       in my-jarvis-dashboard-yaron · session: dashboard-design
14:31  🎙  Voice   "I'm reading the vision doc now…"
       jarvis · 12s
14:28  ⚙️  Hook    SessionStart
       /Users/yaronkra/Projects/my-jarvis-dashboard-yaron
14:25  ✏️  Edited  vision-revision.md
       2 chunks · +14 -3 lines
```

- Newest at top, autoscrolls if Yaron is at the top.
- Click any row → drills to source (artifact viewer for docs, voice player for audio, raw event JSON for tool calls).
- Each event has an agent badge (color from agent registry).
- Density: 6-8 events visible at once.

This rail is the *visibility-is-leverage* surface. Yaron mentioned this as a worldview anchor — if he can't see state, he can't steer it. The rail is the always-on state view.

---

## 2. Event pipeline — pipe A vs B vs C

The choice is consequential because the pipe constrains every downstream decision (security, multi-device, edit-in-place, voice migration). Let me lay out each candidate against the actual constraints, then recommend.

### 2.1 The constraints, made explicit

1. **Continuity principle.** Sub-30s push, ideally sub-5s. No batching.
2. **Single auth model.** Cloudflare Access is the network edge. Everything cloud-side goes through it. The MCP-activity endpoint already shows the established escape hatch — a shared-secret POST that's *not* user-authenticated but is still secret-gated.
3. **Disk-as-source-of-truth.** PAI is the Life OS. PAI's hooks already write to `MEMORY/OBSERVABILITY/*.jsonl` and `MEMORY/VOICE/voice-events.jsonl`. The dashboard mirrors this; it does not replace it. The disk side wins any conflict.
4. **Multi-device-eventually.** Yaron operates from one machine today, but the dashboard is on Cloudflare Pages explicitly because future devices (laptop on the road, family Mac, eventually mobile) need read access. The pipe must not assume "local machine == dashboard machine."
5. **Edit-in-place is a planned destination.** The pipe needs a *backward channel* (dashboard → local file) eventually. Designing the forward channel without that in mind builds a wall.

### 2.2 Candidate A — Local sync agent writes directly to Neon

Mechanic: a long-running Bun process on Yaron's machine watches `MEMORY/OBSERVABILITY/*.jsonl` (via `fs.watch` or chokidar), parses new lines, and writes rows directly to Neon via the `DATABASE_URL` (the same connection string the Pages Functions use).

| Dimension | Verdict |
|---|---|
| Latency | **Excellent.** ~50-200ms from disk to Neon. |
| Auth model | **Bypasses Cloudflare Access entirely.** The local agent talks directly to Neon. This isn't a security violation in itself (the DB has its own auth), but it splits the trust surface: now Yaron has two credentials (Neon + Cf Access) on two paths. |
| Multi-device | **Single-machine only.** A second machine would need its own copy of `DATABASE_URL` and full Neon write access. |
| Edit-in-place reverse path | **Possible but ugly.** Dashboard writes to Neon via Pages Functions; local agent polls Neon to apply changes back to disk. Pulls every dashboard change through Neon. |
| Failure mode | **Silent.** If the agent crashes, the dashboard stops getting updates with no signal at the cloud edge. |
| Code surface | **Small.** ~200 lines TypeScript. |

**Why this is tempting:** it's the simplest. Read JSONL, write Postgres. Zero cloud changes.

**Why it loses:** it bypasses the established auth boundary (Cf Access), commits to single-machine forever (which contradicts having a *cloud* dashboard at all), and makes the edit-in-place reverse path go around Pages Functions. Two of the four locked decisions push against it.

### 2.3 Candidate B — Hooks POST via Cloudflare Access service token

Mechanic: hooks (or a thin forwarder) POST event payloads to `https://my-jarvis-dashboard-yaron.pages.dev/api/ingest/event` with two headers — `CF-Access-Client-Id` and `CF-Access-Client-Secret`, the standard Cf Access service-token pattern. The Pages Function validates the service-token presence (Cloudflare does this at the edge), then writes to Neon and emits a Postgres `NOTIFY` for SSE fan-out.

| Dimension | Verdict |
|---|---|
| Latency | **Good.** ~200-500ms (one Cloudflare hop + Pages Function + Neon write). |
| Auth model | **Single trust boundary.** All cloud traffic goes through Cf Access. Service token is the documented Cf Access escape for machine-to-machine. The MCP-activity POST endpoint already uses an analogous pattern (`X-MCP-Secret`); promoting to Cf Access service token is the more principled version. |
| Multi-device | **Native.** Any machine with the service token (rotated independently) can ingest. Mobile clients of the dashboard never need this; they just read. |
| Edit-in-place reverse path | **Clean.** Dashboard edits go through Pages Functions like everything else. A local sync agent (introduced *only* for the reverse path) polls or subscribes to a `/api/artifact/changes` SSE and applies edits to disk. The forward pipe stays unchanged. |
| Failure mode | **Visible at the edge.** Cf logs every request; Pages Functions log every write; Neon shows row count. Health is queryable. |
| Code surface | **Medium.** Forwarder ~150 lines, new `/api/ingest/*` endpoints ~100 lines each, schema additions, SSE endpoint ~100 lines. |

**Why this is the right answer:** it honors the auth boundary, future-proofs multi-device, and gives edit-in-place a clean symmetric path. The latency cost (~200ms over pipe A) is invisible to a human — well under the 30-second hard requirement, well under the 5-second comfort target.

### 2.4 Candidate C — Pulse becomes the hub and ships to dashboard

Mechanic: Pulse (the always-on local daemon at `localhost:31337`) absorbs hook outputs through its existing observability module, then a new Pulse module forwards to the dashboard via the same Cf Access service token pattern as candidate B.

| Dimension | Verdict |
|---|---|
| Latency | **Good.** Pulse already aggregates events; the forwarder adds ~100ms. |
| Auth model | **Same as B.** |
| Multi-device | **Bottlenecked by Pulse.** If Pulse is down on Yaron's machine, all dashboard updates stop, even though Cf and Neon are healthy. Pulse becomes a SPOF. |
| Edit-in-place reverse path | **Identical to B.** |
| Failure mode | **Mixed.** Pulse logs are local; cloud edge can't tell if Pulse is dead vs just quiet. |
| Code surface | **Larger.** Pulse module + dashboard endpoint + cross-process coordination. |

**Why this is tempting:** Pulse already does aggregation. Reusing it is DRY.

**Why it doesn't win as the primary:** it ties dashboard health to Pulse health. Pulse is critical infrastructure but it's a single Bun process under launchd; it occasionally restarts during PAI work. Coupling cloud-side state to that restart cycle is fragile. Worse: Pulse is doing too many other things (voice synthesis, cron, hook validation, telegram bot). Making it the dashboard pipe means every Pulse change has dashboard-down risk.

### 2.5 The recommended pipe — B, with Pulse promoted to *capture buffer*

The compromise that captures the best of B and C: **the hook writes are unchanged** (still to `MEMORY/OBSERVABILITY/*.jsonl` and `MEMORY/VOICE/voice-events.jsonl`). Pulse runs a new **forwarder module** that tails those JSONL files and POSTs to the dashboard. The forwarder maintains a checkpoint (`MEMORY/STATE/dashboard-forwarder.json`) so it can resume after Pulse restarts. If Pulse is dead, events accumulate on disk; on restart, Pulse catches up.

```
hook fires
   │
   ▼
writes JSONL line  ── disk is source of truth ──┐
   │                                            │
   ▼                                            │
Pulse forwarder module (tails JSONL)             │
   │                                            │
   ▼                                            │
POST https://dashboard/api/ingest/event          │
   ├── headers: CF-Access-Client-Id              │
   │              CF-Access-Client-Secret        │
   │                                            │
   ▼                                            │
Pages Function /api/ingest/event                │
   │                                            │
   ├── validates Cf Access service token (edge)  │
   ├── normalizes payload                        │
   ├── INSERT into dashboard.events              │
   ├── NOTIFY pg channel 'events'                │
   ▼                                            │
Neon Postgres                                   │
   │                                            │
   ▼                                            │
SSE subscribers on /api/stream  ────────────────┘
   │
   ▼
Browser receives event, updates UI
```

**Why this configuration:**

- The pipe is candidate B's auth model and reverse-path readiness.
- The forwarder being inside Pulse means we reuse the existing always-on daemon for buffering, restart resilience, and observability — without making Pulse the *transport*. Pulse is just the *agent* that does the POST. If Pulse is down, the pipe pauses; when it recovers, it catches up from the JSONL checkpoint. Cf and Neon are healthy throughout.
- The forwarder is a single module, ~200 lines, with one job: tail JSONL → POST. Clean separation; minimal Pulse surface.
- Latency: hooks write JSONL synchronously (<5ms), Pulse picks up via fs.watch (<50ms), POST round-trip (~250ms), browser SSE receives (~50ms). End-to-end: under 400ms in the happy path. Well below the 30s requirement.

### 2.6 The Cloudflare Access trust boundary, explicitly

Cf Access protects everything on `*.pages.dev` and the eventual custom domain. The two patterns we use:

1. **User auth (interactive).** Yaron's browser hits the dashboard. Cf Access validates against the email allow-list (`aitheroad@gmail.com`), sets `Cf-Access-Authenticated-User-Email` header. Pages Functions read this via `requireUser()` (which the codebase already implements in `functions/_lib/auth.ts`).
2. **Service-token auth (machine-to-machine).** The Pulse forwarder POSTs with `CF-Access-Client-Id` + `CF-Access-Client-Secret`. Cf Access validates the token at the edge. Pages Functions don't need to re-validate — if the request reached them, Cf Access already said it's legitimate.

Two service tokens, not one: `pulse-ingest` (write-only to `/api/ingest/*`) and `local-sync` (read-only to `/api/artifact/changes`, reserved for edit-in-place reverse path). Rotate independently. Store in `~/.claude/.env` as `DASHBOARD_INGEST_CLIENT_ID` and `DASHBOARD_INGEST_CLIENT_SECRET`.

**Why service tokens, not a custom `X-MCP-Secret`:** the MCP-activity endpoint uses `X-MCP-Secret` because it ships in a multi-tenant template where Cf Access wasn't always present. This dashboard is single-tenant with Cf Access everywhere. The right primitive is the one Cf Access ships natively. Migrating MCP-activity to service tokens is a follow-up cleanup, not a blocker for this design.

---

## 3. Data model deltas — what the schema needs beyond what's there

The existing schema (`001_init.sql` + `008_dashboard_brain.sql` + `010_mcp_activity.sql`) gives us projects, goals, tickets, agents, memories, voice_samples, page_content, mcp_activity. The dashboard-as-single-window vision needs three new tables and one new column on an existing table.

### 3.1 New table — `events` (the activity stream)

The firehose. Every PAI event lands here.

```sql
CREATE TABLE IF NOT EXISTS events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     timestamptz NOT NULL,           -- when on the local machine
  received_at     timestamptz NOT NULL DEFAULT now(),  -- when at the edge
  source          text NOT NULL,                  -- 'hook' | 'voice' | 'tool' | 'session' | 'file'
  type            text NOT NULL,                  -- dot-notation: 'tool.write', 'voice.spoken', etc
  agent           text REFERENCES agents(name) ON DELETE SET NULL,
  session_id      text,                           -- Claude session id when available
  project_slug    text REFERENCES projects(slug) ON DELETE SET NULL,
  ticket_slug     text REFERENCES tickets(slug) ON DELETE SET NULL,
  artifact_id     uuid,                           -- FK once artifacts table exists; nullable
  title           text,                           -- human-readable one-liner for the rail
  summary         text,                           -- 1-3 sentences
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- type-specific blob
  significant     boolean NOT NULL DEFAULT false  -- shown on Home "today" card
);

CREATE INDEX IF NOT EXISTS events_occurred_idx
  ON events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_source_type_idx
  ON events (source, type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_project_idx
  ON events (project_slug, occurred_at DESC)
  WHERE project_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_agent_idx
  ON events (agent, occurred_at DESC)
  WHERE agent IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_significant_idx
  ON events (occurred_at DESC)
  WHERE significant = true;
```

Why this shape: matches the `PAIEvent` interface PAI already emits, but adds dashboard-specific projections (`title`, `summary`, `significant`, `project_slug`, `ticket_slug`). The forwarder enriches as it writes — looking up project/ticket from session context, classifying significance via a small rules table.

### 3.2 New table — `artifacts` (the document index)

Every doc PAI and Yaron create together. This is the table that makes the Artifacts page work.

```sql
CREATE TABLE IF NOT EXISTS artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path     text NOT NULL UNIQUE,           -- absolute path on Yaron's machine
  title           text NOT NULL,                  -- first H1 or filename fallback
  kind            text NOT NULL,                  -- 'doc' | 'plan' | 'summary' | 'note' | 'transcript' | 'draft' | 'isa' | 'spec'
  project_slug    text REFERENCES projects(slug) ON DELETE SET NULL,
  ticket_slug     text REFERENCES tickets(slug) ON DELETE SET NULL,
  session_id      text,                           -- session that created/last-edited it
  agent           text REFERENCES agents(name) ON DELETE SET NULL,
  body_md         text NOT NULL,                  -- full markdown body (mirror of disk)
  body_html       text,                           -- pre-rendered HTML for fast view
  body_tsv        tsvector
                    GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body_md,''))) STORED,
  word_count      integer NOT NULL DEFAULT 0,
  pinned          boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  source_mtime    timestamptz NOT NULL,           -- mtime on disk at last sync
  content_hash    text NOT NULL                   -- sha256 of body_md for conflict detection
);

CREATE INDEX IF NOT EXISTS artifacts_updated_idx ON artifacts (updated_at DESC);
CREATE INDEX IF NOT EXISTS artifacts_project_idx ON artifacts (project_slug, updated_at DESC);
CREATE INDEX IF NOT EXISTS artifacts_kind_idx ON artifacts (kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS artifacts_tsv_idx ON artifacts USING gin (body_tsv);
CREATE INDEX IF NOT EXISTS artifacts_pinned_idx ON artifacts (pinned, updated_at DESC) WHERE pinned = true;

CREATE TRIGGER artifacts_updated
  BEFORE UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

The `content_hash` is the conflict-detection primitive for edit-in-place: dashboard reads, user edits in the dashboard, dashboard POSTs the edit with the original hash, server checks if disk-mtime/hash changed in the interim. If yes, return conflict; if no, accept.

### 3.3 New table — `artifact_revisions` (the document history)

Edit history. Independent of git; the dashboard doesn't assume artifacts are in git.

```sql
CREATE TABLE IF NOT EXISTS artifact_revisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id     uuid NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  revision_at     timestamptz NOT NULL DEFAULT now(),
  body_md         text NOT NULL,
  content_hash    text NOT NULL,
  edited_by       text NOT NULL CHECK (edited_by IN ('disk', 'dashboard', 'pai')),
  session_id      text,
  diff_summary    text                            -- e.g. "+12 -3 lines"
);

CREATE INDEX IF NOT EXISTS artifact_revisions_artifact_idx
  ON artifact_revisions (artifact_id, revision_at DESC);
```

Cap: keep the last 100 revisions per artifact (cleanup job in Pulse). Past that, the source of truth is git for the projects that have it.

### 3.4 Column addition — `voice_samples.context_ref`

The existing `voice_samples` table is fine but needs a back-reference to whatever produced the voice. Currently it has `text_content` and `audio_url` but no context. Add:

```sql
ALTER TABLE voice_samples ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE voice_samples ADD COLUMN IF NOT EXISTS project_slug text REFERENCES projects(slug) ON DELETE SET NULL;
ALTER TABLE voice_samples ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS voice_samples_session_idx ON voice_samples(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS voice_samples_project_idx ON voice_samples(project_slug, created_at DESC);
```

This is what makes voice navigation context-aware: "play the voice messages from this project" or "play the voice messages from this session."

### 3.5 New file — `sql/013_dashboard_stream.sql`

The migration. Holds all four changes above. Idempotent. Numbered after the existing `012_drift_fix.sql`.

### 3.6 What's deliberately NOT changing

- **No new agent fields.** The four-agent model (jarvis/atlas/nova/rex) is already encoded in `agents` rows seeded via `099_seed.sql`. The dashboard just reads.
- **No memory schema changes.** Memories already type-discriminated. Dashboard surfaces them as-is.
- **No skill changes.** Skills are PAI-side; the dashboard just lists them via `/api/skills`.

---

## 4. API surface — endpoints, wire formats, contracts

Five new endpoint groups beyond what `functions/api/` currently has. All under `/api/` and protected by Cf Access (user or service token).

### 4.1 Ingestion (service-token auth)

```
POST /api/ingest/event
  auth:    service token (pulse-ingest)
  body:    PAIEvent JSON — see schema below
  result:  201 {id, received_at}

POST /api/ingest/artifact
  auth:    service token (pulse-ingest)
  body:    { source_path, title, kind, body_md, source_mtime, session_id?, project_slug?, ticket_slug?, agent? }
  result:  201 {id, content_hash}    (or 200 with same shape if updating)

POST /api/ingest/voice
  auth:    service token (pulse-ingest)
  body:    { agent_name, text_content, audio_url, duration_seconds, voice_id, session_id?, project_slug? }
  result:  201 {id}

POST /api/ingest/batch
  auth:    service token (pulse-ingest)
  body:    { events?: PAIEvent[], artifacts?: Artifact[], voice?: VoiceSample[] }
  result:  201 { events_inserted, artifacts_inserted, voice_inserted }
```

`PAIEvent` JSON shape (mirrors the existing PAI emitter, plus dashboard fields):

```ts
interface PAIEvent {
  occurred_at: string;           // ISO 8601
  source: 'hook' | 'voice' | 'tool' | 'session' | 'file' | 'custom';
  type: string;                  // e.g. 'tool.write', 'voice.spoken', 'session.named', 'work.created'
  agent?: string;
  session_id?: string;
  project_slug?: string;
  ticket_slug?: string;
  artifact_id?: string;
  title?: string;                // optional one-liner; if omitted, derived from type+payload
  summary?: string;
  payload?: Record<string, unknown>;
  significant?: boolean;         // if omitted, classified server-side
}
```

The batch endpoint is what the Pulse forwarder uses by default — it can batch up to 50 events per call (still under 30s end-to-end), reducing edge requests under burst load.

### 4.2 Activity stream — server-sent events

```
GET /api/stream
  auth:    user (Cf Access)
  query:   ?since=<iso-timestamp>&types=tool.*,voice.*&project=<slug>
  result:  text/event-stream — server-sent events
```

Each event sent as:

```
event: activity
id: 01H...uuid
data: {"id":"...","occurred_at":"...","type":"tool.write",...}

```

Server-side: Pages Function holds the connection open, subscribes to Postgres `LISTEN events`, forwards new rows. On reconnect, client passes `Last-Event-ID` header; server backfills from `events` table since that id.

This is the firehose the activity rail subscribes to. One connection per open dashboard tab. SSE rather than WebSocket because: (a) it's HTTP, so Cf Access just works; (b) it's one-way, which is exactly what we need; (c) Pages Functions support it via streaming responses; (d) it auto-reconnects in the browser.

### 4.3 Artifact navigation

```
GET /api/artifacts
  auth:    user
  query:   ?view=recent|project|session|topic|pinned
           &project=<slug>
           &session=<id>
           &kind=<kind>
           &search=<q>          # full-text via tsvector
           &limit=50&offset=0
  result:  { items: ArtifactSummary[], total, next_offset }

GET /api/artifacts/:id
  auth:    user
  result:  Artifact (full body, plus prev/next ids honoring current view)

GET /api/artifacts/:id/revisions
  auth:    user
  result:  ArtifactRevision[]    (last 50)

POST /api/artifacts/:id/pin
  auth:    user
  body:    { pinned: boolean }
  result:  Artifact
```

`ArtifactSummary` is `Artifact` minus `body_md`, `body_html`, `body_tsv` — keeps list payloads small.

### 4.4 Edit-in-place (phase 3)

```
PUT /api/artifacts/:id
  auth:    user
  body:    { body_md, expected_content_hash }
  result:  200 Artifact | 409 { conflict: 'stale', current_hash, current_body_md }
```

Server flow:
1. Validate `expected_content_hash` matches current row.
2. If match: write new row to Postgres; emit `artifact.edited` event; return new row.
3. **Local sync** picks it up via `/api/artifact/changes` SSE (see below).
4. Local sync writes the file to disk.
5. Local sync POSTs `/api/ingest/artifact` with the new disk mtime to close the loop.

If no match: return 409 with the current body so dashboard can show a merge UI.

### 4.5 Reverse channel — `/api/artifact/changes` (service-token, read-only)

```
GET /api/artifact/changes
  auth:    service token (local-sync)
  result:  text/event-stream — emits artifact-edit events that need to land on disk
```

This is what the local sync agent subscribes to when edit-in-place is live. The local agent then writes the file to disk and POSTs back `/api/ingest/artifact` to confirm.

### 4.6 Voice feed (mostly already exists)

The template's `/api/voice/feed` already returns `voice_samples`. Augment with:

```
GET /api/voice/now-playing
  auth:    user
  result:  { current: VoiceSample | null, queue: VoiceSample[] }   # for the top-bar widget

POST /api/voice/play
  auth:    user
  body:    { sample_id }
  result:  202
```

For the eventual replacement of `localhost:31338`, the dashboard voice page polls or SSE-subscribes for new voice events. Audio bytes still live in R2; the dashboard plays via HTML5 `<audio>`.

### 4.7 Health & introspection

```
GET /api/sync/health
  auth:    user
  result:  { last_event_received_at, lag_seconds, forwarder_alive, neon_alive }
```

This powers the top-bar status dot. If `lag_seconds > 30`, dot goes amber. If `> 300`, red. Sourced from `received_at` on the newest event row.

---

## 5. Frontend architecture

### 5.1 Stack additions (minimal)

Already in the repo: React 19 + Vite + Tailwind + shadcn + the atomic-crm component library. Add:

- **TanStack Query** (`@tanstack/react-query`) for server state — caching, refetch, optimistic updates. Already a common pattern with atomic-crm.
- **EventSource polyfill** (none needed — modern Chrome has it native).
- **react-markdown** + **remark-gfm** for artifact rendering. (Likely already there for KB; verify before adding.)
- **fuse.js** (optional) for client-side search inside open artifact when full-text is overkill.

No new global state library. TanStack Query + URL params + a small `useActivityStream()` hook is enough.

### 5.2 Route map (additions to `CRM.tsx`)

```
/                           HomePage             (template, augmented with today-card)
/activity                   ActivityPage         (NEW — full event stream)
/voice                      VoicePage            (NEW — player + queue + history)
/artifacts                  ArtifactsPage        (NEW — list + viewer)
/artifacts/:id              ArtifactsPage        (NEW — same page, item selected)
/projects                   ProjectsPage         (template, augmented)
/projects/:slug             ProjectDetailPage    (template, augmented with activity feed tab)
/goals                      GoalsPage            (template)
/goals/:slug                GoalDetailPage       (template)
/tickets                    TicketsPage          (template)
/tickets/:slug              TicketDetailPage     (template)
/agents                     AgentsPage           (template)
/skills                     SkillsPage           (template)
/memory                     MemoryPage           (template)
/kb                         KBListPage           (template)
/kb-doc/*                   KBDocPage            (template)
/settings                   SettingsPage         (template, augmented with sync health)
```

### 5.3 The live-update mechanism — SSE, with sensible fallbacks

One global `useActivityStream()` hook, mounted at the app root via a `ActivityStreamProvider`. It opens one `EventSource` to `/api/stream`. Every event:

1. Pushes into a React context state `recentEvents` (the rail's data source, capped at 200 items).
2. Invalidates relevant TanStack Query keys — e.g. an `artifact.created` event invalidates `['artifacts', view, ...]` queries.
3. If the event has a notable user-visible side-effect (significant=true), shows a toast.

```ts
// useActivityStream.ts (sketch)
function ActivityStreamProvider({ children }) {
  const queryClient = useQueryClient();
  const [recentEvents, setRecentEvents] = useState<PAIEvent[]>([]);

  useEffect(() => {
    const lastId = localStorage.getItem('lastEventId');
    const es = new EventSource(`/api/stream${lastId ? `?since=${lastId}` : ''}`);

    es.addEventListener('activity', (e) => {
      const ev = JSON.parse(e.data);
      localStorage.setItem('lastEventId', ev.id);
      setRecentEvents(prev => [ev, ...prev].slice(0, 200));
      invalidateRelevantQueries(queryClient, ev);
    });

    es.onerror = () => { /* EventSource auto-reconnects; just log */ };
    return () => es.close();
  }, [queryClient]);

  return <ActivityStreamContext.Provider value={recentEvents}>{children}</ActivityStreamContext.Provider>;
}
```

**Why SSE and not WebSocket:**

- One-way push is all we need (browser doesn't send events back; it sends user actions via REST).
- Native browser reconnect with `Last-Event-ID`.
- Cf Pages Functions support streaming responses natively (`ReadableStream`).
- No long-lived stateful connection layer to manage.

**Why not polling:** even at 5s polling, the rail feels laggy and Neon bills go up under burst events. SSE delivers the event ~50ms after Pages Function receives it. The polling fallback is implicit: if SSE drops and doesn't recover, the rail goes stale but pages still work — TanStack Query refetches on focus/mount.

### 5.4 Artifact navigation — concrete UI

The Artifacts page is a controlled split. The left index has three control rows:

```
[Recent ▾]  [+ Project]  [+ Session]  [+ Pinned]   ← view picker
[doc] [plan] [summary] [note] [draft] [×]         ← kind chips
[🔍 search artifacts...                       ]    ← full-text
─────────────────────────────────────────────
14:32 AGENT_ARCHITECT.md            dashboard·plan
14:31 vision-revision.md            dashboard·doc
14:28 nl-schools-handoff.md         nl-schools·summary
…
```

Selecting an item:

- Updates URL to `/artifacts/:id` (so it's linkable).
- Right pane fetches the full body.
- The prev/next chevrons in the header walk the *current filtered list*.
- Keyboard: `j` → next, `k` → prev, `/` → focus search, `Enter` → open selection.

**Prev/next data flow:** the list query returns ids + a `cursor_at` (occurred-at value). The detail endpoint accepts `?view=recent&before_cursor=...&after_cursor=...` and returns the immediately-adjacent items' ids. Means the navigation is correct even if new items arrive while Yaron is reading.

### 5.5 Where the voice player lives

A persistent component `<VoicePlayerBar>` mounts in the global layout shell, between the top bar and the main view. Behavior:

- **Default state:** collapsed to a 32px bar with a play/pause button, agent badge, title of currently-playing sample, progress.
- **Expanded state:** clicking expands to ~120px with waveform, scrub, agent color background, transcript inline. Clicking again collapses.
- **Source of truth:** `useVoiceStream()` hook listens for `voice.spoken` events on the activity stream; when one arrives, the player either auto-plays (if user has auto-play on) or appears in the queue.
- **Queue management:** clicking the queue icon opens a popover with upcoming + history.

The dedicated `/voice` page is the *deep* surface: full history, scrub through transcripts, search, replay any past message. The bar is the always-present *now* surface.

This dual structure means the player is always visible (matching the always-on `localhost:31338` behavior) without taking screen real estate when not in use.

### 5.6 Performance budget

- Initial load: <2s on Yaron's local connection. Vite chunks the heavy components (artifact renderer, voice player) so the shell appears <500ms.
- Event rail update: <100ms from SSE event to DOM.
- Artifact open: <300ms (server fetch with body) for cold; <50ms for cached.
- Search: <500ms for tsvector queries with the gin index, even at 10k artifacts.

These numbers come from the fact that everything lives at the Cf edge (static assets, function execution) and Neon's pooled connections. The hard part is keeping the JS bundle under 500KB gzipped — atomic-crm tends to bring in a lot. Audit before launch.

---

## 6. Voice integration roadmap

The end state is clear: voice lives in the dashboard, `localhost:31338` is retired. Getting there in three milestones.

### 6.1 Milestone V1 — Mirror (no behavior change)

**What ships:**

- `voice_samples` table populated by the Pulse forwarder reading `MEMORY/VOICE/voice-events.jsonl`.
- New `/api/ingest/voice` endpoint that the forwarder POSTs to.
- The audio MP3 file (currently rendered by `say_local.py` to a temp file then played by `afplay`) gets uploaded to R2 — either by extending `say_local.py` to upload, or by Pulse uploading after the file is created. The R2 URL goes into `voice_samples.audio_url`.
- `/voice` page in the dashboard shows the historical feed (read-only). The persistent `<VoicePlayerBar>` mounts and shows a "now playing" widget driven by the same events.

**What doesn't change:** `pai-voice` still routes through the local Kokoro daemon and plays via `afplay`/`localhost:31338`. The dashboard is a *mirror*, not the player. Yaron hears voice from the daemon as today.

**Cost:** R2 storage and upload time per voice sample (~0.1s for a 10s clip; ~$0.015/GB/month storage). With ~50 voice events/day at ~10s each, that's ~5MB/day, or 150MB/month. Roughly free at R2's pricing.

**Why this first:** zero risk to voice playback. Dashboard gains the history surface. Yaron starts using it.

### 6.2 Milestone V2 — Browser playback opt-in

**What ships:**

- The `<VoicePlayerBar>` gains autoplay capability — when a new `voice.spoken` event arrives, the browser starts playing the R2 MP3.
- A new setting `voice.playback_source` with values `daemon | browser | both`. Default stays `daemon`. Yaron flips it to `browser` when he wants to test, or `both` for redundancy during the transition.
- The Pulse voice daemon adds a mode flag: when `playback_source=browser`, it still renders the MP3 (so it lands in R2) but skips `afplay`.

**What doesn't change:** `pai-voice` CLI still works identically. The render path is unchanged.

**Bug surface:** browser autoplay policies. If Yaron's tab loses focus, browsers can block autoplay. Mitigation: keep `daemon | both` available as fallback; surface a "voice tab is muted by browser" warning in the top bar.

### 6.3 Milestone V3 — Dashboard owns playback, daemon retires

**What ships:**

- `localhost:31338` web player retires. `pai-voice` keeps rendering MP3s but no longer manages playback at all — it just hands the MP3 path to the upload step.
- Dashboard becomes the only player.
- `say_local.py` no longer needs to know about playback at all; it's a pure render-to-disk function.

**What gets removed:** `~/.bun/bin/pai-voice` keeps existing as a CLI for backward compatibility (other tools call it), but its `--play` behavior delegates to "upload + emit event" rather than `afplay`.

**Yaron's experience:** identical to today — when PAI speaks, he hears it. The only difference is the audio comes through the dashboard tab instead of system audio. Which is what he wanted.

### 6.4 Concrete sequencing

V1 ships first (one sprint). V2 ships after Yaron has used V1 for ~2 weeks and the history surface is proven. V3 ships only after V2 has been stable for ~4 weeks — voice is too core to PAI to risk an unstable transition.

---

## 7. Edit-in-place design

This is the planned destination, not the first milestone. Designing for it now means we don't paint ourselves into a corner.

### 7.1 The conflict story — disk wins, dashboard knows

The vision doc is explicit: "the file on disk is still source of truth for many artifacts." That's the right call. Many artifacts are in git repos, in PAI's `MEMORY/`, in the project worktrees Yaron uses. The dashboard can't be authoritative there.

So the model is:

- **Disk is canonical for content.** When dashboard and disk disagree, disk wins.
- **Database is canonical for metadata** (project links, pins, kind classification, revision history). The disk file doesn't know about pins.
- **Both have a hash.** When the dashboard wants to write, it sends the hash it thinks the file currently has. If that hash doesn't match what's in the DB *and* the file mtime is newer than the DB's `source_mtime`, the dashboard is stale.

### 7.2 The write path

When Yaron edits an artifact in the dashboard and clicks save:

1. Dashboard sends `PUT /api/artifacts/:id` with new body + `expected_content_hash`.
2. Pages Function checks `expected_content_hash` against current row.
3. **If match:** writes new row, emits `artifact.edit.pending` event. Returns 200 with new artifact.
4. **If mismatch:** returns 409 with current body + current hash. Dashboard shows a merge UI (3-way: original / dashboard's edit / disk's current).
5. Local sync agent (running on Yaron's machine, subscribed to `/api/artifact/changes`) receives the `artifact.edit.pending` event, fetches the new body, writes to disk, then POSTs `/api/ingest/artifact` with the new disk mtime to mark the edit landed.

Time from save click to disk-write: ~500-800ms (one round trip out, one in).

### 7.3 The local sync agent — what it actually is

It's a new Pulse module: `modules/dashboard-sync.ts`. Two responsibilities:

1. **Tail JSONL forward** (already covered in the forwarder design — same module, two SSE subscriptions).
2. **Subscribe to `/api/artifact/changes`** and apply edits to disk. Each edit lands as a file write; if the file doesn't exist yet (a brand-new artifact from the dashboard), the agent decides where to put it based on `kind` and `project_slug` — for now, a simple convention: `~/Projects/{project}/Plans/{slug}.md` for plan-kind, `~/.claude/PAI/MEMORY/NOTES/{slug}.md` for note-kind, etc.

The agent never deletes files. Delete-from-dashboard goes to a soft-delete in the DB only; if Yaron actually wants the file gone, he removes it on disk and the next ingest cycle prunes the DB row.

### 7.4 Surface — where edit-in-place lives in the UI

On the artifact viewer page:

- A pencil icon top-right of the body. Click → switches the markdown rendering to a CodeMirror or Monaco textarea with markdown highlighting.
- Save button (or Cmd+S) → triggers the flow above.
- An "edited at" timestamp in the header turns blue + says "saving…" → "saved" → "synced to disk" as the three stages complete.
- Conflict UI is a modal with two columns (dashboard / disk) and an "open both in editor on disk" escape hatch.

### 7.5 What's deliberately *not* in scope for edit-in-place

- **Live collaborative editing.** Yaron is the only user. No CRDTs.
- **Rich-text/WYSIWYG.** Markdown source only. Yaron operates in markdown anyway.
- **File creation from the dashboard.** Phase 4. First lock down editing of existing files.
- **Rename/move.** Phase 4. Source paths are immutable in early edit-in-place.

---

## 8. Critical risks and unknowns

Three categories of risk: things that could break the design, assumptions that might be wrong, and unknown operational costs.

### 8.1 Pulse stability

**The risk:** Pulse is a single Bun process with a lot of responsibilities (cron, voice, hooks, telegram, observability, and now dashboard forwarder). It restarts occasionally during PAI work. Each restart pauses the dashboard pipe.

**Mitigation:** the forwarder uses a checkpoint file (`MEMORY/STATE/dashboard-forwarder.json`) and resumes from the last successful POST on restart. Within-second restarts cost nothing; minute-long Pulse outages mean a minute of dashboard lag (still under the 30s requirement is broken, but recoverable).

**Open question:** if Pulse is unstable enough that this becomes a daily annoyance, do we extract the forwarder into its own launchd plist? Probably yes, eventually. But starting inside Pulse is correct because the lifecycle is already managed there. Decision point: if dashboard lag exceeds 60s more than once a week for two consecutive weeks, fork the forwarder.

### 8.2 Cloudflare Pages Functions SSE limits

**The risk:** Cf Pages Functions have a 30-second CPU limit and connection limits per Worker. SSE streams that stay open for hours might hit these limits in non-obvious ways. There's a maximum of 100 concurrent connections per Worker isolate; for a single-user dashboard with maybe 2-3 tabs, this is fine, but the connection-per-tab model has a ceiling.

**Mitigation:** SSE in Pages Functions uses `ReadableStream` and `c.execution_ctx.waitUntil()` to extend lifetime past the request handler return. We don't run code for 30s; we hold a stream open and write to it as events arrive (Postgres LISTEN drives the writes). The CPU budget is consumed only during writes. Should be fine for single-user dashboard usage.

**Open question:** does Postgres `LISTEN/NOTIFY` work through Neon's pooled connections, or do we need a dedicated unpooled connection per SSE subscriber? Need to verify before phase 2. If `LISTEN` doesn't work over the pooled connection (which is plausible — pgBouncer in transaction mode breaks `LISTEN`), fallback is polling Neon every 2s from the Pages Function, which is acceptable for single-user but wastes Neon CPU. **This is the single biggest open technical question.** Verify with a spike before committing.

### 8.3 Artifact discovery — what counts as an artifact?

**The risk:** "everything PAI and Yaron create together" is precise as a principle but fuzzy as a heuristic. Does a transient draft in `/tmp` count? Does an internal hook log? Does a screenshot? Getting this wrong in either direction breaks the dashboard — too inclusive and the Artifacts page is noise, too exclusive and Yaron is back to Finder.

**Mitigation:** start with a tight allowlist of paths in the forwarder:
- `~/.claude/PAI/MEMORY/WORK/**/ISA.md`
- `~/.claude/PAI/MEMORY/LEARNING/**/*.md`
- `~/.claude/PAI/MEMORY/KNOWLEDGE/**/*.md`
- `~/Projects/**/Plans/**/*.md`
- `~/Projects/**/HANDOFF.md`
- `~/Projects/**/PROJECT.md`
- `~/.claude/PAI/USER/**/*.md` (excluding the structured TELOS files which are surfaced differently)

Expand the list based on use, not assumption. Yaron should be able to add a path via a settings UI without code changes.

**Open question:** how do we handle non-markdown artifacts? PDFs, images, the occasional CSV. Defer to phase 2 — markdown-only at start.

### 8.4 The continuity principle and tab focus

**The risk:** Yaron keeps the dashboard open all day, but he has many tabs. Browsers throttle background tabs heavily. SSE connections may pause or close when the tab is backgrounded for hours.

**Mitigation:** the dashboard reconnects on visibility change (`document.visibilitychange` listener) and replays missed events using `Last-Event-ID`. The user sees a "catching up…" indicator briefly. Backend keeps the SSE endpoint cheap so reconnect storms are tolerable.

**Open question:** if Yaron pins the tab and OS goes to sleep, Chrome may kill the connection without warning. On wake, we need to reconcile. The `lag_seconds` health endpoint surfaces this immediately, which is the right behavior — Yaron sees the amber dot, knows the pipe is recovering, doesn't trust stale data.

### 8.5 The MCP-activity precedent and migration

**The risk:** there's already an `X-MCP-Secret`-authed POST at `/api/mcp-activity`. The new ingest endpoints use Cf Access service tokens, not `X-MCP-Secret`. We end up with two auth patterns for machine-to-machine, which is the kind of inconsistency that gets confusing fast.

**Mitigation:** plan to migrate `/api/mcp-activity` to a service token in phase 2 or 3, after the new ingest pattern is proven. Document it as tech debt now; don't block ingest on it.

### 8.6 Edit-in-place and uncommitted git changes

**The risk:** if the dashboard writes to a file in a git repo with uncommitted changes, it overwrites them silently. This is the worst possible failure mode.

**Mitigation:** the local sync agent runs `git status` on the target file before writing. If the file is in a git repo and has uncommitted changes, the agent refuses to write and emits an `artifact.edit.blocked` event. Dashboard shows "file has uncommitted changes on disk — commit or stash, then retry."

This is non-negotiable. The first time the dashboard silently overwrites Yaron's local work, he stops trusting it forever.

### 8.7 What I'm assuming that might be wrong

- **That the rail will be a feature, not noise.** If the event volume is too high (and PAI emits a lot — every tool call), the rail becomes wallpaper. Mitigation: the `significant` flag and aggressive client-side filtering. Verify by living with it for a week before declaring it good.
- **That SSE through Cf Pages will work reliably.** Verified at the protocol level, but not battle-tested for hours-long connections. Spike this in phase 1.
- **That artifact discovery via path allowlist is sufficient.** It might miss things, or include too much. We learn by running.
- **That Yaron actually wants the dashboard open all day.** He says he does. If after a week it turns out he prefers terminal-first and dashboard-as-reference, the whole shape changes.

### 8.8 What we explicitly don't know yet

- **Total event volume.** How many events/day does PAI produce? Order-of-magnitude estimate: 500-2000. The schema and SSE design handle 10x that without strain, but Neon write costs scale linearly. Measure for a week before optimizing.
- **R2 bandwidth costs for voice playback from browser.** If V2 of voice rollout is heavy (Yaron replays a lot), R2 egress could be a small ongoing cost. Probably negligible but verify after V2.
- **Whether the local sync agent's git-aware write logic catches all the failure modes.** First few weeks of edit-in-place will surface them.

---

## 9. Phased build order

Not a "plan" in the sense of "approve and execute" — that's a follow-up doc — but the natural sequencing falls out of the design:

**Phase 1 — Pipe & rail (the core).** 013 migration. `/api/ingest/event` endpoint. Pulse forwarder module tailing `tool-activity.jsonl` + emitting events. SSE endpoint `/api/stream`. Dashboard activity rail. Health endpoint. End-state test: every PAI hook fire shows up in the rail within 5s.

**Phase 2 — Artifacts.** Forwarder also tails artifact paths via `fs.watch`. `/api/ingest/artifact`. `/api/artifacts*` endpoints. Artifacts page with list + viewer + prev/next. Pinning. Home-page focus strip. End-state test: PAI writes a doc, it appears in Artifacts within 5s, prev/next walks correctly.

**Phase 3 — Voice mirror (V1).** Forwarder tails voice-events. Upload to R2. `/api/ingest/voice`. `/voice` page + `<VoicePlayerBar>` (read-only, daemon still plays). End-state test: every voice utterance appears in the dashboard history within 5s.

**Phase 4 — Voice in-browser (V2 + V3).** Browser autoplay opt-in. Daemon retirement. End-state test: Yaron toggles `voice.playback_source=browser`, hears voice from browser instead of system, no regression.

**Phase 5 — Edit-in-place.** Dashboard editor mode. Conflict detection. Local sync agent reverse path. Git-aware safety. End-state test: edit a markdown file in the dashboard, see it land on disk within 1s, no overwrites of uncommitted git changes.

Each phase delivers value standalone. The continuity principle is satisfied after phase 1. Phase 2 makes the dashboard *the* document browser. Phase 3 retires the broken bits of `localhost:31338`. Phase 4 closes that retirement. Phase 5 turns the dashboard into a write surface.

---

## 10. Architectural principles, summarized

If this design is right, here's what it inherits:

1. **Single trust boundary** — Cf Access for everything cloud-side. User vs service token is the same boundary, two clients.
2. **Disk is canonical for content; database is canonical for metadata.** Conflicts resolve via hashes and explicit user intent.
3. **Push, not poll, but with cheap fallbacks.** SSE primary; reconnect-with-replay handles outages; TanStack Query refetch handles drops.
4. **Pulse is the agent, not the transport.** Pulse does the POST. The pipe is the public Cf endpoint. Pulse can die and the pipe is unaffected once Pulse restarts.
5. **Every event has a back-pointer to its origin.** session_id, agent, project, artifact id — so the dashboard is browseable by any of those axes.
6. **The browser is dumb until it isn't.** V1 just displays; V2 plays voice; V3 owns it; V5 edits. Each step proven before the next ships.
7. **Failure is visible.** The top-bar status dot is non-decorative. Lag, forwarder health, Neon health, all surface. Yaron sees state, so he can steer it.

---

## Appendix A — Event topic taxonomy (initial)

Sourced from the existing PAI event types in `hooks/lib/events.ts` plus dashboard-specific additions:

| Source | Type | When | Significant? |
|---|---|---|---|
| `hook` | `session.started` | SessionStart hook | yes |
| `hook` | `session.ended` | SessionEnd hook | yes |
| `hook` | `session.named` | PromptProcessing names a session | no |
| `hook` | `work.created` | ISA created | yes |
| `hook` | `work.completed` | ISA marked complete | yes |
| `tool` | `tool.write` | Write tool fired | sometimes |
| `tool` | `tool.edit` | Edit tool fired | sometimes |
| `tool` | `tool.bash` | Bash tool fired | no |
| `tool` | `tool.agent` | Agent spawned | yes |
| `tool` | `tool.skill` | Skill invoked | sometimes |
| `voice` | `voice.spoken` | pai-voice utterance | yes |
| `file` | `artifact.created` | New file in watched path | yes |
| `file` | `artifact.updated` | Existing watched file changed | sometimes |
| `file` | `artifact.deleted` | Watched file removed | yes |
| `dashboard` | `artifact.edit.pending` | User edited in dashboard | yes |
| `dashboard` | `artifact.edit.landed` | Local agent wrote to disk | no |
| `dashboard` | `artifact.edit.blocked` | Git conflict prevented write | yes |
| `dashboard` | `artifact.pinned` | User pinned artifact | no |

Significance classification is a small server-side function — pure logic, no inference. Yaron can override per-event-type via a settings table later.

---

## Appendix B — File-system locations (canonical)

| Concern | Path |
|---|---|
| Hook event log (source of truth) | `~/.claude/PAI/MEMORY/STATE/events.jsonl` |
| Tool activity (source of truth) | `~/.claude/PAI/MEMORY/OBSERVABILITY/tool-activity.jsonl` |
| Voice events (source of truth) | `~/.claude/PAI/MEMORY/VOICE/voice-events.jsonl` |
| Forwarder checkpoint | `~/.claude/PAI/MEMORY/STATE/dashboard-forwarder.json` |
| Service token credentials | `~/.claude/.env` keys: `DASHBOARD_INGEST_CLIENT_ID`, `DASHBOARD_INGEST_CLIENT_SECRET` |
| Pulse forwarder module | `~/.claude/PAI/PULSE/modules/dashboard-sync.ts` (new) |
| Dashboard migrations | `~/Projects/my-jarvis-dashboard-yaron/sql/013_dashboard_stream.sql` (new) |
| Ingest API | `~/Projects/my-jarvis-dashboard-yaron/functions/api/ingest/*.ts` (new) |
| SSE API | `~/Projects/my-jarvis-dashboard-yaron/functions/api/stream.ts` (new) |
| Artifacts API | `~/Projects/my-jarvis-dashboard-yaron/functions/api/artifacts/*.ts` (new) |
| Activity page | `~/Projects/my-jarvis-dashboard-yaron/src/components/atomic-crm/pages/ActivityPage.tsx` (new) |
| Artifacts page | `~/Projects/my-jarvis-dashboard-yaron/src/components/atomic-crm/pages/ArtifactsPage.tsx` (new) |
| Voice page | `~/Projects/my-jarvis-dashboard-yaron/src/components/atomic-crm/pages/VoicePage.tsx` (new) |
| Activity rail component | `~/Projects/my-jarvis-dashboard-yaron/src/components/atomic-crm/shell/ActivityRail.tsx` (new) |
| Voice player bar | `~/Projects/my-jarvis-dashboard-yaron/src/components/atomic-crm/shell/VoicePlayerBar.tsx` (new) |

---

*End of architecture document.*
