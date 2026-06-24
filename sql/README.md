# sql/ — database schema & migrations

> **Live store: Cloudflare D1 (SQLite).** The live migrations are in
> [`sql/d1/`](./d1/). The root-level `0NN_*.sql` files (`001_init.sql`,
> `008_dashboard_brain.sql`, `099_seed.sql`, …) and any `psql` / Neon /
> `DATABASE_URL` instructions are **template/Neon-era history** — kept for
> reference, not applied to the live dashboard.

## Live migrations — `sql/d1/NNN_description.sql`

Yaron's `my-jarvis-dashboard-yaron` instance stores all data in a Cloudflare D1
database, `mjd-yaron-db` (declared in `wrangler.toml` under `[[d1_databases]]`,
binding `DB`). Schema and data migrations live in `sql/d1/`, numbered in apply
order. Apply one against the live (remote) database with:

```bash
wrangler d1 execute mjd-yaron-db --remote --file=sql/d1/NNN_description.sql
```

Use `--local` instead of `--remote` to target the local dev database. The latest
migration is `sql/d1/014_deployed_sites.sql`. Others include `002_meetings_vexa`,
`005_calendar`, `007_move_tasks`, `011_spend`, `012_spend_usage`, and
`013_page_grants` (the per-page guest-grant table).

Read a quick query without a file:

```bash
wrangler d1 execute mjd-yaron-db --remote --command "SELECT * FROM projects LIMIT 5"
```

## Hard rules (still apply — SQLite/D1)

1. **`user_id` / identity columns are `TEXT`, never `UUID`.** Cloudflare Access
   identities are email strings, not UUIDs, and SQLite has no native UUID type.
   Bind identity values as text.
2. **Everything idempotent.** `CREATE TABLE IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN` guarded for re-run,
   etc. Migrations may be re-applied; a non-idempotent statement breaks re-runs.
3. **JSON is stored as `TEXT`.** SQLite has no `jsonb`. Store
   `JSON.stringify(x)` (or use `json(...)`), and `JSON.parse` on read. The
   `getDb()` helper in `functions/_lib/db.ts` JSON-encodes object/array binds
   automatically.

---

## Template lineage (historical — not the live store)

The multi-tenant `my-jarvis-dashboard-template` repo provisioned a per-tenant
**Neon Postgres** project and applied `sql/001_init.sql` (and friends) via `psql`
using a `DATABASE_URL` connection string. That model — and the `sql/tenant/<slug>.sql`
per-tenant content convention — belongs to the template repo, not to this live
single-tenant fork. The root `0NN_*.sql` files here are the frozen Postgres-era
schema; the live D1 migrations in `sql/d1/` superseded them.
