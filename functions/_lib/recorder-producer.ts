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
  | { ok: true; id: number; jobId: string; enqueued: boolean }
  | { ok: false; detail: string };

/**
 * Write the local `requested` row (uuid job_id) and enqueue the job. The row is
 * the source of truth; a failed enqueue returns `enqueued:false` + is logged
 * LOUDLY — NEVER swallowed as success (feedback_failed_query_not_negative). The
 * caller decides how to surface `enqueued:false` (the manual POST reports it; the
 * calendar path marks the row 'failed' so it's visible + retryable in-window).
 */
export async function createRecordingJob(
  env: RecorderProducerEnv,
  sql: ReturnType<typeof getDb>,
  args: CreateRecordingJobArgs,
): Promise<CreateRecordingJobResult> {
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

  return { ok: true, id, jobId, enqueued };
}
