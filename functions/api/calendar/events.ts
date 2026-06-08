import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env } from "../../_lib/auth";

type CalendarEventRow = {
  id: string;
  google_event_id: string;
  title: string;
  meeting_url: string | null;
  start_time: string;
  end_time: string;
  status: string;
  bot_id: string | null;
  dispatched_at: string | null;
  organizer_email: string | null;
};

/**
 * GET /api/calendar/events — upcoming + recent calendar events for this tenant
 *
 * Query: ?from=<iso>&to=<iso>&limit=<n>
 * Defaults: from = now - 1 hour, to = now + 7 days, limit = 100
 *
 * Reads directly from per-tenant Neon `calendar_events` table.
 * The worker keeps this table fresh via Google push notifications.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const url = new URL(request.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const limitRaw: string | null = url.searchParams.get("limit");

  const from = fromParam
    ? new Date(fromParam)
    : new Date(Date.now() - 60 * 60 * 1000);
  const to = toParam
    ? new Date(toParam)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const limitParsed: number = Number.parseInt(limitRaw ?? "", 10);
  const limit: number =
    !Number.isFinite(limitParsed) || limitParsed <= 0
      ? 100
      : Math.min(limitParsed, 1000);

  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) {
    return json({ error: "invalid from/to" }, { status: 400 });
  }

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      SELECT id, google_event_id, title, meeting_url,
             start_time, end_time, status, bot_id,
             dispatched_at, organizer_email
        FROM calendar_events
       WHERE start_time >= ${from.toISOString()}::timestamptz
         AND start_time <= ${to.toISOString()}::timestamptz
       ORDER BY start_time ASC
       LIMIT ${limit}
    `) as CalendarEventRow[];
    return json({ events: rows });
  } catch (err) {
    return json(
      {
        error: "calendar events fetch failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
};
