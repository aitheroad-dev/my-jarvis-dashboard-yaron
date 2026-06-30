// POST /api/recordings/ingest — the per-fork callback the shared box recorder
// uses to hand results back WITHOUT ever touching this fork's D1 token.
//
// Machine path (no CF Access JWT — like /api/voice/ingest + /api/mcp-activity):
// the box authenticates with an HMAC over `${X-Timestamp}.${rawBody}` using this
// fork's INGEST_SECRET. Two message kinds:
//   - status : lifecycle ping (starting | transcribing | failed) — monotonic.
//   - result : final transcript → writes meetings + meeting_transcript (idempotent).
// Correlation is by job_id (stored on the meetings row at enqueue time). An
// unknown job_id is rejected (404) — never a silent orphan/cross-tenant write.
//
// It writes via this fork's own env.DB binding, which IS the D1 the /meetings UI
// reads — so transcripts are written to, and read from, the same per-fork store
// with zero read-path change. That is what makes the recorder share compute, not data.

import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, type Env as AuthEnv } from "../../_lib/auth";
import {
  verifyIngest,
  type IngestMessage,
  type RecorderProducerEnv,
} from "../../_lib/recorder-job";

interface Env extends AuthEnv, RecorderProducerEnv {}

// Status rank — monotonic guard so an at-least-once redelivered 'starting' cannot
// clobber a row that already reached 'ended'. 'failed' may always be set.
const RANK: Record<string, number> = {
  requested: 0,
  starting: 1,
  transcribing: 2,
  ended: 3,
  failed: 3,
};

// Match the box's existing transcript column set (see transcriber/d1.ts SEG_COLS).
const CHUNK = 10; // 10 rows × 9 cols = 90, under D1's bound-param cap

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const raw = await request.text();

  const ok = await verifyIngest(
    env.INGEST_SECRET ?? "",
    request.headers.get("X-Timestamp"),
    request.headers.get("X-Signature"),
    raw,
    Date.now(),
  );
  if (!ok) return json({ error: "invalid signature" }, { status: 401 });

  let msg: IngestMessage;
  try {
    msg = JSON.parse(raw) as IngestMessage;
  } catch {
    return json({ error: "bad json" }, { status: 400 });
  }
  if (!msg.job_id) return json({ error: "missing job_id" }, { status: 400 });

  const sql = getDb(env);
  const rows = await sql<{ id: number; status: string }>`
    SELECT id, status FROM meetings WHERE job_id = ${msg.job_id} LIMIT 1`;
  const row = rows[0];
  if (!row) {
    // No matching local row → never a silent orphan / cross-tenant insert.
    console.warn(`[ingest] no matching job_id=${msg.job_id}`);
    return json({ error: "no matching job", job_id: msg.job_id }, { status: 404 });
  }

  // ---- status ping ----------------------------------------------------------
  if (msg.kind === "status") {
    const cur = RANK[row.status] ?? 0;
    const next = RANK[msg.status] ?? 0;
    if (next < cur && msg.status !== "failed") {
      console.log(`[ingest] job_id=${msg.job_id} non-monotonic ${row.status}→${msg.status} ignored`);
      return json({ ok: true, ignored: "non-monotonic", from: row.status, to: msg.status });
    }
    await sql`
      UPDATE meetings
         SET status = ${msg.status},
             last_error = ${msg.last_error ?? null},
             error_status = ${msg.error_status ?? null}
       WHERE id = ${row.id}`;
    console.log(`[ingest] job_id=${msg.job_id} status→${msg.status} id=${row.id}`);
    return json({ ok: true, id: row.id, status: msg.status });
  }

  // ---- final result ---------------------------------------------------------
  if (msg.kind === "result") {
    const t = msg.transcript ?? { segments: [] };
    const endedIso = msg.ended_at ?? new Date().toISOString();
    const startedIso = msg.started_at ?? endedIso;
    const startedMs = Number.isFinite(Date.parse(startedIso)) ? Date.parse(startedIso) : Date.now();

    await sql`
      UPDATE meetings
         SET status = 'ended', bot_id = ${msg.bot_id ?? null},
             started_at = ${startedIso}, ended_at = ${endedIso},
             last_error = NULL, error_status = NULL
       WHERE id = ${row.id}`;

    // Idempotent: replace any prior segments for this meeting before re-inserting.
    await sql`DELETE FROM meeting_transcript WHERE meeting_id = ${row.id}`;

    const segs = t.segments ?? [];
    let written = 0;
    for (let i = 0; i < segs.length; i += CHUNK) {
      const slice = segs.slice(i, i + CHUNK);
      const stmts = slice.map((s, j) => {
        const seq = i + j;
        const offset = Number.isFinite(s.start) ? Math.round((s.start as number) * 1000) : 0;
        const segCreated = new Date(startedMs + offset).toISOString();
        return env.DB.prepare(
          `INSERT INTO meeting_transcript
             (meeting_id, seq, bot_id, speaker_name, words, start_ts, end_ts, event_type, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).bind(
          row.id,
          seq,
          msg.bot_id ?? null,
          null,
          s.text ?? "",
          Number.isFinite(s.start) ? s.start : null,
          Number.isFinite(s.end) ? s.end : null,
          "final",
          segCreated,
        );
      });
      if (stmts.length) await env.DB.batch(stmts);
      written += slice.length;
    }

    console.log(`[ingest] job_id=${msg.job_id} result id=${row.id} segments=${written}`);
    return json({ ok: true, id: row.id, segments: written });
  }

  return json({ error: "unknown kind" }, { status: 400 });
};
