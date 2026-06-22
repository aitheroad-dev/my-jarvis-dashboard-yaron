import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../../_lib/auth";
import { googleConfigured, type GoogleEnv } from "../../../_lib/google";
import { getAccessToken, syncEvents, type CalEventRow } from "../../../_lib/calendar";

interface Env extends AuthEnv, GoogleEnv {}

/**
 * GET /api/calendar/events — upcoming Meet-bearing events with their auto-join
 * flag. Refreshes the D1 cache from Google on each view (best-effort), then
 * serves from D1 so a Google hiccup still shows the last-known list.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  if (!googleConfigured(env)) return json({ configured: false, connected: false, events: [] });

  const sql = getDb(env);
  const tok = await getAccessToken(env, sql);
  if (!tok.ok) {
    // Not connected, or the refresh token is stale/revoked → prompt reconnect.
    return json({ configured: true, connected: false, needsReconnect: tok.detail !== "not connected", events: [] });
  }

  await syncEvents(sql, tok.accessToken, Date.now());

  const events = (await sql/* sql */ `
    SELECT google_event_id, title, start_time, end_time, meeting_url, platform,
           native_meeting_id, auto_join, dispatched_meeting_id, language
      FROM calendar_events
     WHERE start_time >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 hour')
     ORDER BY start_time ASC
     LIMIT 100
  `) as CalEventRow[];

  return json({ configured: true, connected: true, events });
};
