# Stack Notes — Cloudflare Pages + Neon + WorkOS AuthKit

> **⚠️ HISTORICAL — TEMPLATE ERA.** This file documents the original
> **template-era stack: Neon Postgres + WorkOS AuthKit** (the multi-tenant
> `my-jarvis-dashboard-template` lineage). Yaron's **live** `my-jarvis-dashboard-yaron`
> fork no longer uses any of it. The live stack is **Cloudflare D1 (SQLite) +
> Cloudflare R2 + Cloudflare Access** — no Neon, no real WorkOS (a local
> `src/lib/workos-shim` keeps the old call sites compiling). For the current
> architecture see `docs/ARCHITECTURE.md` and the repo `CLAUDE.md`. Everything
> below is kept as historical reference only.

First-client-on-this-stack notes. The goal is: second client takes 30 minutes, not 4 hours.

Auth switched from Clerk to WorkOS AuthKit so the dashboard and the MyJarvis MCP Worker share a single identity provider — one sign-in covers both surfaces.

## Architecture (one picture)

```
[browser]
   │   (WorkOS access token, refreshed in-memory by authkit-react)
   ▼
[my-jarvis-dashboard-<client>.pages.dev]
   │   ├── static SPA (Vite build of src/)
   │   └── /api/* → Cloudflare Pages Functions (from ./functions/)
   │
   └── functions/api/clients, functions/api/sessions
         │   jwtVerify(jwt, WorkOS JWKS) via `jose`
         │   sql = neon(DATABASE_URL)
         ▼
     [Neon Postgres] (HTTP driver, no pooling)
```

## Pieces

### Frontend

- **`src/App.tsx`** — wraps the app in `<AuthKitProvider clientId={…}>`. Inner `<AuthGate>` reads `useAuth()` and renders either a Hebrew sign-in card (unauthenticated) or the full CRM (authenticated). The AuthKit SDK handles the OAuth PKCE redirect internally — no custom callback route needed.
- **`src/lib/api.ts`** — `useApi()` hook returning an authed `fetch`. It pulls the current access token via `useAuth().getAccessToken()` and injects `Authorization: Bearer <jwt>`. Every protected API call uses this.
- **`src/components/atomic-crm/pages/*`** — six React pages, plain React, no ra-core. Hebrew RTL layout.

### Backend (Pages Functions)

- **`functions/_lib/auth.ts`** — `requireUser(request, env)` verifies the incoming Bearer JWT via `jose`'s `jwtVerify` against WorkOS's JWKS endpoint (`https://api.workos.com/sso/jwks/<client_id>`). `jose` handles JWKS caching + key rotation. Throws a 401 Response on failure.
- **`functions/_lib/db.ts`** — `getDb(env)` returns a tagged-template SQL fn from `@neondatabase/serverless`'s `neon(url)`. Each request gets a fresh, short-lived HTTP connection; Neon handles pooling server-side.
- **`functions/api/clients/index.ts`**, **`functions/api/sessions/index.ts`** — exports `onRequestGet` and `onRequestPost`. Each handler calls `requireUser` first, then `getDb` + query.

### Deploy

- **`wrangler.toml`** at the repo root (Pages convention).
  - `pages_build_output_dir = "dist"` — Vite output dir, served as static SPA.
  - `compatibility_flags = ["nodejs_compat"]` — kept for Neon serverless driver.
  - `[vars] WORKOS_CLIENT_ID` — public client ID, committed. Pages Functions read it at runtime.
- **Secrets**:
  ```
  wrangler pages secret put DATABASE_URL --project-name my-jarvis-dashboard-<client>
  ```
- **Public env** (baked into build, committed in `.env`):
  - `VITE_WORKOS_CLIENT_ID=client_01...` — exactly the same ID as the MCP Worker uses. Same WorkOS tenant means the workos.com session cookie bridges dashboard sign-in to MCP OAuth silently.
- **Deploy command**:
  ```
  npm run build
  wrangler pages deploy dist --project-name my-jarvis-dashboard-<client>
  ```

### Neon

- Project provisioned via Neon console (region `aws-eu-central-1`, Postgres 17).
- Schema lives in `sql/001_init.sql`, idempotent (`IF NOT EXISTS` everywhere). Apply:
  ```
  psql "$NEON_DATABASE_URL" -f sql/001_init.sql
  ```
- Neon connection string uses the **pooled** endpoint (`-pooler` host). The `@neondatabase/serverless` HTTP driver works with either — the pooler is safe.

### WorkOS AuthKit

- Shared staging WorkOS tenant for now. Client ID: `client_01KPRK1S863QSD94SK99FKZV0Y`. Same tenant as the MCP Worker at `my-jarvis-mcp.myjarvis.workers.dev`. One sign-in → WorkOS session cookie → recognized by both the dashboard and the MCP OAuth flow (silent consent or a one-time approval dialog for each client).
- Frontend uses `@workos-inc/authkit-react` v0.16+. Pure client-side PKCE flow — the SDK intercepts `?code=…` on the redirect URI, exchanges for tokens, and stores them (localStorage in dev, refresh-token cookie in prod).
- Backend verification uses `jose` `jwtVerify` against the WorkOS JWKS endpoint. First call fetches JWKS (~50-100ms); subsequent calls use the in-memory cache. No DB lookup. No Clerk-style REST roundtrip.
- **WorkOS Dashboard configuration required** (one-time, per deployed origin):
  1. Add the Pages origin (e.g. `https://my-jarvis-dashboard-<client>.pages.dev`) to **Allowed Origins** on the Authentication page.
  2. Add the same origin to **Redirect URIs** on the Redirects page — that's where AuthKit sends users back after sign-in.
  3. Optional: add `http://localhost:5173` to both for local dev.

## Pitfalls hit

1. **Pages Functions cannot import from `src/`.** The `functions/` tree is its own TypeScript project (own `tsconfig.json`) and is built/deployed separately from the Vite SPA. Never add `@/*` path aliases here — use relative paths like `../_lib/auth`.

2. **`nodejs_compat` is still required for Neon.** The Neon serverless HTTP driver needs Node Buffer shims. Keep the flag set in `wrangler.toml`.

3. **WorkOS access token ≠ WorkOS API key.** The frontend sends a short-lived access token via `getAccessToken()` — that token is verified server-side via JWKS. The **API key** (starts with `sk_test_...` or `sk_live_...`) is server-only and not used by this dashboard's Pages Functions (only the Node-side MCP Worker uses it).

4. **Neon pooled vs. direct endpoint.** Use the pooler URL (`-pooler` in the host) for serverless — direct connections from Workers will exhaust quickly under burst load.

5. **Tagged-template SQL uses `${value}::type` for casts.** `sql\`INSERT ... VALUES (${clientId}::uuid)\`` binds `clientId` as text then casts — safer than interpolating a raw string.

6. **Hebrew RTL — set `dir="rtl"` on `<html>` in `index.html`.** Setting it only on `<body>` or on a div causes the AuthKit hosted page to render LTR anyway. Pair with `lang="he"` for screen readers.

7. **HashRouter + OAuth PKCE.** The dashboard uses `HashRouter` (`#/clients`, `#/session`, etc.). AuthKit's SDK handles its own `?code=…&state=…` query params at the root, independently of the hash. They don't collide.

## Recipe for client #2

1. Provision Neon project: `curl -XPOST https://console.neon.tech/api/v2/projects ...` with the client name.
2. (If the client gets their own WorkOS tenant) create a new WorkOS project in the WorkOS dashboard. Otherwise reuse the shared staging tenant.
3. Fork this repo → new GitHub repo named `my-jarvis-dashboard-<client>`.
4. Create Cloudflare Pages project with the new name.
5. Save credentials in `integrations/<client>-stack` following the template in `integrations/lilach-stack`.
6. Set wrangler secrets (`DATABASE_URL`). WorkOS client ID goes in `wrangler.toml` under `[vars]` — it's not secret.
7. Update `.env` with the new `VITE_WORKOS_CLIENT_ID`.
8. In the WorkOS dashboard, add the new Pages origin to Allowed Origins + Redirect URIs.
9. `psql "$DATABASE_URL" -f sql/001_init.sql`.
10. `npm i && npm run build && wrangler pages deploy dist --project-name my-jarvis-dashboard-<client>`.

~30 minutes once all five integrations are provisioned.
