import { getDb } from "./db";
import {
  decryptToken,
  listEvents,
  refreshAccessToken,
  type GoogleEnv,
} from "./google";
import { parseMeetingUrl } from "./meeting-url";
import { createMeetingWithBot } from "./meetings";
import { type VexaEnv } from "./vexa";

// Dispatch a bot when an opt-in meeting starts within this lead window. The
// cron runs every minute, so a 3-min window tolerates a missed tick and lets
// the bot be in the room slightly before the humans.
const DISPATCH_LEAD_MS = 3 * 60_000;
// Don't dispatch for events whose start is already this far in the past (stale).
const DISPATCH_LATE_MS = 10 * 60_000;

export interface CalendarConnection {
  google_email: string | null;
  refresh_token_enc: string | null;
}

export async function getConnection(
  sql: ReturnType<typeof getDb>,
): Promise<CalendarConnection | null> {
  const rows = (await sql/* sql */ `
    SELECT google_email, refresh_token_enc FROM calendar_connection WHERE id = 1
  `) as CalendarConnection[];
  return rows[0] ?? null;
}

/** Mint a Google access token from the stored, encrypted refresh token. */
export async function getAccessToken(
  env: GoogleEnv,
  sql: ReturnType<typeof getDb>,
): Promise<{ ok: true; accessToken: string } | { ok: false; detail: string }> {
  const conn = await getConnection(sql);
  if (!conn || !conn.refresh_token_enc) return { ok: false, detail: "not connected" };
  const refresh = await decryptToken(env, conn.refresh_token_enc);
  if (!refresh) return { ok: false, detail: "token decrypt failed" };
  return refreshAccessToken(env, refresh);
}

export interface CalEventRow {
  google_event_id: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  meeting_url: string | null;
  platform: string | null;
  native_meeting_id: string | null;
  auto_join: number;
  dispatched_meeting_id: number | null;
}

/**
 * Refresh the cache of upcoming Meet-bearing events from Google into D1.
 * Preserves auto_join + dispatched_meeting_id across refreshes (ON CONFLICT
 * updates only the Google-owned fields). Only events whose URL parses to a
 * supported platform are stored.
 */
export async function syncEvents(
  sql: ReturnType<typeof getDb>,
  accessToken: string,
  nowMs: number,
): Promise<void> {
  const timeMin = new Date(nowMs - 5 * 60_000).toISOString();
  const timeMax = new Date(nowMs + 24 * 3600_000).toISOString();
  const res = await listEvents(accessToken, timeMin, timeMax);
  if (!res.ok) return;
  for (const ev of res.events) {
    if (!ev.meetingUrl || !ev.id) continue;
    const parsed = parseMeetingUrl(ev.meetingUrl);
    if (!parsed.ok) continue;
    await sql/* sql */ `
      INSERT INTO calendar_events
        (google_event_id, title, start_time, end_time, meeting_url, platform, native_meeting_id, auto_join, updated_at)
      VALUES
        (${ev.id}, ${ev.title}, ${ev.start}, ${ev.end}, ${ev.meetingUrl},
         ${parsed.platform}, ${parsed.nativeMeetingId}, 0, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      ON CONFLICT (google_event_id) DO UPDATE SET
        title = excluded.title,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        meeting_url = excluded.meeting_url,
        platform = excluded.platform,
        native_meeting_id = excluded.native_meeting_id,
        updated_at = excluded.updated_at
    `;
  }
}

/**
 * Dispatch bots for opt-in events whose start time is in the dispatch window
 * and which haven't been dispatched yet. Idempotent: dispatched_meeting_id is
 * set as soon as a bot is created, and createMeetingWithBot also guards
 * one-bot-per-code. Returns how many were dispatched.
 */
export async function dispatchDue(
  env: GoogleEnv & VexaEnv,
  sql: ReturnType<typeof getDb>,
  nowMs: number,
): Promise<{ dispatched: number; errors: string[] }> {
  const due = (await sql/* sql */ `
    SELECT google_event_id, title, start_time, end_time, meeting_url, platform,
           native_meeting_id, auto_join, dispatched_meeting_id
      FROM calendar_events
     WHERE auto_join = 1 AND dispatched_meeting_id IS NULL
       AND start_time IS NOT NULL
  `) as CalEventRow[];

  let dispatched = 0;
  const errors: string[] = [];
  for (const ev of due) {
    const startMs = ev.start_time ? Date.parse(ev.start_time) : NaN;
    if (!Number.isFinite(startMs)) continue;
    // Window: start is within DISPATCH_LEAD ahead, and not more than DISPATCH_LATE behind.
    if (startMs - nowMs > DISPATCH_LEAD_MS) continue;
    if (nowMs - startMs > DISPATCH_LATE_MS) continue;
    if (!ev.platform || !ev.native_meeting_id) continue;

    const r = await createMeetingWithBot(env, sql, {
      title: ev.title,
      meetingUrl: ev.meeting_url ?? "",
      platform: ev.platform as "google_meet" | "zoom" | "teams",
      nativeMeetingId: ev.native_meeting_id,
      language: "he",
    });
    if (r.ok) {
      await sql/* sql */ `
        UPDATE calendar_events SET dispatched_meeting_id = ${r.meetingId}
         WHERE google_event_id = ${ev.google_event_id}
      `;
      dispatched++;
    } else {
      errors.push(`${ev.google_event_id}: ${r.detail}`);
    }
  }
  return { dispatched, errors };
}
