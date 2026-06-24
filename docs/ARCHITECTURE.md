# MyJarvis Dashboard — Architecture

> How the dashboard is wired: every page, the full database, and how data flows from
> Yaron's PAI files on disk all the way to the screen. Companion to `docs/stack-notes.md`
> (infra setup) and the repo `CLAUDE.md` (template/provisioning rules).
>
> Last mapped: 2026-06-24 (updated for D1 migration + CF Access). Diagrams are Mermaid — they render in GitHub and most Markdown viewers.

---

## 1. System at a glance

A **single-tenant** web dashboard that visualises Yaron's PAI life-operating-system data
(projects, goals, agents, memories, portfolio, …). Originally forked from the multi-tenant
MyJarvis template, now long diverged. Deployed to **Cloudflare Pages**, reading from
**Cloudflare D1 (SQLite)**, gated by **Cloudflare Access**.

```mermaid
flowchart LR
  subgraph Disk["🗄️ PAI on disk (source of truth)"]
    PAI["~/.claude/PAI/USER/*\n~/.config/myjarvis/agents/*\nauto-memory/*"]
  end
  subgraph Sync["⚙️ Push sync (local)"]
    TOOL["scripts/sync-from-pai.ts\n(one-way upsert)"]
  end
  subgraph CF["☁️ Cloudflare"]
    ACCESS["Cloudflare Access\n(JWT-verified gate)"]
    PAGES["Pages: React SPA\n(static dist/)"]
    FN["Pages Functions\nfunctions/api/*"]
    D1[("D1 / SQLite\nDB binding")]
    R2["R2 bucket\n(voice audio, uploads)"]
    AI["Workers AI\n(/move agent)"]
  end

  PAI --> TOOL -->|"upsert via wrangler d1 execute"| D1
  Browser["🧑 Yaron's browser"] --> ACCESS --> PAGES
  PAGES -->|"same-origin fetch\n(+ Access JWT)"| FN
  FN -->|"getDb(env) — D1 binding"| D1
  FN --> R2
  FN --> AI
```

**Founding constraint:** the database is a **disposable projection of disk**. The PAI files
are the source of truth; the sync tool pushes one-way into the store; the dashboard only ever
*reads* it. Nothing is authored in the browser and written back to disk.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 7 + TypeScript, Tailwind v4, `@radix-ui` primitives (no `shadcn` dependency), lucide icons, react-router 7 |
| Data fetching | Thin `useApi()` fetch wrapper (`src/lib/api.ts`); pages hold state with `useState`/`useEffect`. `@tanstack/react-query` present but not the primary pattern. Voice feed polls every 5s. |
| Backend | Cloudflare **Pages Functions** (file-routed under `functions/api/`) |
| Database | **Cloudflare D1 (SQLite)** — binding `DB`, database `mjd-yaron-db`; tagged-template SQL via `getDb(env)` |
| Auth | **Cloudflare Access** with full JWT verification (`requireUser()` verifies the RS256 `Cf-Access-Jwt-Assertion` against the team JWKS) + allow-list + per-page grants. The old WorkOS AuthKit client is replaced by a local `src/lib/workos-shim`; real WorkOS is no longer in the live path. |
| Storage | **R2** (`VOICE_BUCKET`) for voice-clip audio + uploaded assets — voice bytes are no longer stored in the database |
| AI | Cloudflare **Workers AI** (`AI` binding) — powers the `/move` natural-language agent |
| Voice | Kokoro-rendered MP3 ingested via `/api/voice/ingest`, stored in R2, served at `${VOICE_PUBLIC_URL}/<id>.mp3` |
| Deploy | `npm run deploy` (= `npm run build` → `wrangler pages deploy dist`, direct-upload; project `my-jarvis-dashboard-yaron`) |

---

## 3. Pages & navigation

The sidebar exposes **15 grantable pages**; several detail and document routes are reachable
by navigation but hidden from the sidebar. The page set is the `PAGES` manifest in
`src/lib/pages.tsx` (rendered by `CRM.tsx`) with sidebar entries in `nav-items.tsx`. The owner
sees all pages; a granted guest sees only their granted subset. (**Note:** the old `/tickets`
kanban was removed and replaced by `/situation`; **Meetings is now a normal sidebar entry**.)

```mermaid
flowchart TD
  Home["🏠 /home"]:::nav
  Goals["🎯 /goals-list"]:::nav --> GoalD["/goals/:slug"]
  Proj["📁 /projects-list"]:::nav --> ProjD["/projects/:slug"]
  Port["💰 /portfolio"]:::nav
  Spend["🧾 /spend"]:::nav
  Sites["🌐 /deployed-sites (Sites)"]:::nav
  Move["🚚 /move (מעבר דירה)"]:::nav
  Rental["📍 /rental"]:::nav
  Sit["📡 /situation"]:::nav
  Agents["🤖 /agents"]:::nav
  Skills["🧩 /skills"]:::nav --> SkillD["/skills/:slug"]
  Mem["🧠 /memory"]:::nav
  KB["📚 /knowledge-base"]:::nav --> KBdoc["/kb-doc/*"]
  Meet["📅 /meetings"]:::nav --> MeetD["/meetings/:id"]
  Tools["🔧 /tools"]:::nav

  Root["/ (redirect)"]:::hidden
  Set["⚙️ /settings (owner)"]:::hidden

  classDef nav fill:#1e3a5f,stroke:#4f9cf9,color:#fff;
  classDef hidden fill:#3a3a3a,stroke:#888,color:#ccc,stroke-dasharray:4;
```

### Route → component → API map

| Route | Component | API endpoint(s) | Sidebar |
|---|---|---|---|
| `/` → `/home` | `HomePage.tsx` | `/api/situation`, `/api/projects`, `/api/goals` | redirect |
| `/home` | `HomePage.tsx` | `/api/situation`, `/api/projects`, `/api/goals` | **Home** |
| `/goals-list` (+ `/goals/:slug`) | `GoalsListPage.tsx` / `GoalDetailPage.tsx` | `GET /api/goals`, `/api/goals/:slug` | **Goals** |
| `/projects-list` (+ `/projects/:slug`) | `ProjectsListPage.tsx` / `ProjectDetailPage.tsx` | `GET /api/projects`, `/api/projects/:slug` | **Projects** |
| `/portfolio` | `PortfolioPage.tsx` | `GET /api/portfolio` | **Portfolio** |
| `/spend` | `SpendPage.tsx` | `GET /api/spend` | **Spend** |
| `/deployed-sites` | `DeployedSitesPage.tsx` | `GET/POST/PATCH/DELETE /api/deployed-sites` | **Sites** |
| `/move` | `MovePage.tsx` | `/api/move` (+ Workers-AI agent) | **מעבר דירה** |
| `/rental` | `RentalPage.tsx` | `GET /api/rental` | **Rental** |
| `/situation` | `SituationPage.tsx` | `/api/situation` | **Situation** |
| `/agents` | `AgentsPage.tsx` | `GET /api/agents` | **Agents** |
| `/skills` (+ `/skills/:slug`) | `SkillsPage.tsx` / `SkillDetailPage.tsx` | `GET/PUT /api/skills` | **Skills** |
| `/memory` | `MemoryPage.tsx` | `GET /api/memories` | **Memory** |
| `/knowledge-base` (+ `/kb-doc/*`) | `KnowledgeBaseListPage.tsx` / `KbBlueprintPage.tsx` | `GET /api/kb`, `/api/kb/:slug` | **Knowledge Base** |
| `/meetings` (+ `/meetings/:id`) | `MeetingsPage.tsx` / `MeetingDetailPage.tsx` | `/api/meetings`, `/api/calendar` | **Meetings** |
| `/tools` | `ToolsPage.tsx` | — (embeds external pai-tools Worker) | **Tools** |
| `/settings` | `SettingsPage.tsx` | `GET/PATCH /api/settings` + `/api/grants` | owner-only |

**Pattern:** most domains follow **list → detail**. The list page calls the collection
endpoint (`/api/<domain>`); the detail page calls the item endpoint (`/api/<domain>/:slug`),
which returns the row plus related children (a project detail bundles its goals, a goal
detail bundles its children).

---

## 4. API layer

All endpoints are Cloudflare Pages Functions under `functions/api/`, file-routed. Every
handler calls `requireUser()` first (verifies the CF Access JWT), then `getDb(env)` for a D1
connection (a tagged-template SQL function over the `DB` binding).

| Endpoint | Methods | Reads / writes |
|---|---|---|
| `/api/projects` · `/api/projects/[slug]` | GET | projects (+ child goals on detail) |
| `/api/goals` · `/api/goals/[slug]` | GET | goals |
| `/api/situation` · `/api/situation/[slug]` | GET | situation feed (replaces the old tickets kanban) |
| `/api/spend` | GET | spend / usage feed |
| `/api/deployed-sites` · `/api/deployed-sites/[id]` | GET, POST, PATCH, DELETE | deployed-sites registry |
| `/api/move` · `/api/move/[id]` · `/api/move/agent` | GET, POST, PATCH | move tracker (+ Workers-AI NL agent) |
| `/api/rental` | GET | rental listings |
| `/api/agents` | GET | agents |
| `/api/memories` | GET | memories (ordered `created_at DESC`) |
| `/api/skills` · `/api/skills/[slug]` | GET, PUT | skills (detail editable) |
| `/api/portfolio` | GET | portfolio snapshot (see §6 note) |
| `/api/kb` · `/api/kb/[[catchall]]` | GET | page_content (KB docs) |
| `/api/meetings` · `/api/meetings/[id]` | GET, POST | meetings, transcript, actions |
| `/api/calendar` · `/calendar/events` | GET, POST | calendar connection + events |
| `/api/voice/ingest` | POST | ingests a voice clip (audio → R2; secret-gated, see §7) |
| `/api/voice/feed` · `/api/voice/ids` | GET | lists voice clips |
| `/api/voice/clip/[id]` | GET | resolves/streams a clip (audio in R2) |
| `/api/grants` | GET, POST | per-page guest grants (`page_grants` table) |
| `/api/me` | GET | identity + granted pages |
| `/api/settings` | GET, PATCH | user_settings blob |
| `/api/mcp-activity` | GET, POST | mcp_activity audit feed |
| `/api/sessions` | GET, POST | session registry |
| `/api/upload` | POST | writes asset to R2 (Bearer-gated) |
| `/api/version` | GET | build version string |

---

## 5. Database

> **Live store: Cloudflare D1 (SQLite).** The column types shown in the ER diagram below
> are the historical Neon/Postgres types (`uuid`, `jsonb`, `timestamptz`, `bytea`) from when
> the dashboard ran on Neon; under D1 the equivalents are SQLite types — `TEXT` ids, JSON
> stored as `TEXT`, ISO-string timestamps, and **voice audio in R2** rather than a `bytea`
> column. The live migrations are `sql/d1/NNN_description.sql` (latest `014_deployed_sites.sql`),
> not the root `sql/0NN_*.sql` Postgres files. The diagram is retained for the entity
> relationships, which carry over; treat the precise SQL types as historical.

The core domains: **brain** (projects/goals/agents/memories), **skills**, **meetings**,
**portfolio**, plus per-feature tables (situation, spend, move, rental, deployed-sites,
page_grants) and **platform** (settings/voice/KB/mcp-activity).

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

**Live (D1):** the numbered files in `sql/d1/` are applied in order with
`wrangler d1 execute mjd-yaron-db --remote --file=sql/d1/NNN_*.sql` — e.g.
`002_meetings_vexa` → `005_calendar` → `007_move_tasks` → `010_move_checklist` /
`010_rental_listings` → `011_spend` → `012_spend_usage` → `013_page_grants` →
`014_deployed_sites`.

*Historical (Neon/Postgres era — the frozen root `sql/0NN_*.sql` chain):*
`001_init` (platform) → `002_meetings` → `008_dashboard_brain` → `009_skills` →
`010_mcp_activity` → `011_projects_body` → `012_drift_fix` → `013_portfolio` →
`014_voice_audio` → `099_seed`. These are no longer the live migration path.

---

## 6. Data-flow: the read path

How a page renders, end to end:

```mermaid
sequenceDiagram
  participant U as Browser
  participant A as Cloudflare Access
  participant P as Pages (React SPA)
  participant F as Pages Function /api/*
  participant D as D1 (SQLite)

  U->>A: request dashboard
  A-->>U: Access session (signed JWT)
  U->>P: load SPA (static dist/)
  P->>F: fetch /api/<domain> (Cf-Access-Jwt-Assertion rides along)
  F->>F: requireUser() — verify JWT vs team JWKS (issuer+aud+sig), derive email, check allow-list/role
  F->>D: getDb(env) SELECT … (D1 binding)
  D-->>F: rows
  F-->>P: JSON
  P-->>U: render list/detail
```

> **Current-state note — Portfolio:** `portfolio_holdings`/`portfolio_fx` tables exist
> (`013_portfolio`), but `/api/portfolio` currently serves a **hardcoded `SEED[]` array
> embedded in the function**, not a `SELECT`. Swapping to the table is a known TODO. Every
> other domain reads its table live.

---

## 7. Data-flow: PAI → DB sync

> **Note:** this section describes the original sync (built 2026-06-01) that wrote into Neon
> via `DATABASE_URL`. The live store is now Cloudflare D1; the sync mechanics below are
> retained as historical Neon-era reference — the equivalent push for D1 uses
> `wrangler d1 execute` rather than a Neon HTTP connection.

The push-side ingestion that keeps the dashboard current with disk.

```mermaid
flowchart LR
  subgraph Sources["PAI disk (source of truth)"]
    P1["USER/PROJECTS/PROJECTS.md\n+ each PROJECT.md"]
    P2["USER/TELOS/GOALS.md"]
    P3["~/.config/myjarvis/agents/*.json"]
    P4["auto-memory/*.md\n(birth time = memory date)"]
  end
  TOOL["scripts/sync-from-pai.ts"]
  subgraph DbT["DB tables (live: D1)"]
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

- **Credential (historical):** the Neon-era sync used `DATABASE_URL` from env or a gitignored
  `.dev.vars`. The live D1 equivalent writes via `wrangler d1 execute`. **Model:** one-way,
  idempotent, non-destructive to dashboard-native rows (`life`, `update-telos`).
- **Not yet synced:** tickets (no PAI source — dashboard-native), skills, portfolio.
- **Not yet scheduled:** runs manually; next step is a launchd timer.

---

## 8. Data-flow: voice

```mermaid
flowchart LR
  KOKORO["pai-voice / agent\n(Kokoro MP3)"] -->|"POST /api/voice/ingest\n(secret-gated)"| ING["voice/ingest.ts"]
  ING -->|"audio bytes → R2 object"| R2[("R2: VOICE_BUCKET\nmjd-yaron-voice")]
  ING -->|"row (text + audio_url)"| VS[(voice clip rows in D1)]
  FEED["VoiceChannelProvider\n(polls every 5s)"] -->|"GET /api/voice/feed"| VS
  PLAYER["VoicePlayerInline"] -->|"audio_url = ${VOICE_PUBLIC_URL}/<id>.mp3"| R2
```

Voice **audio bytes live in R2** (`VOICE_BUCKET` → `mjd-yaron-voice`), served from the public
R2 URL `${VOICE_PUBLIC_URL}/<id>.mp3`; D1 holds the clip metadata rows (text + `audio_url`).
This replaced the old Neon `BYTEA` column. The frontend polls `/api/voice/feed` every 5
seconds and plays new clips inline.

---

## 9. Auth & security model

```mermaid
flowchart TD
  REQ["Request to /api/*"] --> JWT{"Verify Cf-Access-Jwt-Assertion\nvs team JWKS (issuer+aud+RS256 sig)?"}
  JWT -->|invalid / missing| R401["401 unauthorized"]
  JWT -->|valid| ALLOW{"email in allow-list?\n(owner / ACCESS_ALLOWED_EMAILS / page_grants)"}
  ALLOW -->|no| R401
  ALLOW -->|yes| OK["AuthedUser (role: admin | move) → handler / middleware grant check"]
  ING["/api/voice/ingest"] --> S1{"ingest secret matches?"}
  UP["/api/upload"] --> S2{"Bearer key matches?"}
```

- **Boundary:** Cloudflare Access fronts the dashboard and injects a signed
  `Cf-Access-Jwt-Assertion` (RS256) on every request that passes the Access policy.
  `requireUser()` (`functions/_lib/auth.ts`) **verifies that JWT** against the team JWKS —
  checking issuer + audience + signature via `jose` — and derives the email from the
  **verified claims**, never from the spoofable `Cf-Access-Authenticated-User-Email` header.
  Direct-to-origin requests (no valid assertion) fail closed with 401.
- **Authorization:** the verified email must be on the allow-list (owner +
  `ACCESS_ALLOWED_EMAILS` + D1 `page_grants` recipients). The owner gets `"all"`; every other
  user is deny-by-default and `_middleware.ts` scopes them to their granted pages'
  `/api/*` prefixes. `ACCESS_MOVE_ONLY_EMAILS` pins a user to the move tracker (role `move`).
- **Machine endpoints:** `/api/voice/ingest` and `/api/upload` are gated by their own shared
  secrets instead of Access, since they're called by Workers/agents rather than a browser.
- **✅ JWT verification is implemented** (this was previously a documented hardening gap —
  handlers used to trust the header; that gap is now closed by the JWKS signature check above).

### Bindings & vars (what the live code references)

| Name | Kind | Purpose |
|---|---|---|
| `DB` | D1 binding | SQLite database `mjd-yaron-db` |
| `VOICE_BUCKET` | R2 binding | voice-clip audio + uploaded assets |
| `AI` | Workers-AI binding | `/move` natural-language agent |
| `VOICE_PUBLIC_URL` | var | public R2 base for `audio_url` |
| `TENANT_OWNER_EMAIL` | var | owner identity (lockout-safe) |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | var | JWKS issuer base + Application Audience tag |
| `ACCESS_ALLOWED_EMAILS` / `ACCESS_MOVE_ONLY_EMAILS` / `ACCESS_GRANTS` | var | allow-list, move-only list, optional grant override |

> *Template carry-overs not used by the live code:* `DATABASE_URL` (Neon connection) and
> `WORKOS_CLIENT_SECRET` (real WorkOS). The live auth path is Cloudflare Access; the front end
> uses a local `workos-shim`, not the WorkOS SDK. (CF Pages secrets aren't visible from the
> repo, so this reflects code references, not the secret store.)

---

## 10. Deployment

```mermaid
flowchart LR
  EDIT["edit src/ or functions/"] --> GATE["npm run build (tsc + vite)"]
  GATE --> DIST["dist/ (Vite bundle)"]
  DIST --> DEPLOY["npm run deploy\n→ wrangler pages deploy dist (direct-upload)\n--project-name my-jarvis-dashboard-yaron"]
  DEPLOY --> LIVE["my-jarvis-dashboard-yaron.pages.dev\n(behind Cloudflare Access)"]
```

Deploy is **direct-upload** via `npm run deploy` — **`git push` does NOT deploy** — and uses
`node`/`npm` (bun hangs the wrangler upload). Build gate: `npm run build`
(`tsc --noEmit -p tsconfig.app.json && vite build`), with functions typechecked via
`tsc -p functions/tsconfig.json` (a failed deploy = user-facing outage). Data-only changes
(`wrangler d1 execute`) need **no** redeploy — Functions read D1 at request time.

---

## 11. Current state (what's live vs placeholder)

> Snapshot as of 2026-06-24 (post-D1 migration). The store is Cloudflare **D1** for every
> row below; verify exact sync freshness against the live DB.

| Domain | Store | Status |
|---|---|---|
| Projects / Goals / Agents / Memories | D1 (PAI-disk sync tool writes via `wrangler d1 execute`) | live; freshness depends on the last sync run |
| Situation | D1, dashboard-native | live — **replaced the old Tickets page** (no `tickets` key exists anymore) |
| Skills | D1 | seeded; automatic sync from `~/.claude/skills/` not wired |
| Portfolio / Spend | D1 via `/api/portfolio` + `/api/spend` | live pages |
| Knowledge Base / pitch docs | D1 `page_content` | live |
| Voice feed | D1 metadata + R2 audio (`/api/voice/feed`) | live; populates as agents ingest |
| Meetings | D1 (`meetings*`) | live; sidebar entry **ON** |
| Deployed Sites | D1 `deployed_sites` | live (added 2026-06-24) |

---

*Maintenance: regenerate this map when routes, tables, or the sync sources change. The
authoritative sources are `src/components/atomic-crm/root/CRM.tsx` (routes), the `sql/*.sql`
migrations (schema), and `functions/api/**` (endpoints).*
