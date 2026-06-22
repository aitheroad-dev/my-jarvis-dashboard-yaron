import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../../_lib/db";
import { json, requireUser, type Env } from "../../../_lib/auth";

/**
 * POST /api/calendar/events/:gid — update one event's auto-join opt-in and/or
 * transcription language. Body: { auto_join?: boolean, language?: 'he'|'en'|'auto' }.
 * language 'auto' (or omitted/unknown) stores NULL = Vexa auto-detect.
 * Either field may be sent independently.
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

  let body: { auto_join?: unknown; language?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const hasAutoJoin = typeof body.auto_join === "boolean";
  const hasLanguage = typeof body.language === "string";
  if (!hasAutoJoin && !hasLanguage) {
    return json({ error: "nothing to update" }, { status: 400 });
  }

  const sql = getDb(env);
  if (hasAutoJoin) {
    const on = body.auto_join === true ? 1 : 0;
    await sql/* sql */ `UPDATE calendar_events SET auto_join = ${on} WHERE google_event_id = ${gid}`;
  }
  if (hasLanguage) {
    // Only 'he'/'en' force a language; anything else (incl. 'auto') → NULL.
    const raw = (body.language as string).toLowerCase();
    const lang = raw === "he" || raw === "en" ? raw : null;
    await sql/* sql */ `UPDATE calendar_events SET language = ${lang} WHERE google_event_id = ${gid}`;
  }

  const rows = (await sql/* sql */ `
    SELECT google_event_id, auto_join, language FROM calendar_events WHERE google_event_id = ${gid}
  `) as { google_event_id: string; auto_join: number; language: string | null }[];
  if (!rows[0]) return json({ error: "event not found" }, { status: 404 });
  return json({ ok: true, auto_join: rows[0].auto_join, language: rows[0].language });
};
