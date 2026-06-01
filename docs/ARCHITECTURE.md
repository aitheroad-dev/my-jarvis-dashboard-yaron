# MyJarvis Dashboard — Architecture

> How the dashboard is wired: every page, the full database, and how data flows from
> Yaron's PAI files on disk all the way to the screen. Companion to `docs/stack-notes.md`
> (infra setup) and the repo `CLAUDE.md` (template/provisioning rules).
>
> Last mapped: 2026-06-01. Diagrams are Mermaid — they render in GitHub and most Markdown viewers.

---

## 1. System at a glance

A **single-tenant** web dashboard that visualises Yaron's PAI life-operating-system data
(projects, goals, agents, memories, portfolio, …). It is a fork of the multi-tenant
MyJarvis template, deployed to **Cloudflare Pages**, reading from **Neon Postgres**, gated
by **Cloudflare Access**.

```mermaid
flowchart LR
  subgraph Disk["🗄️ PAI on disk (source of truth)"]
    PAI["~/.claude/PAI/USER/*\n~/.config/myjarvis/agents/*\nauto-memory/*"]
  end
  subgraph Sync["⚙️ Push sync (local)"]
    TOOL["scripts/sync-from-pai.ts\n(Bun, one-way upsert)"]
  end
  subgraph CF["☁️ Cloudflare"]
    ACCESS["Cloudflare Access\n(email gate)"]
    PAGES["Pages: React SPA\n(static dist/)"]
    FN["Pages Functions\nfunctions/api/*"]
    R2["R2 bucket\n(avatars, uploads)"]
  end
  NEON[("Neon Postgres\n15 tables")]
  VC["Voice-channel Worker\n(shared, per-tenant DO)"]

  PAI --> TOOL -->|"upsert via DATABASE_URL"| NEON
  Browser["🧑 Yaron's browser"] --> ACCESS --> PAGES
  PAGES -->|"same-origin fetch\n(+ Access cookie)"| FN
  FN -->|"neon() HTTP driver"| NEON
  FN --> R2
  VC -->|"POST /api/voice/ingest"| FN
```

**Founding constraint:** Neon is a **disposable projection of disk**. The PAI files are the
source of truth; the sync tool pushes one-way into Neon; the dashboard only ever *reads*
Neon. Nothing is authored in the browser and written back to disk.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 7 + TypeScript, Tailwind v4, shadcn/ui, lucide icons, react-router |
| Data fetching | Thin `useApi()` fetch wrapper (`src/lib/api.ts`); pages hold state with `useState`/`useEffect`. `@tanstack/react-query` present but not the primary pattern. Voice feed polls every 5s. |
| Backend | Cloudflare **Pages Functions** (file-routed under `functions/api/`) |
| Database | **Neon Postgres 17** (HTTP serverless driver, pooled endpoint) |
| Auth | **Cloudflare Access** (email gate) + per-handler owner check; WorkOS AuthKit client present from template |
| Storage | Neon (incl. voice audio as `BYTEA`) + **R2** (avatars, uploaded assets) |
| Voice | Shared `my-jarvis-voice-channel` Worker (per-tenant Durable Object), Kokoro-rendered MP3 |
| Deploy | `bun run build` → `wrangler pages deploy dist` (project `my-jarvis-dashboard-yaron`) |

---

## 3. Pages & navigation

The sidebar exposes **9 primary destinations**; several detail and document routes are
reachable by navigation but hidden from the sidebar.

```mermaid
flowchart TD
  Home["🏠 /home"]
  Goals["🎯 /goals-list"]:::nav --> GoalD["/goals/:slug"]
  Proj["📁 /projects-list"]:::nav --> ProjD["/projects/:slug"]
  Port["💰 /portfolio"]:::nav
  Tix["🎫 /tickets (kanban)"]:::nav --> TixD["/tickets/:slug"]
  Agents["🤖 /agents"]:::nav
  Skills["🧩 /skills"]:::nav --> SkillD["/skills/:slug"]
  Mem["🧠 /memory"]:::nav
  KB["📚 /knowledge-base"]:::nav --> KBdoc["/kb-doc/*"]
  KB --> Pitch["/pitch-doc/*"]
  Home -.-> Pitch

  %% cross-links between detail pages
  ProjD -.-> GoalD
  ProjD -.-> TixD
  GoalD -.-> TixD
  TixD -.-> ProjD
  TixD -.-> GoalD

  Meet["📅 /meetings (hidden)"]:::hidden --> MeetD["/meetings/:id"]
  Arch["📐 /dashboard-architecture (hidden)"]:::hidden
  Set["⚙️ /settings (hidden)"]:::hidden

  classDef nav fill:#1e3a5f,stroke:#4f9cf9,color:#fff;
  classDef hidden fill:#3a3a3a,stroke:#888,color:#ccc,stroke-dasharray:4;
```

### Route → component → API map

| Route | Component | API endpoint(s) | Related | Sidebar |
|---|---|---|---|---|
| `/` → `/home` | `HomePage.tsx` | — | pitch decks | **Home** |
| `/goals-list` | `GoalsListPage.tsx` | `GET /api/goals` | `/goals/:slug` | **Goals** |
| `/goals/:slug` | `GoalDetailPage.tsx` | `GET /api/goals/:slug` | projects, tickets | — |
| `/projects-list` | `ProjectsListPage.tsx` | `GET /api/projects` | `/projects/:slug` | **Projects** |
| `/projects/:slug` | `ProjectDetailPage.tsx` | `GET /api/projects/:slug` | goals, tickets | — |
| `/portfolio` | `PortfolioPage.tsx` | `GET /api/portfolio` | — | **Portfolio** |
| `/tickets` | `TicketsKanbanPage.tsx` | `GET /api/tickets`, `PUT /api/tickets/:slug` | `/tickets/:slug` | **Tickets** |
| `/tickets/:slug` | `TicketDetailPage.tsx` | `GET/PATCH/PUT/DELETE /api/tickets/:slug` | projects, goals | — |
| `/agents` | `AgentsPage.tsx` | `GET /api/agents` | — | **Agents** |
| `/skills` | `SkillsPage.tsx` | `GET /api/skills` | `/skills/:slug` | **Skills** |
| `/skills/:slug` | `SkillDetailPage.tsx` | `GET/PUT /api/skills/:slug` | `/skills` | — |
| `/memory` | `MemoryPage.tsx` | `GET /api/memories` | — | **Memory** |
| `/knowledge-base` | `KnowledgeBaseListPage.tsx` | `GET /api/kb` | kb/pitch docs | **Knowledge Base** |
| `/kb-doc/*` | `KbBlueprintPage.tsx` | `GET /api/kb/:slug` | KB | — |
| `/pitch-doc/*` | `PitchDocBlueprintPage.tsx` | `GET /api/kb/:slug` | KB | — |
| `/dashboard-architecture` | `DashboardArchitecturePage.tsx` | `GET /api/kb/...` | — | hidden |
| `/meetings` | `MeetingsPage.tsx` | `/api/meetings`, `/api/calendar` | `/meetings/:id` | hidden (opt-in) |
| `/meetings/:id` | `MeetingDetailPage.tsx` | `GET/POST /api/meetings/:id` | `/meetings` | — |
| `/settings` | `SettingsPage.tsx` | `GET/PATCH /api/settings` | — | hidden |

**Pattern:** each domain follows **list → detail**. The list page calls the collection
endpoint (`/api/<domain>`); the detail page calls the item endpoint (`/api/<domain>/:slug`)
which returns the row plus its related children (a project detail bundles its goals and
tickets, a goal detail bundles its tickets).

---

## 4. API layer

All endpoints are Cloudflare Pages Functions under `functions/api/`, file-routed. Every
handler calls `requireUser()` first, then `getDb(env)` for a Neon connection.

| Endpoint | Methods | Reads / writes |
|---|---|---|
| `/api/projects` · `/api/projects/[slug]` | GET | projects (+ child goals/tickets on detail) |
| `/api/goals` · `/api/goals/[slug]` | GET | goals (+ child tickets on detail) |
| `/api/tickets` · `/api/tickets/[slug]` | GET, POST, PUT, PATCH, DELETE | tickets (kanban writes status here) |
| `/api/agents` | GET | agents (LEFT JOIN tickets for current/in-flight) |
| `/api/memories` | GET | memories (ordered `created_at DESC`) |
| `/api/skills` · `/api/skills/[slug]` | GET, PUT | skills (detail editable) |
| `/api/portfolio` | GET | portfolio snapshot (see §6 note) |
| `/api/kb` · `/api/kb/[[catchall]]` | GET | page_content (KB + pitch docs) |
| `/api/meetings` · `/api/meetings/[id]` | GET, POST | meetings, meeting_transcript, meeting_actions |
| `/api/calendar` · `/calendar/events` · `/calendar/disconnect` | GET, POST | calendar connection |
| `/api/voice/ingest` | POST | inserts voice_samples (secret-gated, see §7) |
| `/api/voice/feed` | GET | lists voice_samples (newest 200) |
| `/api/voice/clip/[id]` | GET | streams `audio_data` BYTEA as MP3 |
| `/api/settings` | GET, PATCH | user_settings JSONB blob |
| `/api/mcp-activity` | GET, POST | mcp_activity audit feed |
| `/api/sessions` | GET, POST | session registry |
| `/api/upload` | POST | writes asset to R2 (Bearer-gated) |
| `/api/version` | — | build version string |

---

## 5. Database

15 tables across five concerns: **brain** (projects/goals/tickets/agents/memories),
**skills**, **meetings**, **portfolio**, and **platform** (settings/voice/KB/mcp-activity).

### Entity-relationship diagram

```mermaid
erDiagram
  projects ||--o{ goals    : "has (cascade)"
  projects ||--o{ tickets  : "owns (set null)"
  goals    ||--o{ tickets  : "groups (set null)"
  tickets  ||--o{ tickets  : "parent of (self)"
  agents   ||--o{ memories : "authors (set null)"
  agents   |o--o| tickets  : "current_ticket_id"
  meetings ||--o{ meeting_transcript : "transcribed"
  meetings ||--o{ meeting_actions    : "produces"
  portfolio_fx ||--o{ portfolio_holdings : "prices currency"

  projects {
    uuid id PK
    text slug UK
    text name
    text mission
    text status
    text body
    timestamptz updated_at
  }
  goals {
    uuid id PK
    text slug UK
    uuid project_id FK
    text title
    text description
    text status
    text body
  }
  tickets {
    uuid id PK
    text slug UK
    uuid project_id FK
    uuid goal_id FK
    uuid parent_id FK
    text agent
    text title
    text status
    text tier
    text current_step
    jsonb iscs
    text problem_vision_goal_etc "ISA fields"
  }
  agents {
    text name PK
    text display_name
    text voice_kokoro
    text voice_mcp
    text color
    text identity_md
    uuid current_ticket_id FK
  }
  memories {
    uuid id PK
    text agent FK
    text type "enum"
    text title
    text body
    jsonb metadata
    timestamptz created_at
  }
  skills {
    uuid id PK
    text slug UK
    text name
    text description
    text body
    text status
  }
  portfolio_holdings {
    serial id PK
    text ticker
    text exchange
    text currency
    numeric qty
    numeric price_native
    text cluster
  }
  portfolio_fx {
    text ccy PK
    numeric rate_to_base
    date as_of
  }
  voice_samples {
    uuid id PK
    text user_id
    text agent_name
    text text_content
    text audio_url
    bytea audio_data
    text audio_mime
    timestamptz created_at
  }
  meetings {
    bigserial id PK
    text title
    text status
    timestamptz started_at
  }
  meeting_transcript {
    bigserial id PK
    bigint meeting_id FK
    text speaker_name
    text words
    numeric start_ts
  }
  meeting_actions {
    bigserial id PK
    bigint meeting_id FK
    text action_type
    text content
  }
```

> Not drawn (no FKs — standalone tables): **user_settings** (`user_id` PK, JSONB blob),
> **page_content** (`page_slug` UK, JSONB — KB & pitch docs), **mcp_activity** (audit log).

### Foreign-key cheatsheet

| Child | Column | → Parent | On delete |
|---|---|---|---|
| goals | project_id | projects.id | **cascade** |
| tickets | project_id | projects.id | set null |
| tickets | goal_id | goals.id | set null |
| tickets | parent_id | tickets.id | set null (self-ref) |
| agents | current_ticket_id | tickets.id | set null |
| memories | agent | agents.name | set null |
| meeting_transcript | meeting_id | meetings.id | **cascade** |
| meeting_actions | meeting_id | meetings.id | **cascade** |

`tickets.agent` is a plain `text` mirror of `agents.name` (no enforced FK) — the assignment
link the kanban uses; `agents.current_ticket_id` is the reverse "what is this agent on now."

### Schema migration order

`001_init` (platform) → `002_meetings` → `008_dashboard_brain` (the 5 brain tables) →
`009_skills` → `010_mcp_activity` → `011_projects_body` (`projects.body`) →
`012_drift_fix` (`goals.body`, `tickets.tier`) → `013_portfolio` → `014_voice_audio`
(`voice_samples.audio_data/_mime`) → `099_seed`.

---

## 6. Data-flow: the read path

How a page renders, end to end:

```mermaid
sequenceDiagram
  participant U as Browser
  participant A as Cloudflare Access
  participant P as Pages (React SPA)
  participant F as Pages Function /api/*
  participant N as Neon Postgres

  U->>A: request dashboard
  A-->>U: Access cookie (email verified)
  U->>P: load SPA (static dist/)
  P->>F: fetch /api/<domain> (cookie rides along)
  F->>F: requireUser() — check Cf-Access-Authenticated-User-Email == TENANT_OWNER_EMAIL
  F->>N: neon() SELECT … (HTTP driver)
  N-->>F: rows
  F-->>P: JSON
  P-->>U: render list/detail
```

> **Current-state note — Portfolio:** `portfolio_holdings`/`portfolio_fx` tables exist
> (`013_portfolio`), but `/api/portfolio` currently serves a **hardcoded `SEED[]` array
> embedded in the function**, not a `SELECT`. Swapping to the table is a known TODO. Every
> other domain reads its table live.

---

## 7. Data-flow: PAI → Neon sync

The push-side ingestion that keeps the dashboard current with disk (built 2026-06-01).

```mermaid
flowchart LR
  subgraph Sources["PAI disk (source of truth)"]
    P1["USER/PROJECTS/PROJECTS.md\n+ each PROJECT.md"]
    P2["USER/TELOS/GOALS.md"]
    P3["~/.config/myjarvis/agents/*.json"]
    P4["auto-memory/*.md\n(birth time = memory date)"]
  end
  TOOL["scripts/sync-from-pai.ts\n(Bun)"]
  subgraph NeonT["Neon tables"]
    T1[(projects)]
    T2[(goals)]
    T3[(agents)]
    T4[(memories)]
  end
  P1 --> TOOL
  P2 --> TOOL
  P3 --> TOOL
  P4 --> TOOL
  TOOL -->|"upsert ON CONFLICT(slug)"| T1
  TOOL -->|"reconcile g{N}-* → life project"| T2
  TOOL -->|"upsert ON CONFLICT(name)"| T3
  TOOL -->|"delete-by-source + reinsert\ncreated_at = file birth time"| T4
```

- **Credential:** `DATABASE_URL` from env or gitignored `.dev.vars` (same string as the
  wrangler secret). **Model:** one-way, idempotent, non-destructive to dashboard-native rows
  (`life`, `update-telos`). **Run:** `bun scripts/sync-from-pai.ts [--dry-run]`.
- **Not yet synced:** tickets (no PAI source — dashboard-native), skills, portfolio.
- **Not yet scheduled:** runs manually; next step is a launchd timer.

---

## 8. Data-flow: voice

```mermaid
flowchart LR
  KOKORO["pai-voice / agent\n(Kokoro MP3)"] -->|"POST /api/voice/ingest\n(X-Voice-Ingest-Secret)"| ING["voice/ingest.ts"]
  ING -->|"audio ≤~1.5MB → BYTEA\nelse text-only"| VS[(voice_samples\n+ audio_data BYTEA)]
  FEED["VoiceChannelProvider\n(polls every 5s)"] -->|"GET /api/voice/feed"| VS
  PLAYER["VoicePlayerInline"] -->|"GET /api/voice/clip/:id"| VS
  VS -.->|"encode(audio_data,'base64')\nContent-Type audio/mpeg"| PLAYER
```

Voice **audio bytes live in Neon** (`voice_samples.audio_data BYTEA`), served via
`/api/voice/clip/:id`. R2 holds avatars and uploaded assets only. The frontend polls
`/api/voice/feed` every 5 seconds and plays new clips inline.

---

## 9. Auth & security model

```mermaid
flowchart TD
  REQ["Request to /api/*"] --> HDR{"Cf-Access-Authenticated-User-Email\n== TENANT_OWNER_EMAIL?"}
  HDR -->|no| R401["401 unauthorized"]
  HDR -->|yes| OK["AuthedUser → handler runs"]
  ING["/api/voice/ingest"] --> S1{"X-Voice-Ingest-Secret\n== VOICE_INGEST_SECRET?"}
  UP["/api/upload"] --> S2{"Bearer == VOICE_API_KEY?"}
```

- **Boundary:** Cloudflare Access verifies identity and sets `Cf-Access-Authenticated-User-Email`.
  `requireUser()` trusts that header and matches it against `TENANT_OWNER_EMAIL`
  (`aitheroad@gmail.com`). Browser fetches are same-origin, so the Access cookie rides along —
  no Bearer token in the SPA.
- **Machine endpoints:** `/api/voice/ingest` and `/api/upload` are gated by shared secrets
  (`VOICE_INGEST_SECRET`, `VOICE_API_KEY`) instead of Access, since they're called by Workers.
- **⚠️ Known hardening gap:** handlers trust the Access header without verifying the
  `Cf-Access-Jwt-Assertion` JWT signature against the team's JWKS. If a request reached a
  Function bypassing Access (misconfig), the header could be spoofed. Verifying the JWT is the
  documented next hardening step.

### Secrets & vars

| Name | Type | Purpose |
|---|---|---|
| `TENANT_OWNER_EMAIL` | public var | single-tenant allow-list |
| `DATABASE_URL` | secret | Neon pooled connection |
| `VOICE_INGEST_SECRET` | secret | voice ingest auth |
| `VOICE_API_KEY` | secret | upload endpoint auth |
| `VOICE_BUCKET` / `VOICE_PUBLIC_URL` | R2 binding / var | avatars + assets |
| `WORKOS_CLIENT_SECRET` | secret | WorkOS (template carry-over) |

---

## 10. Deployment

```mermaid
flowchart LR
  EDIT["edit src/ or functions/"] --> GATE["bun run typecheck && lint && build"]
  GATE --> DIST["dist/ (Vite bundle)"]
  DIST --> DEPLOY["wrangler pages deploy dist\n--project-name my-jarvis-dashboard-yaron"]
  DEPLOY --> LIVE["my-jarvis-dashboard-yaron.pages.dev\n(behind Cloudflare Access)"]
```

Pre-push gate: `typecheck && lint && build` (a failed deploy = user-facing outage). Data
changes (the PAI sync) need **no** redeploy — Functions read Neon at request time.

---

## 11. Current state (what's live vs placeholder)

| Domain | Source | Status |
|---|---|---|
| Projects / Goals / Agents / Memories | PAI disk → Neon (sync tool) | ✅ **live**, fresh per sync |
| Tickets | dashboard-native (Neon) | ✅ live; 1 seeded ticket; no PAI source yet |
| Skills | Neon (template seed) | seeded; not yet synced from `~/.claude/skills/` |
| Portfolio | hardcoded `SEED[]` in function | ⚠️ table exists but unused; swap to `SELECT` is TODO |
| Knowledge Base / pitch docs | Neon `page_content` | seeded |
| Voice feed | Neon `voice_samples` | wired; populates as agents ingest |
| Meetings | Neon (`meetings*`) | feature present, sidebar entry off |

---

*Maintenance: regenerate this map when routes, tables, or the sync sources change. The
authoritative sources are `src/components/atomic-crm/root/CRM.tsx` (routes), the `sql/*.sql`
migrations (schema), and `functions/api/**` (endpoints).*
