// recorder-producer.ts — the SHARED producer for the owned recorder (Path 6).
//
// One place writes a `status='requested'` meetings row + best-effort enqueues the
// JobContract onto the shared `recorder-jobs` queue. BOTH triggers call it:
//   - the manual button  → POST /api/meetings
//   - calendar auto-join → workers/calendar-cron (enqueueDue in calendar.ts)
// so a scheduled meeting and a hand-started one emit a byte-identical job and the
// calendar path can never drift from the button. The box pulls the job, records +
// transcribes, then HMAC-POSTs the result back to this fork's ingest endpoint — it
// never holds this fork's D1 token (see pai-meeting-recorder/ISA_MULTITENANT.md).

import { getDb } from "./db";
import { type JobContract, type RecorderProducerEnv } from "./recorder-job";

export interface CreateRecordingJobArgs {
  title: string;
  meetingUrl: string; // stored as given (recorder needs any Zoom ?pwd=)
  platform: string | null;
  nativeId: string | null;
  language: string | null; // he|en|auto|es|fr|de ; null = box default (he)
}

export type CreateRecordingJobResult =
  | { ok: true; id: number; jobId: string; enqueued: boolean; reused?: boolean }
  | { ok: false; detail: string };

/**
 * Idempotently start ONE recording per meeting code. Both triggers call this — the
 * manual button and the calendar auto-join cron — and auto_join defaults ON for
 * every Meet event, so the SAME occurrence can arrive from both paths. The shared
 * in-flight reuse guard + a partial unique index (migration 020) make "one active
 * recording per code" atomic even under a simultaneous manual-click + cron-tick →
 * never two bots on one meeting (Forge C1).
 *
 * On enqueue failure the row is marked 'failed' HERE so a phantom 'requested' can
 * never suppress the cron safety net (Forge C2): a failed enqueue is a real
 * non-record, surfaced + logged LOUDLY, NEVER a silent success
 * (feedback_failed_query_not_negative). Returns reused:true when an in-flight row
 * already existed (no second job enqueued).
 */
export async function createRecordingJob(
  env: RecorderProducerEnv,
  sql: ReturnType<typeof getDb>,
  args: CreateRecordingJobArgs,
): Promise<CreateRecordingJobResult> {
  // Reuse an already-in-flight recording for this code instead of starting a second
  // (manual button + cron both target auto_join meetings). Tradeoff: a genuinely
  // stuck in-flight row from a PRIOR occurrence would be reused — acceptable because
  // the 4h stale sweep flips stuck rows to 'failed' and recurring occurrences are
  // >24h apart, so it never bites in practice.
  const existing = (await sql/* sql */ `
    SELECT id, job_id FROM meetings
     WHERE platform = ${args.platform} AND native_meeting_id = ${args.nativeId}
       AND status IN ('requested','starting','transcribing')
     LIMIT 1
  `) as { id: number; job_id: string | null }[];
  if (existing[0]) {
    return { ok: true, id: existing[0].id, jobId: existing[0].job_id ?? "", enqueued: false, reused: true };
  }

  const jobId = crypto.randomUUID();
  let id: number | undefined;
  try {
    const rows = (await sql/* sql */ `
      INSERT INTO meetings (title, meeting_url, status, platform, native_meeting_id, language, job_id)
      VALUES (${args.title}, ${args.meetingUrl}, 'requested', ${args.platform}, ${args.nativeId}, ${args.language}, ${jobId})
      RETURNING id
    `) as { id: number }[];
    id = rows[0]?.id;
  } catch (e) {
    // Partial unique index tripped — a concurrent producer won the race for this
    // code. Reuse its in-flight row rather than double-enqueue.
    const raced = (await sql/* sql */ `
      SELECT id, job_id FROM meetings
       WHERE platform = ${args.platform} AND native_meeting_id = ${args.nativeId}
         AND status IN ('requested','starting','transcribing')
       LIMIT 1
    `) as { id: number; job_id: string | null }[];
    if (raced[0]) {
      return { ok: true, id: raced[0].id, jobId: raced[0].job_id ?? "", enqueued: false, reused: true };
    }
    return { ok: false, detail: `insert failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (id === undefined) return { ok: false, detail: "insert returned no row" };

  let enqueued = false;
  if (env.RECORDER_QUEUE && env.INGEST_SECRET && env.RECORDER_INGEST_URL) {
    const job: JobContract = {
      job_id: jobId,
      tenant_id: env.RECORDER_TENANT_ID ?? "yaron",
      meeting_url: args.meetingUrl,
      platform: args.platform,
      native_id: args.nativeId,
      language: args.language,
      ingest_url: env.RECORDER_INGEST_URL,
      ingest_secret: env.INGEST_SECRET,
      r2_bucket: env.RECORDER_R2_BUCKET ?? null,
      audio_ref: null,
      created_at: new Date().toISOString(),
      attempts: 0,
    };
    try {
      await env.RECORDER_QUEUE.send(job);
      enqueued = true;
    } catch (e) {
      console.error(
        `[recorder] ENQUEUE FAILED job_id=${jobId} id=${id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else {
    console.warn(
      `[recorder] queue not bound (need RECORDER_QUEUE+INGEST_SECRET+RECORDER_INGEST_URL) — job_id=${jobId} id=${id}`,
    );
  }

  if (!enqueued) {
    // Row written but the job never reached the queue → in queue mode it will NEVER
    // record. Mark it 'failed' so /meetings shows it, callers report the truth, and
    // the cron handled-check (which excludes 'failed') can retry within the window.
    // A phantom 'requested' would instead silently suppress every future cron tick.
    await sql/* sql */ `
      UPDATE meetings SET status = 'failed', last_error = 'enqueue failed (queue unbound/down)'
       WHERE id = ${id}
    `.catch(() => {});
  }

  return { ok: true, id, jobId, enqueued };
}
