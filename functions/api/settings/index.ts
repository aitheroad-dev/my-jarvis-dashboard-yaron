import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type SettingsRow = { data: string | null };

/**
 * GET /api/settings
 *
 * Returns { data } — the authed user's settings blob. First call for a
 * user (no row yet) returns an empty object; we only INSERT on PATCH.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  let auth;
  try {
    auth = await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      SELECT data FROM user_settings WHERE user_id = ${auth.userId}
    `) as SettingsRow[];
    const data = rows[0]?.data ? JSON.parse(rows[0].data as string) : {};
    return json({ data });
  } catch (err) {
    return json(
      {
        error: "settings fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};

/**
 * PATCH /api/settings
 *
 * Body: partial JSON object. Shallow-merged into the user's existing
 * settings blob via SQLite json_patch(). Upserts on first write.
 * Returns the full merged object so the client can resync its cache.
 */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  let auth;
  try {
    auth = await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  let patch: Record<string, unknown>;
  try {
    const raw = (await request.json()) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return json({ error: "body must be a JSON object" }, { status: 400 });
    }
    patch = raw as Record<string, unknown>;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      INSERT INTO user_settings (user_id, data, updated_at)
      VALUES (${auth.userId}, ${JSON.stringify(patch)}, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      ON CONFLICT (user_id) DO UPDATE
        SET data = json_patch(user_settings.data, ${JSON.stringify(patch)}),
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      RETURNING data
    `) as SettingsRow[];
    const data = rows[0]?.data ? JSON.parse(rows[0].data as string) : {};
    return json({ data });
  } catch (err) {
    return json(
      {
        error: "settings update failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
