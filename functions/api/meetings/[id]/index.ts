import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../../_lib/auth";

interface Env extends AuthEnv {
  MEETINGS_WORKER_URL: string;
  MEETINGS_TENANT_KEY: string;
  MEETINGS_TENANT_SLUG: string;
}

type MeetingRow = {
  id: number;
  title: string;
  meeting_url: string;
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

/**
 * GET /api/meetings/:id — meeting + last 200 transcript segments
 * (newest first by created_at; the client reverses for display).
 */
export const onRequestGet: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const idRaw = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const sql = getDb(env);
    const meetings = (await sql/* sql */ `
      SELECT id, title, meeting_url, bot_id, status, summary,
             started_at, ended_at, created_at
        FROM meetings WHERE id = ${id}
    `) as MeetingRow[];
    const meeting = meetings[0];
    if (!meeting) return json({ error: "not found" }, { status: 404 });

    const segments = (await sql/* sql */ `
      SELECT id, speaker_name, is_host, words, start_ts, end_ts, event_type, created_at
        FROM meeting_transcript
       WHERE meeting_id = ${id}
       ORDER BY created_at DESC
       LIMIT 200
    `) as SegmentRow[];

    return json({ meeting, segments });
  } catch (err) {
    return json(
      { error: "fetch failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};

/**
 * POST /api/meetings/:id/stop is folded into a plain POST on this handler —
 * any POST to /api/meetings/:id stops the meeting (idempotent on already-ended).
 */
export const onRequestPost: PagesFunction<Env, "id"> = async ({ request, env, params }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  const idRaw = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: "invalid id" }, { status: 400 });
  }

  if (!env.MEETINGS_WORKER_URL || !env.MEETINGS_TENANT_KEY || !env.MEETINGS_TENANT_SLUG) {
    return json(
      { error: "server misconfigured: meetings worker bindings missing" },
      { status: 500 },
    );
  }

  const sql = getDb(env);
  const rows = (await sql/* sql */ `
    SELECT id, bot_id, status FROM meetings WHERE id = ${id}
  `) as { id: number; bot_id: string | null; status: string }[];
  const row = rows[0];
  if (!row) return json({ error: "not found" }, { status: 404 });
  if (row.status === "ended" || row.status === "failed") {
    return json({ ok: true, already: row.status });
  }
  if (!row.bot_id) {
    await sql/* sql */ `
      UPDATE meetings
      SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ${id}
    `;
    return json({ ok: true, no_bot: true });
  }

  try {
    const workerRes = await fetch(`${env.MEETINGS_WORKER_URL}/meeting/leave`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MEETINGS_TENANT_KEY}`,
        "X-Tenant": env.MEETINGS_TENANT_SLUG,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bot_id: row.bot_id }),
    });
    // We tolerate non-2xx from Recall here (e.g. bot already left); we still
    // mark the meeting ended on our side so the UI moves on.
    if (!workerRes.ok) {
      const detail = await workerRes.text().catch(() => "");
      await sql/* sql */ `
        UPDATE meetings
        SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ${id}
      `;
      return json({ ok: true, worker_status: workerRes.status, worker_detail: detail });
    }
  } catch (err) {
    await sql/* sql */ `
      UPDATE meetings
      SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE id = ${id}
    `;
    return json({
      ok: true,
      worker_error: err instanceof Error ? err.message : String(err),
    });
  }

  await sql/* sql */ `
    UPDATE meetings
    SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
    WHERE id = ${id}
  `;
  return json({ ok: true });
};
