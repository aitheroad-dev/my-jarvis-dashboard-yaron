import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../../_lib/auth";
import {
  fetchTranscript,
  stopBot,
  vexaConfigured,
  type Platform,
  type VexaEnv,
  type VexaSegment,
} from "../../../_lib/vexa";
import { maybeEndMeeting, type MeetingRow } from "../../../_lib/meetings";

interface Env extends AuthEnv, VexaEnv {}

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
 * Cheap change-detection signature over Vexa's full transcript. Two pulls with
 * the same signature carry no new information, so we skip all D1 writes — this
 * is what keeps a 1s poll on an hour-long meeting from doing millions of writes.
 */
function transcriptSig(segs: VexaSegment[]): string {
  let count = 0;
  let chars = 0;
  for (const s of segs) {
    const t = (s.text ?? "").trim();
    if (!t) continue;
    count++;
    chars += t.length;
  }
  const last = segs.length ? segs[segs.length - 1] : null;
  const tail = last
    ? `${last.absolute_start_time ?? ""}|${(last.text ?? "").length}|${last.completed ? 1 : 0}`
    : "";
  return `${count}:${chars}:${tail}`;
}

interface SyncResult {
  /** epoch ms of the last time this meeting's transcript actually changed */
  lastActivityAt: number | null;
  /** did this pull write new transcript? (bot is obviously present if so) */
  changed: boolean;
}

/**
 * Pull-on-view ingest: fetch Vexa's full transcript and, only when it changed
 * since last pull, atomically REPLACE this meeting's segments (delete-all +
 * insert-all in one D1 batch). Replace-all is immune to Vexa re-segmentation
 * (tail partials reorder/coalesce as they finalize) — a positional upsert key
 * would silently overwrite the wrong utterance; identity matching is avoided
 * entirely. Vendor failure is swallowed: the page serves whatever D1 has.
 */
async function syncTranscript(
  env: Env,
  meeting: MeetingRow,
): Promise<SyncResult> {
  const priorActivity = meeting.last_activity_at ? Date.parse(meeting.last_activity_at) : null;
  if (!vexaConfigured(env) || !meeting.platform || !meeting.native_meeting_id) {
    return { lastActivityAt: priorActivity, changed: false };
  }
  const res = await fetchTranscript(env, meeting.platform as Platform, meeting.native_meeting_id);
  if (!res.ok) return { lastActivityAt: priorActivity, changed: false };

  // Session boundary: Vexa keys transcripts by platform+meeting code, so a
  // reused Meet code (personal rooms) can return a prior session's segments.
  // Keep only segments that started at/after this row's start (60s grace).
  // absolute_start_time is populated by Vexa even though start_time is null.
  const sessionStart = meeting.started_at ? Date.parse(meeting.started_at) - 60_000 : null;
  const kept = res.data.filter((seg) => {
    if (!(seg.text ?? "").trim()) return false;
    if (sessionStart !== null && seg.absolute_start_time) {
      const t = Date.parse(seg.absolute_start_time);
      if (Number.isFinite(t) && t < sessionStart) return false;
    }
    return true;
  });

  const sig = transcriptSig(kept);
  if (sig === meeting.last_segment_sig) {
    // No new transcript since last pull — nothing to write.
    return { lastActivityAt: priorActivity, changed: false };
  }

  const nowIso = new Date().toISOString();
  const botId = meeting.bot_id ?? "";
  const stmts = [
    env.DB.prepare("DELETE FROM meeting_transcript WHERE meeting_id = ?").bind(meeting.id),
    ...kept.map((seg, i) =>
      env.DB.prepare(
        `INSERT INTO meeting_transcript
           (meeting_id, seq, bot_id, speaker_name, words, start_ts, end_ts, event_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        meeting.id,
        i,
        botId,
        seg.speaker ?? "",
        (seg.text ?? "").trim(),
        Number.isFinite(seg.start_time) ? seg.start_time : null,
        Number.isFinite(seg.end_time) ? seg.end_time : null,
        seg.completed ? "final" : "partial",
        seg.absolute_start_time ?? nowIso,
      ),
    ),
    env.DB.prepare(
      "UPDATE meetings SET last_segment_sig = ?, last_activity_at = ? WHERE id = ?",
    ).bind(sig, nowIso, meeting.id),
  ];
  // D1 batch runs as one atomic transaction, so two concurrent polls can't
  // interleave a half-deleted transcript.
  await env.DB.batch(stmts);
  return { lastActivityAt: Date.parse(nowIso), changed: true };
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
             summary, started_at, ended_at, created_at, last_segment_sig, last_activity_at
        FROM meetings WHERE id = ${id}
    `) as MeetingRow[];
    const meeting = meetings[0];
    if (!meeting) return json({ error: "not found" }, { status: 404 });

    // Live/starting meetings refresh from the vendor on every view; ended and
    // failed meetings are served purely from D1 (the permanent record).
    if (meeting.status === "live" || meeting.status === "starting") {
      const { changed } = await syncTranscript(env, meeting);
      meeting.status = await maybeEndMeeting(env, sql, meeting, changed);
    }

    const segments = (await sql/* sql */ `
      SELECT id, speaker_name, is_host, words, start_ts, end_ts, event_type, created_at
        FROM meeting_transcript
       WHERE meeting_id = ${id}
       ORDER BY seq ASC, created_at ASC
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
           summary, started_at, ended_at, created_at, last_segment_sig, last_activity_at
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
    await syncTranscript(env, meeting); // final pull before we stop syncing
  }

  await sql/* sql */ `
    UPDATE meetings
       SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ${id}
  `;
  return json({ ok: true, ...(vendorNote ? { vendor_note: vendorNote } : {}) });
};
