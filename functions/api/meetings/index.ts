import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../_lib/auth";
import { vexaConfigured, type VexaEnv } from "../../_lib/vexa";
import { maybeEndMeeting, type MeetingRow } from "../../_lib/meetings";

interface Env extends AuthEnv, VexaEnv {}

/** GET /api/meetings — list meetings, newest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const url = new URL(request.url);
  const limitRaw: string | null = url.searchParams.get("limit");
  const limitParsed: number = Number.parseInt(limitRaw ?? "", 10);
  const limit: number =
    !Number.isFinite(limitParsed) || limitParsed <= 0
      ? 500
      : Math.min(limitParsed, 1000);

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      SELECT id, title, meeting_url, platform, native_meeting_id, bot_id, status,
             summary, started_at, ended_at, created_at, last_error, error_status
        FROM meetings
       ORDER BY created_at DESC
       LIMIT ${limit}
    `) as MeetingRow[];

    // Self-heal stale 'live'/'starting' rows: if the Meet has ended (Vexa bot
    // gone), flip them here so just opening the list reflects reality without a
    // manual Stop. changed=false → maybeEndMeeting probes bot status. Bounded to
    // the few non-terminal rows; vendor errors leave status untouched.
    await Promise.all(
      rows.map(async (m) => {
        if (m.status === "live" || m.status === "starting") {
          m.status = await maybeEndMeeting(env, sql, m, false);
        }
      }),
    );

    return json({ meetings: rows, configured: vexaConfigured(env) });
  } catch (err) {
    return json(
      { error: "list failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};

/**
 * POST /api/meetings — RETIRED 2026-06-29.
 *
 * The Vexa recording engine has been archived in favour of the owned recorder
 * bot (Path 6 — pai-meeting-recorder, screenappai/meeting-bot on the Hetzner
 * box). This manual-create path no longer sends a Vexa bot; it returns 410. The
 * dashboard create + ingest flow is being rebuilt on top of the recorder bot
 * (slices 3–4). The GET above still serves meeting history. The previous Vexa
 * create implementation lives in git history (commit before this change) — to
 * restore Vexa, revert this file and re-enable the calendar-cron schedule.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  return json(
    {
      error: "retired",
      detail:
        "Vexa has been retired. Recording now runs on the owned recorder bot (Path 6); the dashboard trigger is being rebuilt on top of it.",
    },
    { status: 410 },
  );
};
