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

// A meeting auto-ends when Vexa reports its bot is no longer running (the call
// ended / everyone left). Bot-absence is only trusted after a join grace, since
// a freshly-created bot takes ~30-60s to appear. 12h is the absolute ceiling.
export const JOIN_GRACE_MS = 2 * 60_000;
export const HARD_CAP_MS = 12 * 3600_000;

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
    await sql/* sql */ `UPDATE meetings SET status = 'failed' WHERE id = ${meetingId}`;
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
  env: VexaEnv,
  sql: ReturnType<typeof getDb>,
): Promise<void> {
  const active = (await sql/* sql */ `
    SELECT id, title, meeting_url, platform, native_meeting_id, bot_id, status, summary,
           started_at, ended_at, created_at
      FROM meetings WHERE status IN ('live','starting')
  `) as MeetingRow[];
  for (const m of active) {
    try {
      await maybeEndMeeting(env, sql, m, false);
    } catch {
      // never let one vendor hiccup abort the rest of the sweep
    }
  }
}
