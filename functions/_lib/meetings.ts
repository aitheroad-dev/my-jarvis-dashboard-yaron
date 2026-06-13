import { getDb } from "./db";
import {
  botRunning,
  stopBot,
  vexaConfigured,
  type Platform,
  type VexaEnv,
} from "./vexa";

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
