import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../../_lib/auth";
import {
  fetchTranscript,
  stopBot,
  vexaConfigured,
  type Platform,
  type VexaEnv,
} from "../../../_lib/vexa";

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
 * Pull-on-view ingest: fetch the full transcript from Vexa and upsert it into
 * meeting_transcript. Idempotent via the (meeting_id, start_ts, speaker_name)
 * unique index — re-pulls update text/completed in place. Vendor failure is
 * swallowed: the page then serves whatever D1 already has.
 */
async function syncTranscript(
  env: Env,
  sql: ReturnType<typeof getDb>,
  meeting: MeetingRow,
): Promise<void> {
  if (!vexaConfigured(env)) return;
  if (!meeting.platform || !meeting.native_meeting_id) return;
  const res = await fetchTranscript(
    env,
    meeting.platform as Platform,
    meeting.native_meeting_id,
  );
  if (!res.ok) return;
  // Session boundary: Vexa scopes transcripts by platform+meeting code, so a
  // reused Meet code (personal rooms!) can return segments from an earlier
  // session. Only ingest segments that started after this row was created,
  // with 60s grace for clock skew.
  const sessionStart = meeting.started_at
    ? Date.parse(meeting.started_at) - 60_000
    : null;
  for (const seg of res.data) {
    const text = (seg.text ?? "").trim();
    if (!text) continue;
    if (sessionStart !== null && seg.absolute_start_time) {
      const t = Date.parse(seg.absolute_start_time);
      if (Number.isFinite(t) && t < sessionStart) continue;
    }
    // '' not NULL: SQLite treats NULLs as distinct in unique indexes, which
    // would let speakerless segments duplicate on every re-pull.
    const speaker = seg.speaker ?? "";
    const start = Number.isFinite(seg.start_time) ? seg.start_time : null;
    const end = Number.isFinite(seg.end_time) ? seg.end_time : null;
    await sql/* sql */ `
      INSERT INTO meeting_transcript
        (meeting_id, bot_id, speaker_name, words, start_ts, end_ts, event_type, created_at)
      VALUES
        (${meeting.id}, ${meeting.bot_id ?? ""}, ${speaker}, ${text}, ${start}, ${end},
         ${seg.completed ? "final" : "partial"},
         COALESCE(${seg.absolute_start_time}, strftime('%Y-%m-%dT%H:%M:%SZ','now')))
      ON CONFLICT (meeting_id, start_ts, speaker_name) DO UPDATE SET
        words = excluded.words,
        end_ts = excluded.end_ts,
        event_type = excluded.event_type
    `;
  }
}

/** GET /api/meetings/:id — meeting + transcript (synced from Vexa while live). */
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
             summary, started_at, ended_at, created_at
        FROM meetings WHERE id = ${id}
    `) as MeetingRow[];
    const meeting = meetings[0];
    if (!meeting) return json({ error: "not found" }, { status: 404 });

    // Orphaned-bot safeguard: nothing legitimately runs 12h+. Flip it ended
    // (best-effort bot stop) so a forgotten tab can't burn vendor hours.
    if (
      (meeting.status === "live" || meeting.status === "starting") &&
      meeting.started_at &&
      Date.now() - Date.parse(meeting.started_at) > 12 * 3600_000
    ) {
      if (vexaConfigured(env) && meeting.platform && meeting.native_meeting_id) {
        await stopBot(env, meeting.platform as Platform, meeting.native_meeting_id);
      }
      await sql/* sql */ `
        UPDATE meetings SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ${meeting.id}
      `;
      meeting.status = "ended";
    }

    // Live/starting meetings refresh from the vendor on every view; ended and
    // failed meetings are served purely from D1 (the permanent record).
    if (meeting.status === "live" || meeting.status === "starting") {
      await syncTranscript(env, sql, meeting);
    }

    const segments = (await sql/* sql */ `
      SELECT id, speaker_name, is_host, words, start_ts, end_ts, event_type, created_at
        FROM meeting_transcript
       WHERE meeting_id = ${id}
       ORDER BY start_ts ASC, created_at ASC
       LIMIT 2000
    `) as SegmentRow[];

    // Client contract predates this rewrite: it reverses the array assuming
    // newest-first. Keep that contract.
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
 * POST /api/meetings/:id — stop the meeting (idempotent on already-ended).
 * Tells the Vexa bot to leave, does a final transcript pull, marks ended.
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
  const rows = (await sql/* sql */ `
    SELECT id, title, meeting_url, platform, native_meeting_id, bot_id, status,
           summary, started_at, ended_at, created_at
      FROM meetings WHERE id = ${id}
  `) as MeetingRow[];
  const meeting = rows[0];
  if (!meeting) return json({ error: "not found" }, { status: 404 });
  if (meeting.status === "ended" || meeting.status === "failed") {
    return json({ ok: true, already: meeting.status });
  }

  let vendorNote: string | null = null;
  if (vexaConfigured(env) && meeting.platform && meeting.native_meeting_id) {
    const res = await stopBot(env, meeting.platform as Platform, meeting.native_meeting_id);
    // Tolerate vendor refusal (bot already left, meeting over) — the meeting
    // still ends on our side so the UI moves on.
    if (!res.ok) vendorNote = `stop returned ${res.status}: ${res.detail.slice(0, 200)}`;
    await syncTranscript(env, sql, meeting); // final pull before we stop syncing
  }

  await sql/* sql */ `
    UPDATE meetings
       SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ${id}
  `;
  return json({ ok: true, ...(vendorNote ? { vendor_note: vendorNote } : {}) });
};
