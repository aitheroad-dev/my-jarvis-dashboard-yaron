import type { PagesFunction } from "@cloudflare/workers-types";
import { getDb } from "../../_lib/db";
import { json, requireUser, type Env as AuthEnv } from "../../_lib/auth";
import { type VexaEnv } from "../../_lib/vexa";
import { type MeetingRow } from "../../_lib/meetings";
import { parseMeetingUrl } from "../../_lib/meeting-url";
import { type JobContract, type RecorderProducerEnv } from "../../_lib/recorder-job";

interface Env extends AuthEnv, VexaEnv, RecorderProducerEnv {}

// Languages the transcriber understands; anything else → stored NULL (box default he).
const ALLOWED_LANGUAGES = new Set(["he", "en", "auto", "es", "fr", "de"]);

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
    // Fork-side stale sweep (ISC-46): in queue mode the box no longer runs the D1
    // sweep, so fail rows that never completed within 4h (covers enqueued-but-never-
    // pulled orphans). Best-effort — never block the list. Idempotent + safe in both
    // d1poll and queue modes.
    const staleCutoff = new Date(Date.now() - 4 * 3600_000).toISOString();
    await sql`
      UPDATE meetings SET status='failed', last_error='stale: no completion within 4h'
       WHERE status IN ('requested','starting') AND created_at < ${staleCutoff}
    `.catch(() => []);

    const rows = (await sql/* sql */ `
      SELECT id, title, meeting_url, platform, native_meeting_id, bot_id, status,
             summary, started_at, ended_at, created_at, last_error, error_status
        FROM meetings
       ORDER BY created_at DESC
       LIMIT ${limit}
    `) as MeetingRow[];

    // Vexa is retired — the box recorder owns the meeting lifecycle now (poller
    // sets 'starting', the completion webhook sets 'ended', the box sweep fails
    // stale rows). So we no longer probe a vendor here; the list is a pure D1 read.
    // configured:true always now — the owned recorder bot is the engine.
    return json({ meetings: rows, configured: true });
  } catch (err) {
    return json(
      { error: "list failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};

/**
 * POST /api/meetings — queue a recording for the owned recorder bot (Path 6).
 *
 * The dashboard (Cloudflare) cannot reach the box's localhost bot port, so this
 * does NOT call the bot directly. It writes a `status='requested'` row; a
 * box-local poller (the meeting-transcriber service, which already holds a D1
 * token + can reach the bot at localhost:3000) claims it, sends the bot in, and
 * flips it to 'starting'. On completion the bot's webhook → transcriber correlates
 * back to this exact row (via teamId=mtg-<id>) and fills the transcript. This is
 * the manual-create path; calendar auto-join reuses the same queue.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env);
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  let body: { title?: unknown; meeting_url?: unknown; language?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const rawUrl = typeof body.meeting_url === "string" ? body.meeting_url : "";
  if (!title) return json({ error: "title is required" }, { status: 400 });

  const parsed = parseMeetingUrl(rawUrl);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

  const language =
    typeof body.language === "string" && ALLOWED_LANGUAGES.has(body.language)
      ? body.language
      : null;

  // Store the URL as given so the recorder has everything it needs to hand the
  // bot (incl. any Zoom ?pwd=).
  const meetingUrl = rawUrl.trim();

  // Tenant-scoped correlation key (multi-tenant P0): the box echoes this through
  // the bot teamId and the ingest callback matches the completed recording back to
  // this row by job_id — replacing the single-DB mtg-<id> trick.
  const jobId = crypto.randomUUID();

  try {
    const sql = getDb(env);
    const rows = (await sql/* sql */ `
      INSERT INTO meetings (title, meeting_url, status, platform, native_meeting_id, language, job_id)
      VALUES (${title}, ${meetingUrl}, 'requested', ${parsed.platform}, ${parsed.nativeMeetingId}, ${language}, ${jobId})
      RETURNING id
    `) as { id: number }[];
    const id = rows[0]?.id;

    // Best-effort enqueue onto the shared control plane. The 'requested' row above
    // is the source of truth; if the queue is unbound/down this is a NO-OP and the
    // legacy box D1-poller still picks the row up. Failure is logged LOUDLY (never
    // silently swallowed) so a chronically-failing queue is visible BEFORE cutover.
    let enqueued = false;
    if (env.RECORDER_QUEUE && env.INGEST_SECRET && env.RECORDER_INGEST_URL) {
      const job: JobContract = {
        job_id: jobId,
        tenant_id: env.RECORDER_TENANT_ID ?? "yaron",
        meeting_url: meetingUrl,
        platform: parsed.platform,
        native_id: parsed.nativeMeetingId,
        language,
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
        `[recorder] queue not bound (need RECORDER_QUEUE+INGEST_SECRET+RECORDER_INGEST_URL) — job_id=${jobId} relies on d1poll`,
      );
    }

    return json({ ok: true, id, status: "requested", job_id: jobId, enqueued }, { status: 201 });
  } catch (err) {
    return json(
      { error: "could not queue recording", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
};
