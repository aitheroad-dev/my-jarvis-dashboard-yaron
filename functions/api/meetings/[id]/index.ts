import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../../_lib/auth";
import { type MeetingRow } from "../../../_lib/meetings";

type Env = AuthEnv;

type SegmentRow = {
  id: number;
  speaker_name: string | null;
  is_host: boolean | null;
  words: string;
  start_ts: string | null;
  end_ts: string | null;
  event_type: string | null;
  created_at: string;
};

function parseId(params: { id?: string | string[] }): number | null {
  const idRaw = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const id = Number(idRaw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * GET /api/meetings/:id — meeting + transcript, served purely from D1.
 *
 * Vexa is retired: the owned box recorder owns the lifecycle (poller →
 * 'starting'; completion webhook → transcript + 'ended'; box sweep fails stale
 * rows). So this no longer polls any vendor — it's a straight read.
 */
export const onRequestGet: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const id = parseId(params);
  if (id === null) return json({ error: "invalid id" }, { status: 400 });

  try {
    const sql = getDb(env);
    const meetings = (await sql/* sql */ `
      SELECT id, title, meeting_url, platform, native_meeting_id, bot_id, status,
             summary, started_at, ended_at, created_at, last_segment_sig, last_activity_at
        FROM meetings WHERE id = ${id}
    `) as MeetingRow[];
    const meeting = meetings[0];
    if (!meeting) return json({ error: "not found" }, { status: 404 });

    const segments = (await sql/* sql */ `
      SELECT id, speaker_name, is_host, words, start_ts, end_ts, event_type, created_at
        FROM meeting_transcript
       WHERE meeting_id = ${id}
       ORDER BY seq ASC, created_at ASC
       LIMIT 2000
    `) as SegmentRow[];

    // Client contract: it reverses the array assuming newest-first. Keep that.
    segments.reverse();

    return json({ meeting, segments });
  } catch (err) {
    return json(
      { error: "fetch failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};

/**
 * POST /api/meetings/:id — mark the meeting ended (idempotent). The box bot
 * auto-leaves when it's alone in the call; this just flips our record so the UI
 * moves on. (A direct dashboard→bot "leave now" command isn't wired — the bot
 * leaves on its own; a queued 'requested' row is simply cancelled here.)
 */
export const onRequestPost: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const id = parseId(params);
  if (id === null) return json({ error: "invalid id" }, { status: 400 });

  const sql = getDb(env);
  const rows = (await sql/* sql */ `SELECT id, status FROM meetings WHERE id = ${id}`) as {
    id: number;
    status: string;
  }[];
  const meeting = rows[0];
  if (!meeting) return json({ error: "not found" }, { status: 404 });
  if (meeting.status === "ended" || meeting.status === "failed") {
    return json({ ok: true, already: meeting.status });
  }

  await sql/* sql */ `
    UPDATE meetings
       SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ${id}
  `;
  return json({ ok: true });
};
