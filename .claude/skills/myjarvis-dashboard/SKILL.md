---
name: myjarvis-dashboard
description: Update the MyJarvis dashboard — read data, write data, edit layout. Use whenever asked to add a page, edit a page, change the sidebar, fix the dashboard, query the database, write a knowledge base entry, or anything that touches the user's MyJarvis dashboard. Triggered by — "dashboard", "add a page", "edit a page", "sidebar", "knowledge base", "kb page", "query the data", "update my dashboard".
---

# MyJarvis Dashboard

Yaron's MyJarvis dashboard (`my-jarvis-dashboard-yaron`, live at
`my-jarvis-dashboard-yaron.pages.dev`) is a React SPA on **Cloudflare Pages** with
**Cloudflare Pages Functions** for the API, **Cloudflare D1 (SQLite)** for data,
**R2** for voice audio, and **Cloudflare Access** for auth. **Layout is in code
(TSX). Data is in D1.** You manage both with **local file edits + `npm` + `wrangler`**
— ordinary git/shell workflow, no special MCP required.

## The whole job — three operations

| Goal | How |
|---|---|
| **Read data** | `wrangler d1 execute mjd-yaron-db --remote --command "SELECT …"` (read-only; use `--local` for the dev DB). |
| **Write data / change schema** | Add a numbered migration `sql/d1/NNN_description.sql`, then `wrangler d1 execute mjd-yaron-db --remote --file=sql/d1/NNN_description.sql`. SQLite stores JSON as TEXT — store a JSON string (or `json(...)`), never Postgres `::jsonb`. |
| **Edit layout / API** | Edit the local TSX / functions files, then `npm run build && npm run deploy` (direct-upload). Verify the deploy with the **Interceptor** skill (real Chrome) against `my-jarvis-dashboard-yaron.pages.dev`. |

Deploy is **direct-upload** — `npm run deploy` runs `npm run build && wrangler pages deploy dist …`. **`git push` does NOT deploy.** Use `node`/`npm` for the wrangler upload (bun hangs it).

## Where things live in the code

```
src/lib/page-keys.ts              # client PageKey union + ALL_PAGE_KEYS
src/lib/pages.tsx                 # PAGES manifest — route → element for every page
src/components/atomic-crm/
├── root/CRM.tsx                  # renders the PAGES manifest (owner: all; guest: granted subset). NOT hand-edited per page.
├── layout/nav-items.tsx          # sidebar entries (navItems), keyed by PageKey
├── layout/CrmSidebar.tsx         # consumes navItems
├── pages/SettingsPage.tsx        # PAGE_LABELS map + page-sharing UI
├── <domain>/<Name>Page.tsx       # one TSX page per dashboard domain
└── blueprint/KbBlueprintPage.tsx # generic renderer for page_content (KB docs)
functions/
├── _lib/db.ts                    # getDb(env) — D1 tagged-template SQL
├── _lib/auth.ts                  # requireUser() — verifies the CF Access JWT
├── _lib/pages.ts                 # server PageKey union + PAGE_API_PREFIXES (grant authority)
└── api/<name>/index.ts           # one handler dir per endpoint (+ [id].ts / [slug].ts)
```

## Where things live in the data (D1)

| Table | What |
|---|---|
| `page_content` (JSON-as-TEXT) | Long-form KB pages rendered by `KbBlueprintPage`. One row per slug. |
| `page_grants` | Per-page guest access (email → page_key); drives `/api/grants` + `_middleware.ts`. |
| `<domain tables>` | Typed data (`projects`, `goals`, `agents`, `memories`, `meetings`, `spend`, `move_*`, `deployed_sites`, …). Read in TSX via the matching `/api/<domain>` endpoint. |

## Recipes

### Read data

```bash
wrangler d1 execute mjd-yaron-db --remote --command \
  "SELECT slug, name FROM projects ORDER BY updated_at DESC LIMIT 10"
```

### Add or edit knowledge base content

Write a migration that upserts into `page_content`, then apply it:

```sql
-- sql/d1/0NN_kb_my_new_page.sql
INSERT INTO page_content (page_slug, content) VALUES
  ('my-new-page', json('{"sections":[{"type":"markdown","body":"…"}]}'))
ON CONFLICT (page_slug) DO UPDATE SET content = excluded.content;
```

```bash
wrangler d1 execute mjd-yaron-db --remote --file=sql/d1/0NN_kb_my_new_page.sql
```

### Add a new page (full slice)

A page key must be registered in **both** the client and server vocabularies, plus
the manifest, labels, sidebar, and an API handler:

1. `src/lib/page-keys.ts` — add the key to the `PageKey` union + `ALL_PAGE_KEYS`.
2. `functions/_lib/pages.ts` — add the same key to the `PageKey` union + `ALL_PAGE_KEYS`, and a `PAGE_API_PREFIXES` entry (the `/api/*` prefixes the page may reach).
3. `src/components/atomic-crm/pages/SettingsPage.tsx` — add the `PAGE_LABELS` entry.
4. `src/lib/pages.tsx` — add the `{ key, routes: [...] }` entry to the `PAGES` manifest (CRM.tsx renders it; you do NOT edit CRM.tsx).
5. `src/components/atomic-crm/layout/nav-items.tsx` — add the sidebar `navItems` entry (icon from `lucide-react`).
6. `functions/api/<name>/index.ts` — add the API handler (+ `[id].ts`/`[slug].ts` for item routes).
7. **Make it mobile + desktop ready — mandatory.** Follow `docs/MOBILE_READY_STANDARD.md`: list data goes through `SortableTable` (auto stacked-cards on mobile); custom rows get a `useIsMobile()` stacked-card branch (title full-width with `overflowWrap: "anywhere"`, actions on their own row); page padding/headings use `clamp()`. Never ship a fixed-column `<table>`/grid as the only layout.

Then `npm run build && npm run deploy`, and verify with Interceptor — **including at 390px width** (per the standard's verification gate).

### Change a sidebar entry / share a page

Sidebar label/order: edit `nav-items.tsx`. Guest sharing: insert a row into the D1
`page_grants` table (or use the Settings page-sharing UI) — `_middleware.ts` derives
the allow/deny from `PAGE_API_PREFIXES`. Owner always sees `"all"`.

## Build gate — what to do when it fails

`npm run build` = `tsc --noEmit -p tsconfig.app.json && vite build`; functions are
typechecked separately via `tsc -p functions/tsconfig.json` (run `npm run typecheck`
for both). Lint (`npm run lint`) is advisory. If the build fails, fix the TS/Vite
error locally and rebuild — never `npm run deploy` on a red build (a broken upload is
a user-facing outage). There is no remote preview branch; deploy is direct-upload, so
the gate is your local build.

## Legacy MCP flow (pre-D1)

The old MyJarvis MCP tools (`query_db` / `apply_migration` / `push_files` / `ship`)
**predate the D1 migration** — they were built for the Neon-Postgres era. Prefer the
local-files + `wrangler d1 execute` + `npm run deploy` flow above. If you do reach for
the MCP tools, verify they actually target this D1 database before relying on them.

## What this skill does NOT cover

- **Voice, provisioning** — separate skills/tools.
- **Atomic-CRM upstream conventions** (ra-core forms, `@radix-ui` primitives) — see `frontend-dev` in the same repo.
- **Design vocabulary** (Studio vs Editorial typography, ColorBlocks, etc.) — separate skill.
