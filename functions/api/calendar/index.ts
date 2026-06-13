import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../_lib/auth";
import { googleConfigured, type GoogleEnv } from "../../_lib/google";
import { getConnection } from "../../_lib/calendar";

interface Env extends AuthEnv, GoogleEnv {}

/** GET /api/calendar — connection status. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  if (!googleConfigured(env)) return json({ configured: false, connected: false });
  const sql = getDb(env);
  const conn = await getConnection(sql);
  return json({
    configured: true,
    connected: Boolean(conn?.google_email),
    email: conn?.google_email ?? null,
  });
};

/** POST /api/calendar — disconnect (forget the connection; transcripts kept). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  const sql = getDb(env);
  await sql/* sql */ `DELETE FROM calendar_connection WHERE id = 1`;
  return json({ ok: true });
};
