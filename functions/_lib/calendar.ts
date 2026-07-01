import { getDb } from "./db";
import {
  decryptToken,
  listEvents,
  refreshAccessToken,
  type GoogleEnv,
} from "./google";
import { parseMeetingUrl } from "./meeting-url";
import { createMeetingWithBot } from "./meetings";
import { isTransientVexaStatus, type VexaEnv } from "./vexa";
import { createRecordingJob } from "./recorder-producer";
import { type RecorderProducerEnv } from "./recorder-job";

// A bot is dispatched this long before start so it's in the room before humans.
const DISPATCH_LEAD_MS = 3 * 60_000;
// A bot may still be dispatched up to this long after the scheduled end — so a
// late-starting or over-running meeting still gets a notetaker (replaces the old
// hard +10-min-after-start cutoff that silently dropped late joins).
const END_GRACE_MS = 5 * 60_000;
// Assumed length when the calendar event carries no usable end_time.
const DEFAULT_DURATION_MS = 60 * 60_000;
// Minimum gap between dispatch attempts for the same event — stops a failing
// event re-firing every single minute (the Jun-13 failed-row storm).
const RETRY_BACKOFF_MS = 5 * 60_000;
// Give up after this many dispatch attempts for one event occurrence (success
// or failure both count). With RETRY_BACKOFF_MS this covers ~30 min of retries
// to catch a late human; once a bot actually captures transcript the
// occurrence-scoped "handled" check stops dispatch regardless. Not resetting on
// bot-creation is deliberate — it's what bounds the empty-room re-dispatch storm.
const MAX_ATTEMPTS = 6;

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
  attempt_count: number;
  last_attempt_at: string | null;
  present: number;
  language: string | null;
}

/**
 * Refresh the cache of upcoming Meet-bearing events from Google into D1.
 * - New events default auto_join ON (owner wants the notetaker everywhere); an
 *   explicit per-event opt-OUT is preserved across refreshes (ON CONFLICT never
 *   touches auto_join).
 * - All-day (date-only) events are skipped — they have no real start clock.
 * - A reschedule / link change resets the dispatch attempt state so a moved
 *   meeting isn't permanently blocked by a stale cap.
 * - Events that vanished from Google within the synced window (cancelled /
 *   deleted) are flipped present=0 so they stop dispatching. Only runs on a
 *   successful list, so a transient API error never mass-deactivates.
 */
export async function syncEvents(
  sql: ReturnType<typeof getDb>,
  accessToken: string,
  nowMs: number,
): Promise<void> {
  const windowStartMs = nowMs - 5 * 60_000;
  const windowEndMs = nowMs + 24 * 3600_000;
  const timeMin = new Date(windowStartMs).toISOString();
  const timeMax = new Date(windowEndMs).toISOString();
  const res = await listEvents(accessToken, timeMin, timeMax);
  if (!res.ok) return;

  const seen = new Set<string>();
  for (const ev of res.events) {
    if (!ev.meetingUrl || !ev.id) continue;
    // Skip all-day events: Google gives a date with no time, which would parse
    // to UTC midnight and dispatch at an unexpected local hour.
    if (!ev.start || !ev.start.includes("T")) continue;
    const parsed = parseMeetingUrl(ev.meetingUrl);
    if (!parsed.ok) continue;
    seen.add(ev.id);
    await sql/* sql */ `
      INSERT INTO calendar_events
        (google_event_id, title, start_time, end_time, meeting_url, platform, native_meeting_id, auto_join, present, updated_at)
      VALUES
        (${ev.id}, ${ev.title}, ${ev.start}, ${ev.end}, ${ev.meetingUrl},
         ${parsed.platform}, ${parsed.nativeMeetingId}, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      ON CONFLICT (google_event_id) DO UPDATE SET
        title = excluded.title,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        meeting_url = excluded.meeting_url,
        platform = excluded.platform,
        native_meeting_id = excluded.native_meeting_id,
        present = 1,
        updated_at = excluded.updated_at,
        attempt_count = CASE
          WHEN calendar_events.start_time IS NOT excluded.start_time
            OR calendar_events.native_meeting_id IS NOT excluded.native_meeting_id
            OR calendar_events.platform IS NOT excluded.platform
          THEN 0 ELSE calendar_events.attempt_count END,
        last_attempt_at = CASE
          WHEN calendar_events.start_time IS NOT excluded.start_time
            OR calendar_events.native_meeting_id IS NOT excluded.native_meeting_id
            OR calendar_events.platform IS NOT excluded.platform
          THEN NULL ELSE calendar_events.last_attempt_at END,
        dispatched_meeting_id = CASE
          WHEN calendar_events.start_time IS NOT excluded.start_time
            OR calendar_events.native_meeting_id IS NOT excluded.native_meeting_id
            OR calendar_events.platform IS NOT excluded.platform
          THEN NULL ELSE calendar_events.dispatched_meeting_id END
    `;
  }

  // Deactivate cached events that Google no longer returns inside the synced
  // window. Parse start_time with Date.parse (handles the stored UTC-offset),
  // and only touch rows whose start falls in the window we actually queried.
  const cached = (await sql/* sql */ `
    SELECT google_event_id, start_time, present FROM calendar_events
  `) as { google_event_id: string; start_time: string | null; present: number }[];
  for (const row of cached) {
    if (seen.has(row.google_event_id)) continue;
    if (row.present === 0) continue;
    const s = row.start_time ? Date.parse(row.start_time) : NaN;
    if (!Number.isFinite(s)) continue;
    if (s < windowStartMs || s > windowEndMs) continue; // outside synced window — leave alone
    await sql/* sql */ `
      UPDATE calendar_events SET present = 0 WHERE google_event_id = ${row.google_event_id}
    `;
  }
}

/**
 * Dispatch bots for opt-in events happening now that aren't already handled.
 *
 * "Handled" is scoped to THIS occurrence: a bot is live/starting for the code,
 * OR a meeting for the code that STARTED within this occurrence's window already
 * captured transcript. A past occurrence of a recurring/reused Meet link does
 * not suppress the current one, and an empty-room ending (no transcript) is NOT
 * handled — so a bot that left an empty room is re-sent when the human arrives.
 *
 * The attempt claim is atomic (a single conditional UPDATE … RETURNING), so two
 * overlapping cron ticks can't both dispatch: the loser's backoff predicate
 * fails. The cap counts CONSECUTIVE failures (reset on success), bounding the
 * Vexa-error storm without stranding a long meeting that's waiting for a human.
 */
export async function dispatchDue(
  env: GoogleEnv & VexaEnv,
  sql: ReturnType<typeof getDb>,
  nowMs: number,
): Promise<{ dispatched: number; errors: string[]; alertable: string[] }> {
  const candidates = (await sql/* sql */ `
    SELECT google_event_id, title, start_time, end_time, meeting_url, platform,
           native_meeting_id, auto_join, dispatched_meeting_id,
           attempt_count, last_attempt_at, present, language
      FROM calendar_events
     WHERE auto_join = 1 AND present = 1 AND start_time IS NOT NULL
  `) as CalEventRow[];

  const backoffCutoffIso = new Date(nowMs - RETRY_BACKOFF_MS).toISOString();
  let dispatched = 0;
  const errors: string[] = []; // every failure (logged/returned for debugging)
  const alertable: string[] = []; // subset worth a Telegram (hard or cap-exhausted)
  for (const ev of candidates) {
    const startMs = ev.start_time ? Date.parse(ev.start_time) : NaN;
    if (!Number.isFinite(startMs)) continue;
    let endMs = ev.end_time ? Date.parse(ev.end_time) : NaN;
    if (!Number.isFinite(endMs) || endMs <= startMs) endMs = startMs + DEFAULT_DURATION_MS;

    // Window: from LEAD before start until END_GRACE after the scheduled end.
    if (nowMs < startMs - DISPATCH_LEAD_MS) continue; // too early
    if (nowMs > endMs + END_GRACE_MS) continue; // meeting is over
    if (!ev.platform || !ev.native_meeting_id) continue;

    // Occurrence-scoped "handled" check (meetings.started_at is uniform UTC 'Z').
    const winStartIso = new Date(startMs - DISPATCH_LEAD_MS).toISOString();
    const winEndIso = new Date(endMs + END_GRACE_MS).toISOString();
    const handled = (await sql/* sql */ `
      SELECT 1 FROM meetings m
       WHERE m.platform = ${ev.platform} AND m.native_meeting_id = ${ev.native_meeting_id}
         AND ( m.status IN ('live','starting')
            OR ( m.status = 'ended'
                 AND m.started_at >= ${winStartIso} AND m.started_at <= ${winEndIso}
                 AND EXISTS (SELECT 1 FROM meeting_transcript t WHERE t.meeting_id = m.id) ) )
       LIMIT 1
    `) as unknown[];
    if (handled[0]) continue;

    // Atomically claim the attempt: increments only if under the cap and past
    // the backoff. Two overlapping ticks → only one wins; the other gets no row.
    const claim = (await sql/* sql */ `
      UPDATE calendar_events
         SET attempt_count = attempt_count + 1,
             last_attempt_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE google_event_id = ${ev.google_event_id}
         AND attempt_count < ${MAX_ATTEMPTS}
         AND (last_attempt_at IS NULL OR last_attempt_at <= ${backoffCutoffIso})
      RETURNING google_event_id
    `) as unknown[];
    if (!claim[0]) continue; // cap hit, backoff active, or another tick won the claim

    const r = await createMeetingWithBot(env, sql, {
      title: ev.title,
      meetingUrl: ev.meeting_url ?? "",
      platform: ev.platform as "google_meet" | "zoom" | "teams",
      nativeMeetingId: ev.native_meeting_id,
      // NULL language → auto-detect (createBot omits the param so Vexa/Whisper
      // picks he/en); 'he'/'en' force that language.
      language: ev.language ?? undefined,
    });
    if (r.ok) {
      // Do NOT reset attempt_count here. A bot that's merely *created* (but lands
      // in an empty room and captures nothing) would otherwise re-dispatch every
      // backoff for the whole event window — the duplicate-empty-meeting storm.
      // The cap (MAX_ATTEMPTS) now bounds total dispatches per event; once a bot
      // actually captures transcript the occurrence-scoped "handled" check stops
      // further dispatch on its own.
      await sql/* sql */ `
        UPDATE calendar_events
           SET dispatched_meeting_id = ${r.meetingId}
         WHERE google_event_id = ${ev.google_event_id}
      `;
      dispatched++;
    } else {
      errors.push(`${ev.google_event_id}: ${r.detail}`);
      // Alert gate. createBot already retried Vexa's safe transient statuses
      // inline, so a failure here is worth paging only when it (a) is HARD (Vexa
      // won't recover from it), (b) has spent the per-event attempt cap, or (c) is
      // the LAST attempt that still fits this occurrence's window — no later tick
      // will retry it, so a dead key on a SHORT meeting (which never reaches the
      // 6-attempt cap before its window closes) still pages (Forge #2). An
      // ordinary transient blip that WILL retry next tick is NOT alerted — that's
      // the spam the feedback feature kept producing. A statusless failure is a
      // local DB/logic fault (createMeetingWithBot), not Vexa flakiness, so it is
      // treated HARD and never goes silent (Forge #3).
      const transient = r.status === undefined ? false : isTransientVexaStatus(r.status);
      const exhausted = ev.attempt_count + 1 >= MAX_ATTEMPTS;
      const lastInWindow = nowMs + RETRY_BACKOFF_MS > endMs + END_GRACE_MS;
      if (!transient || exhausted || lastInWindow) {
        const label = ev.title?.trim() || ev.google_event_id;
        const why = !transient
          ? ""
          : exhausted
            ? ` (no bot after ${ev.attempt_count + 1} attempts)`
            : ` (no bot before the meeting window closed)`;
        alertable.push(`${label}: ${r.detail}${why}`);
      }
    }
  }
  return { dispatched, errors, alertable };
}

/**
 * Calendar auto-join for the OWNED recorder (Path 6, multi-tenant P2).
 *
 * The recorder analog of dispatchDue: same dispatch window, same occurrence-scoped
 * "handled" check, same ATOMIC attempt-claim (two overlapping ticks can't both
 * fire) — the whole Vexa-era hardening is reused wholesale. Only the terminal
 * action changes: instead of creating a Vexa bot it enqueues a recorder JobContract
 * onto the shared `recorder-jobs` queue via createRecordingJob. The box pulls the
 * job, records, transcribes, and HMAC-POSTs the result back to this fork's ingest
 * endpoint; the fork never hands the box a D1 token. This is FORK-LOCAL code (reads
 * this fork's calendar_events, writes this fork's meetings) → it replicates per fork.
 *
 * Lifecycle differs from Vexa: recorder rows go requested→starting→transcribing→
 * ended/failed. "Handled" = an in-flight (requested/starting/transcribing) row
 * CREATED within this occurrence window (a requested row has NULL started_at, so
 * scope on created_at), OR an ended row with transcript in-window. A failed row or
 * an ended-with-no-transcript row is NOT handled — a late human still gets a bot.
 */
export async function enqueueDue(
  env: RecorderProducerEnv,
  sql: ReturnType<typeof getDb>,
  nowMs: number,
): Promise<{ dispatched: number; errors: string[]; alertable: string[] }> {
  const candidates = (await sql/* sql */ `
    SELECT google_event_id, title, start_time, end_time, meeting_url, platform,
           native_meeting_id, auto_join, dispatched_meeting_id,
           attempt_count, last_attempt_at, present, language
      FROM calendar_events
     WHERE auto_join = 1 AND present = 1 AND start_time IS NOT NULL
  `) as CalEventRow[];

  const backoffCutoffIso = new Date(nowMs - RETRY_BACKOFF_MS).toISOString();
  let dispatched = 0;
  const errors: string[] = []; // every failure (logged/returned for debugging)
  const alertable: string[] = []; // subset worth a Telegram (cap-exhausted / last-in-window)
  for (const ev of candidates) {
    const startMs = ev.start_time ? Date.parse(ev.start_time) : NaN;
    if (!Number.isFinite(startMs)) continue;
    let endMs = ev.end_time ? Date.parse(ev.end_time) : NaN;
    if (!Number.isFinite(endMs) || endMs <= startMs) endMs = startMs + DEFAULT_DURATION_MS;

    // Window: from LEAD before start until END_GRACE after the scheduled end.
    if (nowMs < startMs - DISPATCH_LEAD_MS) continue; // too early
    if (nowMs > endMs + END_GRACE_MS) continue; // meeting is over
    if (!ev.platform || !ev.native_meeting_id) continue;

    // Occurrence-scoped "handled" check adapted to the recorder lifecycle.
    const winStartIso = new Date(startMs - DISPATCH_LEAD_MS).toISOString();
    const winEndIso = new Date(endMs + END_GRACE_MS).toISOString();
    const handled = (await sql/* sql */ `
      SELECT 1 FROM meetings m
       WHERE m.platform = ${ev.platform} AND m.native_meeting_id = ${ev.native_meeting_id}
         AND ( ( m.status IN ('requested','starting','transcribing')
                 AND m.created_at >= ${winStartIso} )
            OR ( m.status = 'ended'
                 AND m.started_at >= ${winStartIso} AND m.started_at <= ${winEndIso}
                 AND EXISTS (SELECT 1 FROM meeting_transcript t WHERE t.meeting_id = m.id) ) )
       LIMIT 1
    `) as unknown[];
    if (handled[0]) continue;

    // Atomically claim the attempt (identical to dispatchDue): increments only if
    // under the cap and past the backoff. Two overlapping ticks → only one wins.
    const claim = (await sql/* sql */ `
      UPDATE calendar_events
         SET attempt_count = attempt_count + 1,
             last_attempt_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE google_event_id = ${ev.google_event_id}
         AND attempt_count < ${MAX_ATTEMPTS}
         AND (last_attempt_at IS NULL OR last_attempt_at <= ${backoffCutoffIso})
      RETURNING google_event_id
    `) as unknown[];
    if (!claim[0]) continue; // cap hit, backoff active, or another tick won the claim

    const r = await createRecordingJob(env, sql, {
      title: ev.title,
      meetingUrl: ev.meeting_url ?? "",
      platform: ev.platform,
      nativeId: ev.native_meeting_id,
      language: ev.language ?? null, // NULL → box default (he)
    });

    const label = ev.title?.trim() || ev.google_event_id;
    if (r.ok && (r.enqueued || r.reused)) {
      // Enqueued a fresh job, OR an in-flight recording already exists for this code
      // (the manual button beat the cron — createRecordingJob reused it). Either way
      // the occurrence is now being handled: record the row id. Do NOT reset
      // attempt_count (the cap bounds total dispatches per occurrence — the empty-
      // room storm guard). Only a fresh enqueue counts as a dispatch.
      await sql/* sql */ `
        UPDATE calendar_events SET dispatched_meeting_id = ${r.id}
         WHERE google_event_id = ${ev.google_event_id}
      `;
      if (r.enqueued) dispatched++;
    } else {
      // Failure — surfaced, never silent (feedback_failed_query_not_negative). When
      // the row was written but the enqueue failed, createRecordingJob already marked
      // it 'failed' + last_error, so /meetings shows it AND the occurrence handled-
      // check (which excludes 'failed') lets a later in-window tick retry.
      const detail = r.ok ? "enqueue failed (queue unbound/down)" : r.detail;
      errors.push(`${ev.google_event_id}: ${detail}`);
      const exhausted = ev.attempt_count + 1 >= MAX_ATTEMPTS;
      const lastInWindow = nowMs + RETRY_BACKOFF_MS > endMs + END_GRACE_MS;
      if (exhausted || lastInWindow) alertable.push(`${label}: ${detail}`);
    }
  }
  return { dispatched, errors, alertable };
}
