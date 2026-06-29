import { getDb } from "./db";
import {
  botRunning,
  createBot,
  stopBot,
  vexaConfigured,
  type Platform,
  type VexaEnv,
} from "./vexa";
import { redactMeetingUrl } from "./meeting-url";
import { notifyTelegram, type NotifyEnv } from "./notify";

// A meeting auto-ends when Vexa reports its bot is no longer running (the call
// ended / everyone left). Bot-absence is only trusted after a join grace, since
// a freshly-created bot takes ~30-60s to appear. 12h is the absolute ceiling.
export const JOIN_GRACE_MS = 2 * 60_000;
export const HARD_CAP_MS = 12 * 3600_000;
// A bot confirmed present in a call this long with ZERO transcript captured is
// flagged as possibly deaf (wrong language pin, never admitted, dead Vexa
// session) — the silent failure that looks healthy. 8 min keeps a genuinely
// quiet opening stretch from crying wolf. Flagged + alerted exactly once.
export const STALL_THRESHOLD_MS = 8 * 60_000;

export type MeetingRow = {
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
  // Present on the detail query; absent (undefined) on the list query.
  last_segment_sig?: string | null;
  last_activity_at?: string | null;
  // Silent-failure feedback (migration 015). last_error/error_status carry the
  // Vexa rejection reason on a 'failed' row, or the stall reason on a deaf
  // 'live' row; alerted_at dedups the per-minute Telegram stall sweep.
  last_error?: string | null;
  error_status?: number | null;
  alerted_at?: string | null;
};

/**
 * Insert a meeting row and send the Vexa bot in. Single source for both the
 * manual create endpoint and the calendar auto-dispatch. Enforces one-bot-per-
 * meeting (returns the existing live row on conflict). On vendor failure the
 * row is kept 'failed' (partial state beats missing state).
 */
export async function createMeetingWithBot(
  env: VexaEnv,
  sql: ReturnType<typeof getDb>,
  args: {
    title: string;
    meetingUrl: string;
    platform: Platform;
    nativeMeetingId: string;
    language?: string;
    passcode?: string;
  },
): Promise<{ ok: true; meetingId: number; reused?: boolean } | { ok: false; status?: number; detail: string }> {
  const existing = (await sql/* sql */ `
    SELECT id FROM meetings
     WHERE platform = ${args.platform} AND native_meeting_id = ${args.nativeMeetingId}
       AND status IN ('live','starting')
     LIMIT 1
  `) as { id: number }[];
  if (existing[0]) return { ok: true, meetingId: existing[0].id, reused: true };

  let meetingId: number;
  try {
    const inserted = (await sql/* sql */ `
      INSERT INTO meetings (title, meeting_url, platform, native_meeting_id, status, started_at)
      VALUES (${args.title}, ${redactMeetingUrl(args.meetingUrl)}, ${args.platform}, ${args.nativeMeetingId},
              'starting', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      RETURNING id
    `) as { id: number }[];
    if (!inserted[0]) return { ok: false, detail: "insert returned no row" };
    meetingId = inserted[0].id;
  } catch {
    // The partial unique index (one active bot per code) tripped — a concurrent
    // dispatch won the race. Reuse its live/starting row instead of double-botting.
    const raced = (await sql/* sql */ `
      SELECT id FROM meetings
       WHERE platform = ${args.platform} AND native_meeting_id = ${args.nativeMeetingId}
         AND status IN ('live','starting')
       LIMIT 1
    `) as { id: number }[];
    if (raced[0]) return { ok: true, meetingId: raced[0].id, reused: true };
    return { ok: false, detail: "insert conflict but no active row found" };
  }

  const bot = await createBot(env, {
    platform: args.platform,
    nativeMeetingId: args.nativeMeetingId,
    language: args.language && args.language !== "auto" ? args.language : undefined,
    passcode: args.passcode,
    botName: "Notetaker",
  });
  if (!bot.ok) {
    // Persist WHY Vexa rejected the bot — without this the reason is lost and
    // the failure is silent (the original bug). status 0 = transport error (no
    // HTTP response) → store NULL so it isn't confused with a real status code.
    await sql/* sql */ `
      UPDATE meetings
         SET status = 'failed', last_error = ${bot.detail},
             error_status = ${bot.status && bot.status > 0 ? bot.status : null}
       WHERE id = ${meetingId}
    `;
    return { ok: false, status: bot.status, detail: bot.detail };
  }
  const botRef = bot.data?.id != null ? String(bot.data.id) : args.nativeMeetingId;
  await sql/* sql */ `UPDATE meetings SET bot_id = ${botRef}, status = 'live' WHERE id = ${meetingId}`;
  return { ok: true, meetingId };
}

/**
 * End a live/starting meeting when its Meet has finished — the automatic stop.
 * Primary signal: Vexa no longer lists a running bot for it. `changed` lets the
 * caller skip the bot probe when transcript just advanced (bot plainly present),
 * bounding vendor calls to idle pulls. Vendor error never ends a meeting; 12h is
 * the hard cap. Used by both the detail view and the list view so a stale 'live'
 * row self-heals from whichever surface the operator opens. Returns new status.
 */
export async function maybeEndMeeting(
  env: VexaEnv,
  sql: ReturnType<typeof getDb>,
  meeting: MeetingRow,
  changed: boolean,
): Promise<string> {
  if (meeting.status !== "live" && meeting.status !== "starting") return meeting.status;
  const started = meeting.started_at ? Date.parse(meeting.started_at) : null;
  const now = Date.now();
  const pastGrace = started !== null && now - started > JOIN_GRACE_MS;

  let shouldEnd = started !== null && now - started > HARD_CAP_MS;
  if (
    !shouldEnd &&
    !changed &&
    pastGrace &&
    vexaConfigured(env) &&
    meeting.platform &&
    meeting.native_meeting_id
  ) {
    const running = await botRunning(env, meeting.platform as Platform, meeting.native_meeting_id);
    if (running.ok && running.data === false) shouldEnd = true;
  }
  if (!shouldEnd) return meeting.status;

  if (vexaConfigured(env) && meeting.platform && meeting.native_meeting_id) {
    await stopBot(env, meeting.platform as Platform, meeting.native_meeting_id);
  }
  await sql/* sql */ `
    UPDATE meetings SET status = 'ended', ended_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE id = ${meeting.id}
  `;
  return "ended";
}

/**
 * Sweep every live/starting meeting and end the ones whose bot is gone (call
 * over, or empty-room bot dropped by Vexa). The cron calls this each minute so a
 * stuck row self-heals WITHOUT anyone opening the dashboard — which is what lets
 * an empty-room meeting flip to ended-with-no-transcript and become re-dispatch
 * eligible (the late-join fix). A single bad row never blocks the sweep.
 */
export async function reconcileActiveMeetings(
  env: VexaEnv & NotifyEnv,
  sql: ReturnType<typeof getDb>,
): Promise<void> {
  const active = (await sql/* sql */ `
    SELECT id, title, meeting_url, platform, native_meeting_id, bot_id, status, summary,
           started_at, ended_at, created_at, alerted_at
      FROM meetings WHERE status IN ('live','starting')
  `) as MeetingRow[];
  for (const m of active) {
    try {
      const status = await maybeEndMeeting(env, sql, m, false);
      // Deaf-bot detection runs ONLY for a genuinely-live row (not a stuck
      // 'starting' that may never have joined, not an ended call).
      if (status !== "live") continue;
      if (m.alerted_at) continue; // cheap pre-filter; the atomic claim below is the real guard
      const started = m.started_at ? Date.parse(m.started_at) : NaN;
      if (!Number.isFinite(started) || Date.now() - started < STALL_THRESHOLD_MS) continue;
      if (!m.platform || !m.native_meeting_id) continue;
      const cnt = (await sql/* sql */ `
        SELECT COUNT(*) AS n FROM meeting_transcript WHERE meeting_id = ${m.id}
      `) as { n: number }[];
      if ((cnt[0]?.n ?? 0) > 0) continue; // capturing fine — not stalled
      // CONFIRM the bot is actually present this sweep. maybeEndMeeting returns
      // 'live' even when its Vexa probe ERRORED (it refuses to end on
      // uncertainty), so without this an outage would mislabel many meetings as
      // "deaf". Only a positive presence probe (ok && data===true) alerts.
      const present = await botRunning(env, m.platform as Platform, m.native_meeting_id);
      if (!present.ok || present.data !== true) continue;
      const mins = Math.round((Date.now() - started) / 60_000);
      // Atomic claim — mirrors dispatchDue. Two overlapping minute-ticks can't
      // both alert: only the one whose UPDATE flips alerted_at gets a row back.
      const claim = (await sql/* sql */ `
        UPDATE meetings
           SET last_error = ${`No transcript after ${mins}m (bot confirmed in call)`},
               alerted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
         WHERE id = ${m.id} AND alerted_at IS NULL
        RETURNING id
      `) as unknown[];
      if (!claim[0]) continue; // another sweep already claimed + alerted
      await notifyTelegram(
        env,
        `⚠️ Meeting "${m.title}" — the notetaker is in the call but has recorded nothing after ${mins} min. It may be deaf (wrong language pin / not admitted), or the call may simply be silent. Worth a look.`,
      );
    } catch {
      // never let one vendor hiccup abort the rest of the sweep
    }
  }
}
