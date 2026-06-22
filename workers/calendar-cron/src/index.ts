/**
 * Calendar auto-join cron — the only thing in this stack that fires on a clock.
 * Every minute it refreshes the calendar cache and dispatches Vexa bots for
 * opt-in meetings whose start time has arrived. Shares the dashboard's D1 and
 * the same functions/_lib code, so there's no second copy of the Google/Vexa
 * logic and no HTTP/CF-Access boundary to cross.
 *
 * A guarded GET (?key=TRIGGER_SECRET) runs the same pass on demand for testing.
 */
import { getDb } from "../../../functions/_lib/db";
import { getAccessToken, syncEvents, dispatchDue } from "../../../functions/_lib/calendar";
import { reconcileActiveMeetings } from "../../../functions/_lib/meetings";

export interface Env {
  DB: unknown; // D1Database — bound in wrangler.toml
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  CAL_TOKEN_KEY: string;
  VEXA_API_BASE?: string;
  VEXA_API_KEY: string;
  TRIGGER_SECRET?: string;
}

// _lib helpers are typed against the dashboard's env shapes; the Worker env is
// structurally compatible (same binding + secret names), so cast at the seam.
type LibEnv = Parameters<typeof getAccessToken>[0] & Parameters<typeof dispatchDue>[0];

async function runPass(env: Env): Promise<{ dispatched: number; errors: string[] }> {
  const e = env as unknown as LibEnv;
  const sql = getDb(env as unknown as Parameters<typeof getDb>[0]);
  const tok = await getAccessToken(e, sql);
  if (!tok.ok) return { dispatched: 0, errors: [`token: ${tok.detail}`] };
  const now = Date.now();
  await syncEvents(sql, tok.accessToken, now);
  // End empty/stale bots before dispatching so an empty-room meeting can flip to
  // ended-no-transcript and become re-dispatch eligible (the late-join fix).
  await reconcileActiveMeetings(e, sql);
  return dispatchDue(e, sql, now);
}

export default {
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const r = await runPass(env);
    if (r.dispatched > 0 || r.errors.length) {
      console.log(`[calendar-cron] dispatched=${r.dispatched} errors=${JSON.stringify(r.errors)}`);
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
