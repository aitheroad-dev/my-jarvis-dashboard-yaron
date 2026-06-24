# my-jarvis-dashboard-yaron

Yaron's **live, single-tenant** MyJarvis dashboard — deployed to Cloudflare Pages at
`my-jarvis-dashboard-yaron.pages.dev`, behind Cloudflare Access. A long-diverged fork of
the multi-tenant MyJarvis template.

> **The multi-tenant template + provisioning system live elsewhere.** The
> `__TENANT__` / `__VOICE_PUBLIC_URL__` placeholder substitution and the per-tenant
> Provisioning Worker belong to the separate **`my-jarvis-dashboard-template`** repo.
> This fork has no remaining placeholders and is not provisioned per tenant.

---

## Stack

- **Frontend:** React 19 + Vite 7, Tailwind 4, `@radix-ui` primitives, react-router 7, `lucide-react`.
- **Backend:** Cloudflare Pages + Pages Functions (`functions/api/*`).
- **Database:** Cloudflare **D1 (SQLite)** — binding `DB`, database `mjd-yaron-db`. Access it via `getDb(env)` in `functions/_lib/db.ts`.
- **Media / voice:** Cloudflare **R2** (`VOICE_BUCKET`, bucket `mjd-yaron-voice`); audio served from `${VOICE_PUBLIC_URL}/<id>.mp3`.
- **AI:** Cloudflare **Workers AI** (`AI` binding) — powers the `/move` natural-language agent.
- **Auth:** Cloudflare **Access**. `functions/_lib/auth.ts` verifies the signed `Cf-Access-Jwt-Assertion` JWT (RS256) against the team JWKS and derives the user from the verified claims. A local `src/lib/workos-shim` keeps the front end's old auth call sites compiling; the real WorkOS SDK is no longer used by the live code.

## Local development

```bash
npm install
npm run dev        # Vite dev server
npm run typecheck  # tsc for src/ AND functions/
npm run lint       # ESLint (advisory)
npm run build      # tsc --noEmit -p tsconfig.app.json && vite build → dist/
npm run deploy     # build + wrangler pages deploy dist (direct-upload)
```

## Deploy

Deploy is **direct-upload**:

```bash
npm run deploy
# = npm run build && wrangler pages deploy dist \
#     --project-name my-jarvis-dashboard-yaron --branch main --commit-dirty=true
```

**`git push` does NOT deploy.** Use `node`/`npm` for the wrangler upload (bun hangs it).
Verify the result with the Interceptor skill (real Chrome) against the live URL.

## Database / migrations

All data lives in Cloudflare D1. Migrations are numbered files in `sql/d1/NNN_description.sql`:

```bash
wrangler d1 execute mjd-yaron-db --remote --file=sql/d1/NNN_description.sql
# read-only query:
wrangler d1 execute mjd-yaron-db --remote --command "SELECT 1"
```

See `sql/README.md` for the rules (TEXT identities, idempotent DDL, JSON-as-TEXT). The
root-level `sql/0NN_*.sql` files are frozen Postgres-era history.

## Known debt

- `scripts/smoke.mjs` still imports `@clerk/backend` from the dead Clerk era and is broken; the dashboard runs on Cloudflare Access now. Do not rely on `npm run smoke` until it's rewritten.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full wiring (pages, D1 schema,
data flow, auth model) and the repo [`CLAUDE.md`](CLAUDE.md) for the working conventions.
`docs/stack-notes.md` is retained as historical (template-era) reference only.

## Licence

See `LICENSE.md`.
