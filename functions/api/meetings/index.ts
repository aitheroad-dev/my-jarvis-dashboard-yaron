import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../_lib/auth";
import { createBot, vexaConfigured, type VexaEnv } from "../../_lib/vexa";
import { parseMeetingUrl, redactMeetingUrl } from "../../_lib/meeting-url";

interface Env extends AuthEnv, VexaEnv {}

type MeetingRow = {
  id: number;
  title: string;
  meeting_url: string;
  platform: string | null;
  native_meeting_id: string | null;
  bot_id: string | null;
  status: string;
  summary: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

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
             summary, started_at, ended_at, created_at
        FROM meetings
       ORDER BY created_at DESC
       LIMIT ${limit}
    `) as MeetingRow[];
    return json({ meetings: rows, configured: vexaConfigured(env) });
  } catch (err) {
    return json(
      { error: "list failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};

/**
 * POST /api/meetings — create a meeting and send the Vexa bot into it.
 * Body: { title, meeting_url, language?, passcode? }.
 * INSERT row → POST Vexa /bots → UPDATE row with bot ref. On vendor failure
 * the row is kept in 'failed' status (partial state beats missing state).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  let body: { title?: unknown; meeting_url?: unknown; language?: unknown; passcode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const meetingUrl =
    typeof body.meeting_url === "string" ? body.meeting_url.trim() : "";
  const language =
    typeof body.language === "string" && body.language.trim().length > 0
      ? body.language.trim()
      : "he";
  const bodyPasscode =
    typeof body.passcode === "string" && body.passcode.trim().length > 0
      ? body.passcode.trim()
      : undefined;

  if (!title) return json({ error: "title is required" }, { status: 400 });
  if (!meetingUrl) return json({ error: "meeting_url is required" }, { status: 400 });

  const parsed = parseMeetingUrl(meetingUrl);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

  if (!vexaConfigured(env)) {
    return json(
      {
        error: "not configured",
        detail:
          "VEXA_API_KEY is not set on this deployment — add it as a Pages secret to enable meeting bots.",
      },
      { status: 500 },
    );
  }

  const sql = getDb(env);

  // Idempotency: one bot per meeting. A double-click or retry must not send
  // a second notetaker into the same call.
  const existing = (await sql/* sql */ `
    SELECT id FROM meetings
     WHERE platform = ${parsed.platform}
       AND native_meeting_id = ${parsed.nativeMeetingId}
       AND status IN ('live','starting')
     LIMIT 1
  `) as { id: number }[];
  if (existing[0]) {
    return json(
      { error: "a bot is already in this meeting", meeting_id: existing[0].id },
      { status: 409 },
    );
  }

  let inserted: MeetingRow;
  try {
    const rows = (await sql/* sql */ `
      INSERT INTO meetings (title, meeting_url, platform, native_meeting_id, status, started_at)
      VALUES (${title}, ${redactMeetingUrl(meetingUrl)}, ${parsed.platform}, ${parsed.nativeMeetingId},
              'starting', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      RETURNING id, title, meeting_url, platform, native_meeting_id, bot_id, status,
                summary, started_at, ended_at, created_at
    `) as MeetingRow[];
    if (!rows[0]) throw new Error("insert returned no row");
    inserted = rows[0];
  } catch (err) {
    return json(
      { error: "db insert failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const bot = await createBot(env, {
    platform: parsed.platform,
    nativeMeetingId: parsed.nativeMeetingId,
    // 'auto' = omit the field; Vexa then language-detects per segment.
    language: language === "auto" ? undefined : language,
    passcode: parsed.passcode ?? bodyPasscode,
    botName: "Notetaker",
  });

  if (!bot.ok) {
    await sql/* sql */ `UPDATE meetings SET status = 'failed' WHERE id = ${inserted.id}`;
    return json(
      {
        error: "bot create failed",
        status: bot.status,
        detail: bot.detail,
        meeting_id: inserted.id,
      },
      { status: 502 },
    );
  }

  const botRef = bot.data?.id != null ? String(bot.data.id) : parsed.nativeMeetingId;
  const updated = (await sql/* sql */ `
    UPDATE meetings
       SET bot_id = ${botRef}, status = 'live'
     WHERE id = ${inserted.id}
   RETURNING id, title, meeting_url, platform, native_meeting_id, bot_id, status,
             summary, started_at, ended_at, created_at
  `) as MeetingRow[];

  return json({ meeting: updated[0] ?? { ...inserted, bot_id: botRef, status: "live" } });
};
