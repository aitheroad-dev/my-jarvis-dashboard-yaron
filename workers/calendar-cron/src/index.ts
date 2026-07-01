/**
 * Calendar auto-join cron (owned recorder, Path 6 / multi-tenant P2).
 *
 * Every minute it refreshes the Google Calendar cache into D1 and ENQUEUES a
 * recorder job for each opt-in meeting whose start has arrived. The box is the
 * queue's HTTP pull consumer — it records, transcribes, and HMAC-POSTs the result
 * back to this fork's /api/recordings/ingest. The cron never touches the box and
 * never holds a box credential; it only reads THIS fork's calendar_events and
 * writes THIS fork's meetings via its own D1 binding (fork-local → replicates per
 * fork). Shares the dashboard's functions/_lib so there's one copy of the Google +
 * enqueue logic and no HTTP / CF-Access hop.
 *
 * A guarded GET (?key=TRIGGER_SECRET) runs the same pass on demand for testing.
 */
import { getDb } from "../../../functions/_lib/db";
import { getAccessToken, syncEvents, enqueueDue } from "../../../functions/_lib/calendar";
import { notifyTelegram } from "../../../functions/_lib/notify";

export interface Env {
  DB: unknown; // D1Database — bound in wrangler.toml
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CAL_TOKEN_KEY: string;
  TRIGGER_SECRET?: string;
  // Recorder control plane (shared queue) — the cron ENQUEUES; the box pulls.
  RECORDER_QUEUE?: unknown; // Queue<JobContract> — bound in wrangler.toml
  INGEST_SECRET?: string; // per-fork HMAC callback key (== the Pages project's)
  RECORDER_TENANT_ID?: string;
  RECORDER_INGEST_URL?: string;
  RECORDER_R2_BUCKET?: string;
  // Owner alerting (optional — notify no-ops if either is unset).
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

// _lib helpers are typed against the dashboard's env shapes; the Worker env is
// structurally compatible (same binding + secret names), so cast at the seam.
type LibEnv = Parameters<typeof getAccessToken>[0] & Parameters<typeof enqueueDue>[0];

async function runPass(
  env: Env,
): Promise<{ dispatched: number; errors: string[]; alertable: string[] }> {
  const e = env as unknown as LibEnv;
  const sql = getDb(env as unknown as Parameters<typeof getDb>[0]);
  const tok = await getAccessToken(e, sql);
  if (!tok.ok) return { dispatched: 0, errors: [`token: ${tok.detail}`], alertable: [] };
  const now = Date.now();
  await syncEvents(sql, tok.accessToken, now);
  // No reconcileActiveMeetings here: the box owns the recorder lifecycle now
  // (ingest 'result' ends a meeting; the fork-side 4h stale sweep in the
  // /api/meetings GET fails orphaned requested/starting rows). There is no Vexa
  // bot to reconcile.
  return enqueueDue(e, sql, now);
}

export default {
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const r = await runPass(env);
    if (r.dispatched > 0 || r.errors.length) {
      console.log(`[calendar-cron] dispatched=${r.dispatched} errors=${JSON.stringify(r.errors)}`);
    }
    // Alert only on alertable failures — a hard enqueue fault (D1/queue) whose
    // per-event attempt cap is spent, or the last attempt that still fits the
    // meeting window. Ordinary retryable blips are NOT alerted (no spam). Token
    // errors never reach `alertable` (a dead Google token shows on the calendar
    // card instead).
    if (r.alertable.length) {
      await notifyTelegram(
        env,
        `🔴 Auto-join couldn't queue a recording (${r.alertable.length}): ${r.alertable.join(" | ")}`,
      );
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!env.TRIGGER_SECRET || url.searchParams.get("key") !== env.TRIGGER_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const r = await runPass(env);
    return Response.json(r);
  },
};
