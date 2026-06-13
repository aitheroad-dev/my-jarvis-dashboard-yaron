import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../../_lib/db";
import { json, requireUser, type Env } from "../../../_lib/auth";

/**
 * POST /api/calendar/events/:gid — toggle the auto-join opt-in for one event.
 * Body: { auto_join: boolean }.
 */
export const onRequestPost: PagesFunction<Env, "gid"> = async ({ request, env, params }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  const gid = typeof params.gid === "string" ? params.gid : Array.isArray(params.gid) ? params.gid[0] : "";
  if (!gid) return json({ error: "missing event id" }, { status: 400 });

  let body: { auto_join?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }
  const on = body.auto_join === true ? 1 : 0;

  const sql = getDb(env);
  const updated = (await sql/* sql */ `
    UPDATE calendar_events SET auto_join = ${on} WHERE google_event_id = ${gid}
    RETURNING google_event_id, auto_join
  `) as { google_event_id: string; auto_join: number }[];
  if (!updated[0]) return json({ error: "event not found" }, { status: 404 });
  return json({ ok: true, auto_join: updated[0].auto_join });
};
