# MyJarvis Dashboard — Yaron's LIVE instance

This repo (`my-jarvis-dashboard-yaron`) is **Yaron's live, single-tenant MyJarvis
dashboard** — deployed to Cloudflare Pages at `my-jarvis-dashboard-yaron.pages.dev`,
gated by Cloudflare Access. It is NOT the template.

> **Looking for the multi-tenant template?** The provisioning machinery,
> placeholder substitution (`__TENANT__`, `__VOICE_PUBLIC_URL__`, `{{…}}`), and the
> per-tenant fork flow live in the **separate `my-jarvis-dashboard-template` repo**,
> not here. This instance is a long-since-diverged fork of that template; treat any
> "template" framing in older docs as historical lineage.

## Stack

- **Frontend:** React 19 + React Router v7 (`react-router-dom`) + Vite 7 + Tailwind v4 + `@radix-ui` primitives (individual `@radix-ui/react-*` packages — there is no `shadcn` dependency) + `lucide-react` icons. `@tanstack/react-query` is present but not the primary data pattern (pages mostly use a thin `useApi()` fetch + `useState`). UI styling uses inline-style design tokens — the `T` object in `src/components/atomic-crm/blueprint/ArchitectureBlocks.tsx`.
- **Backend:** Cloudflare **Pages Functions** (file-routed under `functions/api/`).
- **Database:** Cloudflare **D1 (SQLite)** — binding `DB`, database `mjd-yaron-db`. Query helper `getDb(env)` in `functions/_lib/db.ts` (D1-backed tagged-template SQL).
- **Media / voice:** Cloudflare **R2** — binding `VOICE_BUCKET`, bucket `mjd-yaron-voice`; public audio at `${VOICE_PUBLIC_URL}/<id>.mp3`.
- **AI:** Cloudflare **Workers AI** — binding `AI`, powers the `/move` natural-language agent (`functions/api/move/agent.ts`).
- **Auth:** Cloudflare **Access**. `functions/_lib/auth.ts` `requireUser()` verifies the signed `Cf-Access-Jwt-Assertion` JWT (RS256) against the team JWKS — issuer + audience + signature — and derives the email from the verified claims (never the spoofable `Cf-Access-Authenticated-User-Email` header).

## Environment bindings & vars

What the **live code** actually references (in `wrangler.toml` and `functions/_lib/auth.ts`):

| Name | Kind | Purpose |
|---|---|---|
| `DB` | D1 binding | The SQLite database (`mjd-yaron-db`). |
| `VOICE_BUCKET` | R2 binding | Voice-clip audio store (`mjd-yaron-voice`). |
| `AI` | Workers-AI binding | Powers the `/move` agent. |
| `VOICE_PUBLIC_URL` | var | Public R2 base; `audio_url = ${VOICE_PUBLIC_URL}/<id>.mp3`. |
| `TENANT_OWNER_EMAIL` | var | Owner identity (`aitheroad@gmail.com`); full, lockout-safe access. |
| `ACCESS_TEAM_DOMAIN` | var | CF Access team domain (issuer base for JWKS). |
| `ACCESS_AUD` | var | This app's Application Audience (AUD) tag. |
| `ACCESS_ALLOWED_EMAILS` | var | Comma-separated allow-list. |
| `ACCESS_MOVE_ONLY_EMAILS` | var | Emails restricted to the move tracker only (role `move`); owner force-excluded in code. |
| `ACCESS_GRANTS` | var (optional) | JSON override of per-page grants. |

Per-page guest access is stored in the D1 table `page_grants` (via `/api/grants`) and
enforced by `functions/_middleware.ts` using `PAGE_API_PREFIXES` from `functions/_lib/pages.ts`.
Owner → `"all"`; every other allow-listed user is deny-by-default.

**No longer used by this live instance's code** (template/Neon-era carry-overs — do not
rely on them, and note that we can't see CF Pages secrets from the repo): `DATABASE_URL`
(Neon), `WORKOS_CLIENT_SECRET` (real WorkOS), `TENANT_OWNER_USER_ID`, `OPENAI_API_KEY`,
`VOICE_API_KEY`. The front end imports a local `src/lib/workos-shim` (a single-tenant
drop-in that returns a fixed user and routes sign-out to `/cdn-cgi/access/logout`); the
real `@workos-inc/authkit-react` SDK is still a dependency but is no longer used by the
live auth path — the network-layer Cloudflare Access gate replaced it.

## SQL — D1 migrations

Schema and data live in Cloudflare D1. Migrations are numbered files in `sql/d1/NNN_description.sql`,
applied with:

```bash
wrangler d1 execute mjd-yaron-db --remote --file=sql/d1/NNN_description.sql
```

(use `--local` to target the dev DB). The latest is `sql/d1/014_deployed_sites.sql`. SQLite
stores JSON as TEXT — store JSON strings (`json(...)`), never Postgres `::jsonb`. The
root-level `sql/0NN_*.sql` files are frozen Neon/Postgres-era history (see `sql/README.md`).

## Deploy & build gate

Deploy is **direct-upload**:

```bash
npm run deploy
# = npm run build && wrangler pages deploy dist \
#     --project-name my-jarvis-dashboard-yaron --branch main --commit-dirty=true
```

**`git push` does NOT deploy.** Use `node`/`npm` for the wrangler upload (bun hangs it).
Data-only changes (a `wrangler d1 execute`) need no redeploy — Functions read D1 at request time.

Build gate before deploy:

- `npm run build` = `tsc --noEmit -p tsconfig.app.json && vite build`.
- Functions are typechecked separately: `tsc --noEmit -p functions/tsconfig.json` (run `npm run typecheck` for both).
- `npm run lint` (ESLint over `src/**` + `functions/**`) is advisory.

A broken upload is a user-facing outage — never deploy on a red build.

Verify every deploy with the **Interceptor** skill (real Chrome) against the live URL.

## Pages (15)

The dashboard exposes 15 grantable pages. The page set is defined in `src/lib/page-keys.ts`
(client) and `functions/_lib/pages.ts` (server) — they must stay in sync — rendered from the
`PAGES` manifest in `src/lib/pages.tsx` (via `src/components/atomic-crm/root/CRM.tsx`) with
sidebar entries in `src/components/atomic-crm/layout/nav-items.tsx` and labels in
`SettingsPage.tsx`.

| Key | Sidebar label | Route |
|---|---|---|
| `home` | Home | `/home` |
| `goals` | Goals | `/goals-list` (+ `/goals/:slug`) |
| `projects` | Projects | `/projects-list` (+ `/projects/:slug`) |
| `portfolio` | Portfolio | `/portfolio` |
| `spend` | Spend | `/spend` |
| `deployed-sites` | Sites | `/deployed-sites` |
| `move` | מעבר דירה (Move) | `/move` |
| `rental` | Rental | `/rental` |
| `situation` | Situation | `/situation` |
| `agents` | Agents | `/agents` |
| `skills` | Skills | `/skills` (+ `/skills/:slug`) |
| `memory` | Memory | `/memory` |
| `knowledge-base` | Knowledge Base | `/knowledge-base` (+ `/kb-doc/*`) |
| `meetings` | Meetings | `/meetings` (+ `/meetings/:id`) |
| `tools` | Tools | `/tools` |

- **"Tickets" was removed and replaced by "Situation"** — there is no `tickets` page key, route, or API anywhere in the live code.
- **Meetings is ON in the sidebar** (a normal `navItems` entry).
- Owner-only chrome routes outside the grantable set: `/` (redirect) and `/settings`.

To add a page, register the key in `page-keys.ts` AND `functions/_lib/pages.ts` (+ a
`PAGE_API_PREFIXES` entry), add the `PAGE_LABELS` entry in `SettingsPage.tsx`, add the route
to the `PAGES` manifest in `pages.tsx`, add the sidebar entry in `nav-items.tsx`, and add the
handler at `functions/api/<name>/index.ts`. See the `myjarvis-dashboard` skill for the full recipe.

**Every page must be mobile + desktop ready — hard gate.** New or changed pages must
follow `docs/MOBILE_READY_STANDARD.md`: list data renders through `SortableTable` (auto
stacked-cards on mobile), custom rows use a `useIsMobile()` stacked-card branch, page
padding/headings are fluid (`clamp()`), and the page is verified at 390px before deploy.
Do not hand-roll a fixed-column `<table>`/grid as the only layout — that breaks on phones.

## Known debt

- `scripts/smoke.mjs` still imports `@clerk/backend` from the long-dead Clerk era. The dashboard runs on Cloudflare Access now, so this smoke test is broken — do not rely on `npm run smoke` until it's rewritten.

---

## Template lineage — not used by this live instance

Older docs in this repo describe a multi-tenant **template** that the Provisioning Worker
forked per tenant, substituting `__TENANT__` / `__VOICE_PUBLIC_URL__` placeholders and
provisioning a per-tenant Neon project + WorkOS AuthKit + a shared voice-channel Durable
Object. **None of that applies to this live single-tenant fork** — there are no remaining
placeholders to substitute, no Neon, and no real WorkOS in the live path. For the actual
template + provisioning system, see the separate `my-jarvis-dashboard-template` repo.
